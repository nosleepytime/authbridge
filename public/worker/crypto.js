const encoder = new TextEncoder();

function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const part = bytes.subarray(i, i + chunk);
    binary += String.fromCharCode(...part);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function toBase64Url(bytes) {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/g, '');
}

export function fromBase64Url(input) {
  const base64 = input.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(input.length / 4) * 4, '=');
  return base64ToBytes(base64);
}

export function randomId(byteLength = 24) {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function sha256Base64Url(value) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toBase64Url(new Uint8Array(digest));
}

export async function hashPassword(password) {
  const iterations = 100000;
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );

  const hash = new Uint8Array(bits);
  return `pbkdf2_sha256$${iterations}$${toBase64Url(salt)}$${toBase64Url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [algorithm, iterationsRaw, saltRaw, hashRaw] = String(stored).split('$');
  if (algorithm !== 'pbkdf2_sha256') return false;

  const iterations = Number(iterationsRaw);
  const salt = fromBase64Url(saltRaw);

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );

  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );

  const hash = toBase64Url(new Uint8Array(bits));
  return hash === hashRaw;
}
