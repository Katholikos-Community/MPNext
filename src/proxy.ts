import { NextResponse, NextRequest } from 'next/server';
import { getSessionCookie } from 'better-auth/cookies';

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Early returns for public paths
  // `/auth-error` must stay public: AuthWrapper's session gate would otherwise
  // bounce an unauthenticated visitor sent here (an OAuth failure) to
  // `/signin`, which immediately restarts OAuth — a loop that never lets the
  // user see why sign-in failed.
  if (pathname.startsWith('/api') || pathname === '/signin' || pathname === '/auth-error') {
    return NextResponse.next();
  }

  try {
    const sessionCookie = getSessionCookie(request);

    if (!sessionCookie) {
      return NextResponse.redirect(new URL('/signin', request.url));
    }

    return NextResponse.next();

  } catch (error) {
    console.error(
      'Proxy: error checking session',
      error instanceof Error ? error.message : String(error)
    );
    return NextResponse.redirect(new URL('/signin', request.url));
  }
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|assets/).*)',
  ],
};
