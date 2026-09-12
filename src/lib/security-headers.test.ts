import { describe, it, expect, vi } from 'vitest';
import {
  buildContentSecurityPolicy,
  buildStaticSecurityHeaders,
  createNonce,
  cspHeaderName,
  originOf,
} from './security-headers';

/** Pulls one directive out of a policy string by name. */
function directive(csp: string, name: string): string | undefined {
  return csp
    .split('; ')
    .map((d) => d.trim())
    .find((d) => d === name || d.startsWith(`${name} `));
}

describe('buildStaticSecurityHeaders', () => {
  function valueOf(headers: ReturnType<typeof buildStaticSecurityHeaders>, key: string) {
    return headers.find((h) => h.key === key)?.value;
  }

  it('denies framing outright', () => {
    // Not SAMEORIGIN: nothing in this app frames itself, and this is the only
    // anti-framing control on the routes the proxy matcher skips.
    expect(valueOf(buildStaticSecurityHeaders(false), 'X-Frame-Options')).toBe('DENY');
  });

  it('disables content-type sniffing', () => {
    expect(valueOf(buildStaticSecurityHeaders(false), 'X-Content-Type-Options')).toBe('nosniff');
  });

  it('keeps full URLs same-origin only', () => {
    // A contact GUID in the path must not ride along to MP on the sign-out hop.
    expect(valueOf(buildStaticSecurityHeaders(false), 'Referrer-Policy')).toBe(
      'strict-origin-when-cross-origin'
    );
  });

  it('denies the device permissions this app never asks for', () => {
    const policy = valueOf(buildStaticSecurityHeaders(false), 'Permissions-Policy');

    expect(policy).toContain('camera=()');
    expect(policy).toContain('microphone=()');
    expect(policy).toContain('geolocation=()');
  });

  it('sends HSTS in production', () => {
    const hsts = valueOf(buildStaticSecurityHeaders(true), 'Strict-Transport-Security');

    expect(hsts).toContain('max-age=63072000');
    expect(hsts).toContain('includeSubDomains');
  });

  it('omits preload from HSTS', () => {
    // `preload` is a one-way submission to a browser-vendor list. That is the
    // deploying church's decision, not this repo's default.
    expect(valueOf(buildStaticSecurityHeaders(true), 'Strict-Transport-Security')).not.toContain(
      'preload'
    );
  });

  it('omits HSTS outside production', () => {
    // Otherwise a developer running a local http build gets their browser
    // pinned to https for localhost, which is tedious to unpick.
    expect(valueOf(buildStaticSecurityHeaders(false), 'Strict-Transport-Security')).toBeUndefined();
  });

  it('reads NODE_ENV when no argument is given', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(valueOf(buildStaticSecurityHeaders(), 'Strict-Transport-Security')).toBeTruthy();

    vi.stubEnv('NODE_ENV', 'test');
    expect(valueOf(buildStaticSecurityHeaders(), 'Strict-Transport-Security')).toBeUndefined();
  });
});

describe('originOf', () => {
  it('reduces a configured URL to its origin', () => {
    expect(originOf('https://mp.example.com/ministryplatformapi/files')).toBe(
      'https://mp.example.com'
    );
  });

  it('keeps a non-default port, which is part of the origin', () => {
    expect(originOf('https://mp.example.com:8443/api')).toBe('https://mp.example.com:8443');
  });

  it.each([
    ['undefined', undefined],
    ['null', null],
    ['empty', ''],
    ['not a URL', 'not-a-url'],
  ])('returns null for %s rather than throwing', (_label, input) => {
    // This runs on the request path in the proxy. A missing or fat-fingered
    // environment variable must narrow the policy, never 500 the whole app.
    expect(originOf(input)).toBeNull();
  });
});

describe('createNonce', () => {
  it('is unique per call', () => {
    const nonces = new Set(Array.from({ length: 100 }, createNonce));
    expect(nonces.size).toBe(100);
  });

  it('is base64 and long enough to be unguessable', () => {
    const nonce = createNonce();

    expect(nonce).toMatch(/^[A-Za-z0-9+/]+=*$/);
    // 16 random bytes -> 24 base64 characters.
    expect(nonce.length).toBeGreaterThanOrEqual(20);
  });

  it('contains no single quote, which would break out of the directive', () => {
    for (let i = 0; i < 100; i++) {
      expect(createNonce()).not.toContain("'");
    }
  });
});

