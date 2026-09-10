import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

export function middleware() {
  const response = NextResponse.next();
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Content-Security-Policy',
    "base-uri 'self'; object-src 'none'; form-action 'self'",
  );
  const target = (env as unknown as Record<string, string | undefined>)
    .NOCT_DEPLOYMENT_TARGET;
  // Managed Sites can embed the app. A standalone release has no trusted parent.
  if (target === 'standalone') {
    response.headers.set('X-Frame-Options', 'DENY');
    response.headers.set(
      'Content-Security-Policy',
      "base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
    );
  }
  return response;
}
