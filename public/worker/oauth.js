import { all, first, run } from './db.js';
import { randomId, sha256Base64Url } from './crypto.js';

export const SUPPORTED_SCOPES = ['profile', 'email'];

export function normalizeScopes(scopeString = '') {
  const values = Array.from(new Set(String(scopeString).split(/\s+/).filter(Boolean)));
  return values.filter((scope) => SUPPORTED_SCOPES.includes(scope));
}

export function parseJsonArray(input, fallback = []) {
  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

export async function getClientByClientId(env, clientId) {
  const client = await first(
    env,
    'SELECT * FROM oauth_clients WHERE client_id = ? AND status = ?',
    clientId,
    'active'
  );

  if (!client) return null;

  return {
    ...client,
    redirect_uris: parseJsonArray(client.redirect_uris, []),
    allowed_scopes: parseJsonArray(client.allowed_scopes, ['profile', 'email'])
  };
}

export async function getDeveloperStatus(env, userId) {
  return await first(
    env,
    'SELECT * FROM developer_requests WHERE user_id = ?',
    userId
  );
}

export async function getUserClients(env, userId) {
  const items = await all(
    env,
    'SELECT * FROM oauth_clients WHERE owner_user_id = ? ORDER BY created_at DESC',
    userId
  );

  return items.map((item) => ({
    ...item,
    redirect_uris: parseJsonArray(item.redirect_uris, []),
    allowed_scopes: parseJsonArray(item.allowed_scopes, [])
  }));
}

export async function createClient(env, userId, requestId, payload) {
  const redirectUris = String(payload.redirect_uris || '')
    .split(/\r?\n|,/)
    .map((uri) => uri.trim())
    .filter(Boolean);

  if (!redirectUris.length) {
    throw new Error('At least one redirect URI is required.');
  }

  const clientType = payload.client_type === 'public' ? 'public' : 'confidential';
  const allowedScopes = normalizeScopes(payload.allowed_scopes || 'profile email');
  const clientId = `ab_${randomId(18)}`;
  const clientSecret = clientType === 'confidential' ? randomId(36) : null;
  const id = randomId();

  await run(
    env,
    `INSERT INTO oauth_clients (id, owner_user_id, request_id, name, client_type, client_id, client_secret, redirect_uris, allowed_scopes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    userId,
    requestId || null,
    String(payload.name || '').trim(),
    clientType,
    clientId,
    clientSecret,
    JSON.stringify(redirectUris),
    JSON.stringify(allowedScopes)
  );

  return {
    id,
    name: String(payload.name || '').trim(),
    client_type: clientType,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uris: redirectUris,
    allowed_scopes: allowedScopes
  };
}

export async function getExistingConsent(env, userId, clientDbId) {
  const consent = await first(
    env,
    'SELECT * FROM consents WHERE user_id = ? AND client_id = ?',
    userId,
    clientDbId
  );

  if (!consent) return null;
  return {
    ...consent,
    granted_scopes: normalizeScopes(JSON.parse(consent.granted_scopes).join(' '))
  };
}

export async function storeConsent(env, userId, clientDbId, scopes) {
  const existing = await first(
    env,
    'SELECT id FROM consents WHERE user_id = ? AND client_id = ?',
    userId,
    clientDbId
  );

  if (existing) {
    await run(
      env,
      'UPDATE consents SET granted_scopes = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      JSON.stringify(scopes),
      existing.id
    );
    return existing.id;
  }

  const id = randomId();
  await run(
    env,
    'INSERT INTO consents (id, user_id, client_id, granted_scopes) VALUES (?, ?, ?, ?)',
    id,
    userId,
    clientDbId,
    JSON.stringify(scopes)
  );
  return id;
}

export async function issueAuthCode(env, payload) {
  const id = randomId();
  const code = randomId(32);
  const ttl = Number(env.AUTH_CODE_TTL_SECONDS || '600');
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  await run(
    env,
    `INSERT INTO auth_codes (id, code, client_id, user_id, redirect_uri, scope, code_challenge, code_challenge_method, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id,
    code,
    payload.clientDbId,
    payload.userId,
    payload.redirectUri,
    payload.scope,
    payload.codeChallenge || null,
    payload.codeChallengeMethod || null,
    expiresAt
  );

  return code;
}

export async function exchangeCodeForToken(env, body) {
  if (body.grant_type !== 'authorization_code') {
    throw new Error('Unsupported grant_type. Only authorization_code is implemented in this starter.');
  }

  const client = await getClientByClientId(env, body.client_id);
  if (!client) {
    throw new Error('Unknown client_id.');
  }

  const codeRow = await first(
    env,
    `SELECT auth_codes.*, users.email, users.name
     FROM auth_codes
     JOIN users ON users.id = auth_codes.user_id
     WHERE auth_codes.code = ?`,
    body.code
  );

  if (!codeRow) throw new Error('Invalid authorization code.');
  if (codeRow.client_id !== client.id) throw new Error('Authorization code does not belong to this client.');
  if (codeRow.redirect_uri !== body.redirect_uri) throw new Error('redirect_uri mismatch.');
  if (codeRow.consumed_at) throw new Error('Authorization code already used.');
  if (new Date(codeRow.expires_at).getTime() <= Date.now()) throw new Error('Authorization code expired.');

  if (client.client_type === 'confidential') {
    if (!body.client_secret || body.client_secret !== client.client_secret) {
      throw new Error('Invalid client_secret.');
    }
  } else {
    if (!codeRow.code_challenge) throw new Error('PKCE was required for this public client code.');
    if (!body.code_verifier) throw new Error('Missing code_verifier for PKCE.');
    const derived = await sha256Base64Url(body.code_verifier);
    if (codeRow.code_challenge_method !== 'S256' || derived !== codeRow.code_challenge) {
      throw new Error('Invalid PKCE code_verifier.');
    }
  }

  await run(
    env,
    'UPDATE auth_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?',
    codeRow.id
  );

  const ttl = Number(env.ACCESS_TOKEN_TTL_SECONDS || '3600');
  const accessToken = `atk_${randomId(32)}`;
  const expiresAt = new Date(Date.now() + ttl * 1000).toISOString();

  await run(
    env,
    `INSERT INTO oauth_tokens (id, access_token, client_id, user_id, scope, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    randomId(),
    accessToken,
    client.id,
    codeRow.user_id,
    codeRow.scope,
    expiresAt
  );

  return {
    access_token: accessToken,
    token_type: 'Bearer',
    expires_in: ttl,
    scope: codeRow.scope
  };
}

export async function findToken(env, accessToken) {
  return await first(
    env,
    `SELECT oauth_tokens.*, users.email, users.name
     FROM oauth_tokens
     JOIN users ON users.id = oauth_tokens.user_id
     WHERE oauth_tokens.access_token = ?`,
    accessToken
  );
}
