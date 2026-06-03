import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, verifyAdminSessionToken } from './admin-auth';

export async function requireAdmin(request) {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;

  if (await verifyAdminSessionToken(token)) {
    return null;
  }

  return NextResponse.json({ error: 'Admin login required.' }, { status: 401 });
}