describe('buildContentSecurityPolicy', () => {
  const base = { nonce: 'TEST-NONCE' };

  it('carries the nonce and strict-dynamic in script-src', () => {
    const csp = buildContentSecurityPolicy(base);

    expect(directive(csp, 'script-src')).toContain("'nonce-TEST-NONCE'");
    expect(directive(csp, 'script-src')).toContain("'strict-dynamic'");
  });

  it('locks down the usual suspects', () => {
    const csp = buildContentSecurityPolicy(base);

    expect(directive(csp, 'default-src')).toBe("default-src 'self'");
    expect(directive(csp, 'object-src')).toBe("object-src 'none'");
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'");
    expect(directive(csp, 'frame-ancestors')).toBe("frame-ancestors 'none'");
    expect(directive(csp, 'base-uri')).toBe("base-uri 'self'");
    expect(directive(csp, 'font-src')).toBe("font-src 'self'");
  });

  it('allows inline style attributes', () => {
    // Deliberate and load-bearing: Radix and vaul position every popover,
    // dialog, select and drawer with inline `style` attributes, which a nonce
    // cannot cover. Tightening this renders floating UI in the wrong place.
    expect(directive(buildContentSecurityPolicy(base), 'style-src-attr')).toBe(
      "style-src-attr 'unsafe-inline'"
    );
  });

  it('nonces stylesheets outside dev', () => {
    expect(directive(buildContentSecurityPolicy(base), 'style-src')).toBe(
      "style-src 'self' 'nonce-TEST-NONCE'"
    );
  });

  it('allows unsafe-inline styles in dev only', () => {
    // The dev server injects stylesheets through JS with no nonce available;
    // the nonce form would blank the page.
    const dev = buildContentSecurityPolicy({ ...base, isDev: true });

    expect(directive(dev, 'style-src')).toBe("style-src 'self' 'unsafe-inline'");
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'");
  });

  it('does not allow unsafe-eval outside dev', () => {
    // React uses eval only for dev-time error-stack reconstruction.
    expect(directive(buildContentSecurityPolicy(base), 'script-src')).not.toContain('unsafe-eval');
  });

  it('allows the HMR websocket in dev only', () => {
    expect(directive(buildContentSecurityPolicy({ ...base, isDev: true }), 'connect-src')).toBe(
      "connect-src 'self' ws:"
    );
    expect(directive(buildContentSecurityPolicy(base), 'connect-src')).toBe("connect-src 'self'");
  });

  it('upgrades insecure requests outside dev only', () => {
    // The directive rewrites http subresource URLs to https, which is exactly
    // wrong against a local http dev server.
    expect(directive(buildContentSecurityPolicy(base), 'upgrade-insecure-requests')).toBeDefined();
    expect(
      directive(buildContentSecurityPolicy({ ...base, isDev: true }), 'upgrade-insecure-requests')
    ).toBeUndefined();
  });

  it('adds the MP file origin to img-src when configured', () => {
    const csp = buildContentSecurityPolicy({ ...base, imageOrigin: 'https://files.example.com' });

    expect(directive(csp, 'img-src')).toBe(
      "img-src 'self' data: blob: https://files.example.com"
    );
  });

  it('still allows next/image placeholders with no file origin configured', () => {
    expect(directive(buildContentSecurityPolicy(base), 'img-src')).toBe(
      "img-src 'self' data: blob:"
    );
  });

  it('adds the MP origin to form-action when configured', () => {
    // Sign-out is a form-driven server action ending in a redirect to MP's
    // endsession endpoint, and browsers apply form-action to the whole
    // redirect chain — `'self'` alone can abort sign-out.
    const csp = buildContentSecurityPolicy({ ...base, formActionOrigin: 'https://mp.example.com' });

    expect(directive(csp, 'form-action')).toBe("form-action 'self' https://mp.example.com");
  });

  it('falls back to self-only form-action with no MP origin configured', () => {
    expect(directive(buildContentSecurityPolicy(base), 'form-action')).toBe("form-action 'self'");
  });

  it('emits directives separated so each parses independently', () => {
    const csp = buildContentSecurityPolicy(base);

    expect(csp).not.toContain(';;');
    expect(csp).not.toMatch(/\n/);
    expect(csp.split('; ').length).toBeGreaterThan(10);
  });
});

describe('cspHeaderName', () => {
  it('reports by default', () => {
    // A nonce CSP is the one security header that can white-screen the app, so
    // enforcement is opt-in and a typo in the variable cannot take a deploy
    // down.
    expect(cspHeaderName(false)).toBe('Content-Security-Policy-Report-Only');
  });

  it('enforces when asked', () => {
    expect(cspHeaderName(true)).toBe('Content-Security-Policy');
  });

  it.each([
    ['true', 'Content-Security-Policy'],
    ['false', 'Content-Security-Policy-Report-Only'],
    ['1', 'Content-Security-Policy-Report-Only'],
    ['TRUE', 'Content-Security-Policy-Report-Only'],
  ])('reads CSP_ENFORCE=%s as %s', (value, expected) => {
    vi.stubEnv('CSP_ENFORCE', value);
    expect(cspHeaderName()).toBe(expected);
    vi.stubEnv('CSP_ENFORCE', undefined);
  });

  it('reports when CSP_ENFORCE is unset', () => {
    vi.stubEnv('CSP_ENFORCE', undefined);
    expect(cspHeaderName()).toBe('Content-Security-Policy-Report-Only');
  });
});
