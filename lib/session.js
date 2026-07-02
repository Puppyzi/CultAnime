import { cookies } from 'next/headers';

const SESSION_COOKIE_NAME = 'cultanime_session';

export async function getSessionId() {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE_NAME)?.value || crypto.randomUUID();
}

export function createSessionCookie(sessionId, request) {
  const forwardedProto = request?.headers?.get('x-forwarded-proto');

  return {
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    secure: forwardedProto === 'https' || request?.nextUrl?.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  };
}
