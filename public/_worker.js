import { json, html, js, redirect, readBody, preflight, badRequest, corsHeaders } from './worker/http.js';
import { all, first, run } from './worker/db.js';
import { createUser, authenticateUser, createSession, clearSession, getSession, requireAdmin, serializeSetCookie } from './worker/auth.js';
import { randomId } from './worker/crypto.js';
import { normalizeScopes, getClientByClientId, getDeveloperStatus, getUserClients, createClient, getExistingConsent, storeConsent, issueAuthCode, exchangeCodeForToken, findToken } from './worker/oauth.js';
import { renderConsentPage } from './worker/templates.js';

function originOf(request) {
  return new URL(request.url).origin;
}

function routeStatic(request, env, path) {
  const url = new URL(request.url);
  url.pathname = path;
  return env.ASSETS.fetch(new Request(url.toString(), request));
}

function appendStateParam(redirectUri, params) {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

function noStoreHeaders(extra = {}) {
  return {
    'cache-control': 'no-store',
    ...extra
  };
}

function ok(data, status = 200, extraHeaders = {}) {
  return json(data, status, noStoreHeaders(extraHeaders));
}

function errorResponse(message, status = 400) {
  return json({ error: 'invalid_request', error_description: message }, status);
}

async function handleSignup(request, env) {
  const body = await readBody(request);
  const name = String(body.name || '').trim();
  const email = String(body.email || '').trim();
  const password = String(body.password || '');

  if (!name) return errorResponse('Name is required.');
  if (!email) return errorResponse('Email is required.');
  if (password.length < 8) return errorResponse('Password must be at least 8 characters long.');

  const user = await createUser(env, { name, email, password });
  const session = await createSession(env, user.id);

  return ok(
    { success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    201,
    { 'set-cookie': serializeSetCookie(env, session.id, { maxAge: session.maxAge }) }
  );
}

async function handleLogin(request, env) {
  const body = await readBody(request);
  const email = String(body.email || '').trim();
  const password = String(body.password || '');

  if (!email || !password) return errorResponse('Email and password are required.');

  const user = await authenticateUser(env, email, password);
  if (!user) return errorResponse('Invalid email or password.', 401);

  const session = await createSession(env, user.id);

  return ok(
    { success: true, user: { id: user.id, email: user.email, name: user.name, role: user.role } },
    200,
    { 'set-cookie': serializeSetCookie(env, session.id, { maxAge: session.maxAge }) }
  );
}

async function handleLogout(request, env) {
  await clearSession(request, env);
  return ok({ success: true }, 200, {
    'set-cookie': serializeSetCookie(env, '', { maxAge: 0 })
  });
}

async function handleMe(request, env) {
  const session = await getSession(request, env);
  if (!session) {
    return ok({ authenticated: false });
  }

  const developer = await getDeveloperStatus(env, session.user.id);
  return ok({
    authenticated: true,
    user: session.user,
    developer: developer ? { status: developer.status, id: developer.id } : null
  });
}

async function handleBootstrapAdmin(request, env) {
  const adminExists = await first(env, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  if (adminExists) {
    return errorResponse('An admin already exists for this instance.', 409);
  }

  const body = await readBody(request);
  if (!env.BOOTSTRAP_KEY) {
    return errorResponse('BOOTSTRAP_KEY secret is missing in Cloudflare.', 500);
  }
  if (String(body.bootstrap_key || '') !== env.BOOTSTRAP_KEY) {
    return errorResponse('Invalid bootstrap key.', 403);
  }

  const user = await createUser(env, {
    name: String(body.name || '').trim(),
    email: String(body.email || '').trim(),
    password: String(body.password || ''),
    role: 'admin'
  });

  return ok({ success: true, user }, 201);
}

async function handleDeveloperStatus(request, env) {
  const session = await getSession(request, env);
  if (!session) return errorResponse('Authentication required.', 401);

  const developerRequest = await getDeveloperStatus(env, session.user.id);
  const clients = await getUserClients(env, session.user.id);

  return ok({
    developer_request: developerRequest,
    clients
  });
}

async function handleDeveloperRequest(request, env) {
  const session = await getSession(request, env);
  if (!session) return errorResponse('Authentication required.', 401);

  const existing = await getDeveloperStatus(env, session.user.id);
  if (existing) {
    return errorResponse('A developer request already exists for this account.', 409);
  }

  const body = await readBody(request);
  const companyName = String(body.company_name || '').trim();
  const website = String(body.website || '').trim();
  const useCase = String(body.use_case || '').trim();

  if (!companyName || !useCase) {
    return errorResponse('Company/project name and use case are required.');
  }

  await run(
    env,
    `INSERT INTO developer_requests (id, user_id, company_name, website, use_case, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    randomId(),
    session.user.id,
    companyName,
    website || null,
    useCase
  );

  return ok({ success: true }, 201);
}

async function handleDeveloperApps(request, env) {
  const session = await getSession(request, env);
  if (!session) return errorResponse('Authentication required.', 401);

  const developerRequest = await getDeveloperStatus(env, session.user.id);
  if (!developerRequest || developerRequest.status !== 'approved') {
    return errorResponse('Developer access has not been approved yet.', 403);
  }

  const body = await readBody(request);
  const name = String(body.name || '').trim();
  if (!name) return errorResponse('Application name is required.');

  const client = await createClient(env, session.user.id, developerRequest.id, body);
  return ok({ success: true, client }, 201);
}

async function handleAdminRequests(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return errorResponse('Admin authentication required.', 403);

  const requests = await all(
    env,
    `SELECT developer_requests.*, users.email AS user_email, users.name AS user_name
     FROM developer_requests
     JOIN users ON users.id = developer_requests.user_id
     WHERE developer_requests.status = 'pending'
     ORDER BY developer_requests.created_at ASC`
  );

  return ok({ requests });
}

async function handleAdminReview(request, env) {
  const admin = await requireAdmin(request, env);
  if (!admin) return errorResponse('Admin authentication required.', 403);

  const body = await readBody(request);
  const requestId = String(body.request_id || '');
  const status = body.status === 'approved' ? 'approved' : body.status === 'rejected' ? 'rejected' : '';

  if (!requestId || !status) return errorResponse('request_id and valid status are required.');

  await run(
    env,
    `UPDATE developer_requests
     SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    status,
    String(body.review_note || '').trim() || null,
    admin.user.id,
    requestId
  );

  return ok({ success: true });
}

async function handleOAuthAuthorize(request, env) {
  const url = new URL(request.url);
  const incoming = request.method === 'POST' ? await readBody(request) : Object.fromEntries(url.searchParams.entries());

  const clientId = String(incoming.client_id || '');
  const redirectUri = String(incoming.redirect_uri || '');
  const responseType = String(incoming.response_type || '');
  const state = String(incoming.state || '');
  const scope = normalizeScopes(incoming.scope || 'profile').join(' ');
  const codeChallenge = incoming.code_challenge ? String(incoming.code_challenge) : null;
  const codeChallengeMethod = incoming.code_challenge_method ? String(incoming.code_challenge_method) : null;
  const prompt = String(incoming.prompt || '');

  if (responseType !== 'code') return badRequest('unsupported_response_type', 'Only response_type=code is supported.');
  if (!clientId) return badRequest('invalid_request', 'Missing client_id.');
  if (!redirectUri) return badRequest('invalid_request', 'Missing redirect_uri.');

  const client = await getClientByClientId(env, clientId);
  if (!client) return badRequest('unauthorized_client', 'Unknown client.');
  if (!client.redirect_uris.includes(redirectUri)) return badRequest('invalid_request', 'redirect_uri is not registered for this client.');

  const requestedScopes = normalizeScopes(scope);
  if (!requestedScopes.length) return badRequest('invalid_scope', 'No supported scopes requested.');
  if (!requestedScopes.every((item) => client.allowed_scopes.includes(item))) {
    return badRequest('invalid_scope', 'Requested scope is not allowed for this client.');
  }

  if (client.client_type === 'public') {
    if (!codeChallenge || codeChallengeMethod !== 'S256') {
      return badRequest('invalid_request', 'Public clients must send PKCE with code_challenge_method=S256.');
    }
  }

  const session = await getSession(request, env);
  if (!session) {
    const next = `${url.pathname}?${url.searchParams.toString()}`;
    return redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  if (request.method === 'POST' && incoming.decision === 'deny') {
    return redirect(appendStateParam(redirectUri, { error: 'access_denied', state }));
  }

  const existingConsent = await getExistingConsent(env, session.user.id, client.id);
  const alreadyGranted = existingConsent && requestedScopes.every((item) => existingConsent.granted_scopes.includes(item));

  if (alreadyGranted && prompt !== 'consent' && request.method !== 'POST') {
    const code = await issueAuthCode(env, {
      clientDbId: client.id,
      userId: session.user.id,
      redirectUri,
      scope: requestedScopes.join(' '),
      codeChallenge,
      codeChallengeMethod
    });

    return redirect(appendStateParam(redirectUri, { code, state }));
  }

  if (request.method === 'POST' && incoming.decision === 'approve') {
    await storeConsent(env, session.user.id, client.id, requestedScopes);
    const code = await issueAuthCode(env, {
      clientDbId: client.id,
      userId: session.user.id,
      redirectUri,
      scope: requestedScopes.join(' '),
      codeChallenge,
      codeChallengeMethod
    });

    return redirect(appendStateParam(redirectUri, { code, state }));
  }

  return html(renderConsentPage({
    appName: client.name,
    scope: requestedScopes.join(' '),
    user: session.user,
    formAction: '/oauth/authorize',
    hiddenFields: {
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: responseType,
      state,
      scope: requestedScopes.join(' '),
      code_challenge: codeChallenge || '',
      code_challenge_method: codeChallengeMethod || '',
      prompt
    }
  }));
}

async function handleOAuthToken(request, env) {
  if (request.method === 'OPTIONS') return preflight();

  const body = await readBody(request);

  try {
    const token = await exchangeCodeForToken(env, body);
    return ok(token, 200, corsHeaders('*'));
  } catch (error) {
    return json(
      { error: 'invalid_grant', error_description: error.message || 'Token exchange failed.' },
      400,
      corsHeaders('*')
    );
  }
}

async function handleOAuthUserinfo(request, env) {
  if (request.method === 'OPTIONS') return preflight();

  const authHeader = request.headers.get('authorization') || '';
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return json({ error: 'invalid_token', error_description: 'Missing Bearer access token.' }, 401, corsHeaders('*'));
  }

  const token = await findToken(env, match[1]);
  if (!token) {
    return json({ error: 'invalid_token', error_description: 'Unknown access token.' }, 401, corsHeaders('*'));
  }
  if (token.revoked_at) {
    return json({ error: 'invalid_token', error_description: 'Access token revoked.' }, 401, corsHeaders('*'));
  }
  if (new Date(token.expires_at).getTime() <= Date.now()) {
    return json({ error: 'invalid_token', error_description: 'Access token expired.' }, 401, corsHeaders('*'));
  }

  return ok(
    {
      sub: token.user_id,
      email: token.email,
      name: token.name,
      scope: token.scope
    },
    200,
    corsHeaders('*')
  );
}

async function handleOAuthRevoke(request, env) {
  if (request.method === 'OPTIONS') return preflight();

  const body = await readBody(request);
  const client = await getClientByClientId(env, String(body.client_id || ''));
  if (!client || client.client_type !== 'confidential' || String(body.client_secret || '') !== client.client_secret) {
    return json({ error: 'invalid_client', error_description: 'Invalid client credentials.' }, 401, corsHeaders('*'));
  }

  const token = String(body.token || '');
  if (token) {
    await run(
      env,
      'UPDATE oauth_tokens SET revoked_at = CURRENT_TIMESTAMP WHERE access_token = ? AND client_id = ?',
      token,
      client.id
    );
  }

  return new Response(null, { status: 200, headers: corsHeaders('*') });
}

async function handleDiscovery(request, env) {
  const issuer = originOf(request);
  return ok({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    userinfo_endpoint: `${issuer}/oauth/userinfo`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code'],
    scopes_supported: ['profile', 'email'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'none']
  });
}

async function handleConfig(request, env) {
  const publicConfig = {
    baseUrl: originOf(request),
    appName: env.APP_NAME || 'AuthBridge',
    weglotApiKey: env.WEGLOT_API_KEY || ''
  };

  return js(`window.AUTHBRIDGE_CONFIG = ${JSON.stringify(publicConfig, null, 2)};`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      if (pathname === '/' || pathname === '/index.html') return routeStatic(request, env, '/index.html');
      if (pathname === '/login') return routeStatic(request, env, '/login.html');
      if (pathname === '/signup') return routeStatic(request, env, '/signup.html');
      if (pathname === '/dashboard') return routeStatic(request, env, '/dashboard.html');
      if (pathname === '/developer') return routeStatic(request, env, '/developer.html');
      if (pathname === '/admin') return routeStatic(request, env, '/admin.html');
      if (pathname === '/config.js') return handleConfig(request, env);

      if (pathname === '/api/signup' && request.method === 'POST') return await handleSignup(request, env);
      if (pathname === '/api/login' && request.method === 'POST') return await handleLogin(request, env);
      if (pathname === '/api/logout' && request.method === 'POST') return await handleLogout(request, env);
      if (pathname === '/api/me' && request.method === 'GET') return await handleMe(request, env);
      if (pathname === '/api/bootstrap-admin' && request.method === 'POST') return await handleBootstrapAdmin(request, env);
      if (pathname === '/api/developer/status' && request.method === 'GET') return await handleDeveloperStatus(request, env);
      if (pathname === '/api/developer/request' && request.method === 'POST') return await handleDeveloperRequest(request, env);
      if (pathname === '/api/developer/apps' && request.method === 'POST') return await handleDeveloperApps(request, env);
      if (pathname === '/api/admin/requests' && request.method === 'GET') return await handleAdminRequests(request, env);
      if (pathname === '/api/admin/review' && request.method === 'POST') return await handleAdminReview(request, env);

      if (pathname === '/oauth/authorize' && (request.method === 'GET' || request.method === 'POST')) return await handleOAuthAuthorize(request, env);
      if (pathname === '/oauth/token' && (request.method === 'POST' || request.method === 'OPTIONS')) return await handleOAuthToken(request, env);
      if (pathname === '/oauth/userinfo' && (request.method === 'GET' || request.method === 'OPTIONS')) return await handleOAuthUserinfo(request, env);
      if (pathname === '/oauth/revoke' && (request.method === 'POST' || request.method === 'OPTIONS')) return await handleOAuthRevoke(request, env);
      if (pathname === '/.well-known/oauth-authorization-server' && request.method === 'GET') return await handleDiscovery(request, env);

      return env.ASSETS.fetch(request);
    } catch (error) {
      return json(
        {
          error: 'server_error',
          error_description: error?.message || 'Unexpected server error.'
        },
        500
      );
    }
  }
};
