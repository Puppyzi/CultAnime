import { NextResponse } from 'next/server';
import { ADMIN_COOKIE_NAME, verifyAdminSessionToken } from './lib/admin-auth';

function loginUrl(request) {
  const url = new URL('/admin/login', request.url);
  const next = `${request.nextUrl.pathname}${request.nextUrl.search}`;

  if (next !== '/admin/login') {
    url.searchParams.set('next', next);
  }

  return url;
}

function unauthorizedJson() {
  return NextResponse.json({ error: 'Admin authentication required' }, { status: 401 });
}

export async function proxy(request) {
  const pathname = request.nextUrl.pathname;
  const isLoginPage = pathname === '/admin/login';
  const isAdminAuthApi = pathname === '/api/admin/auth';
  const isAdminApi = pathname.startsWith('/api/admin');
  const isAdminPage = pathname === '/admin' || pathname.startsWith('/admin/');

  if (isAdminAuthApi) {
    return NextResponse.next();
  }

  const isAuthenticated = await verifyAdminSessionToken(
    request.cookies.get(ADMIN_COOKIE_NAME)?.value
  );

  if (isLoginPage) {
    if (isAuthenticated) {
      return NextResponse.redirect(new URL('/admin', request.url));
    }

    return NextResponse.next();
  }

  if (isAdminApi && !isAuthenticated) {
    return unauthorizedJson();
  }

  if (isAdminPage && !isAuthenticated) {
    return NextResponse.redirect(loginUrl(request));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/api/admin/:path*'],
};
