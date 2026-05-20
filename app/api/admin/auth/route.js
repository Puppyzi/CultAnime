import { NextResponse } from 'next/server';
import {
  ADMIN_COOKIE_NAME,
  adminCookieOptions,
  createAdminSessionToken,
  expiredAdminCookieOptions,
  isAdminPasswordConfigured,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from '../../../../lib/admin-auth';

export const dynamic = 'force-dynamic';

export async function GET(request) {
  const token = request.cookies.get(ADMIN_COOKIE_NAME)?.value;

  return NextResponse.json({
    configured: isAdminPasswordConfigured(),
    authenticated: await verifyAdminSessionToken(token),
  });
}

export async function POST(request) {
  if (!isAdminPasswordConfigured()) {
    return NextResponse.json(
      { error: 'ADMIN_PASSWORD is not configured.' },
      { status: 500 }
    );
  }

  const body = await request.json().catch(() => ({}));

  if (!verifyAdminPassword(body.password)) {
    return NextResponse.json({ error: 'Invalid admin password.' }, { status: 401 });
  }

  const token = await createAdminSessionToken();
  if (!token) {
    return NextResponse.json(
      { error: 'Could not create admin session.' },
      { status: 500 }
    );
  }

  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE_NAME, token, adminCookieOptions(request));
  return response;
}

export async function DELETE(request) {
  const response = NextResponse.json({ success: true });
  response.cookies.set(ADMIN_COOKIE_NAME, '', expiredAdminCookieOptions(request));
  return response;
}
