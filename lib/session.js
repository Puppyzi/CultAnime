import { cookies } from 'next/headers';
import { v4 as uuidv4 } from 'uuid';

export async function getSessionId() {
  const cookieStore = await cookies();
  let sessionId = cookieStore.get('cultanime_session')?.value;
  
  if (!sessionId) {
    sessionId = uuidv4();
  }
  
  return sessionId;
}

export function createSessionCookie(sessionId) {
  return {
    name: 'cultanime_session',
    value: sessionId,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365, // 1 year
    path: '/',
  };
}
