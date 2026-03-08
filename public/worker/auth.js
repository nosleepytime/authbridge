import { first, run } from './db.js';
import { parseCookies } from './http.js';
import { hashPassword, randomId, verifyPassword } from './crypto.js';

export async function createUser(env, { email, password, name, role = 'user' }) {
  const existing = await first(env, 'SELECT id FROM users WHERE email = ?', email.toLowerCase());
  if (existing) {
    throw new Error('An account already exists for this email.');
  }

  const id = randomId();
  const passwordHash = await hashPassword(password);

  await run(
    env,
    'INSERT INTO users (id, email, password_hash, name, role) VALUES (?, ?, ?, ?, ?)',
    id,
    email.toLowerCase(),
    passwordHash,
    name.trim(),
    role
  );

  return { id, email: email.toLowerCase(), name: name.trim(), role };
}

export async function authenticateUser(env, email, password) {
  const user = await first(
    env,
    'SELECT id, email, name, role, password_hash FROM users WHERE email = ?',
    email.toLowerCase()
  );

  if (!user) return null;

  const ok = await verifyPassword(password, user.password_hash);
  if (!ok) return null;

  return user;
}

export function sessionCookieName(env) {
  return env.SESSION_COOKIE_NAME || 'ab_session';
}

export function serializeSetCookie(env, value, options = {}) {
  const parts = [`${sessionCookieName(env)}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.sameSite || options.sameSite !== false) parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  if (options.secure !== false) parts.push('Secure');
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.max(0, options.maxAge)}`);
  return parts.join('; ');
}

export async function createSession(env, userId) {
  const id = randomId(32);
  const maxAge = 60 * 60 * 24 * 14;
  const expiresAt = new Date(Date.now() + maxAge * 1000).toISOString();

  await run(
    env,
    'INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)',
    id,
    userId,
    expiresAt
  );

  return { id, maxAge };
}

export async function getSession(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies[sessionCookieName(env)];
  if (!sessionId) return null;

  const session = await first(
    env,
    `SELECT sessions.id, sessions.user_id, sessions.expires_at, users.email, users.name, users.role
     FROM sessions
     JOIN users ON users.id = sessions.user_id
     WHERE sessions.id = ?`,
    sessionId
  );

  if (!session) return null;
  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await run(env, 'DELETE FROM sessions WHERE id = ?', sessionId);
    return null;
  }

  return {
    id: session.id,
    user: {
      id: session.user_id,
      email: session.email,
      name: session.name,
      role: session.role
    }
  };
}

export async function clearSession(request, env) {
  const cookies = parseCookies(request.headers.get('Cookie') || '');
  const sessionId = cookies[sessionCookieName(env)];
  if (!sessionId) return;
  await run(env, 'DELETE FROM sessions WHERE id = ?', sessionId);
}

export async function requireUser(request, env) {
  return await getSession(request, env);
}

export async function requireAdmin(request, env) {
  const session = await getSession(request, env);
  if (!session || session.user.role !== 'admin') return null;
  return session;
}
