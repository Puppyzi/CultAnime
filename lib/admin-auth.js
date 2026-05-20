export const ADMIN_COOKIE_NAME = 'cultanime_admin';

const SESSION_TTL_SECONDS = 60 * 60 * 12;
const encoder = new TextEncoder();

function adminPassword() {
  const password = process.env.ADMIN_PASSWORD || '';
  if (
    !password ||
    password === 'change_this_for_local_admin' ||
    password === 'replace_with_a_strong_password'
  ) {
    return null;
  }

  return password;
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  const base64 = typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');

  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function safeEqual(a, b) {
  const left = String(a || '');
  const right = String(b || '');
  const length = Math.max(left.length, right.length);
  let diff = left.length ^ right.length;

  for (let i = 0; i < length; i++) {
    diff |= (left.charCodeAt(i) || 0) ^ (right.charCodeAt(i) || 0);
  }

  return diff === 0;
}

async function sign(value) {
  const password = adminPassword();
  if (!password) return null;

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`cultanime-admin:${password}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));

  return bytesToBase64Url(new Uint8Array(signature));
}

export function isAdminPasswordConfigured() {
  return Boolean(adminPassword());
}

export function verifyAdminPassword(password) {
  const configuredPassword = adminPassword();
  if (!configuredPassword) return false;

  return safeEqual(password, configuredPassword);
}

export async function createAdminSessionToken() {
  const expiresAt = Date.now() + (SESSION_TTL_SECONDS * 1000);
  const payload = `v1.${expiresAt}`;
  const signature = await sign(payload);

  if (!signature) return null;
  return `${payload}.${signature}`;
}

export async function verifyAdminSessionToken(token) {
  if (!token) return false;

  const parts = String(token).split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return false;

  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;

  const payload = `${parts[0]}.${parts[1]}`;
  const expectedSignature = await sign(payload);

  return Boolean(expectedSignature && safeEqual(parts[2], expectedSignature));
}

function secureCookieForRequest(request) {
  if (process.env.ADMIN_COOKIE_SECURE === 'true') return true;
  if (process.env.ADMIN_COOKIE_SECURE === 'false') return false;

  const forwardedProto = request?.headers?.get('x-forwarded-proto');
  return forwardedProto === 'https' || request?.nextUrl?.protocol === 'https:';
}

export function adminCookieOptions(request) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieForRequest(request),
    maxAge: SESSION_TTL_SECONDS,
    path: '/',
  };
}

export function expiredAdminCookieOptions(request) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: secureCookieForRequest(request),
    maxAge: 0,
    path: '/',
  };
}
