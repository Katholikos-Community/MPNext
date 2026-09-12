import { describe, it, expect } from 'vitest';
import nextConfig from '../../next.config';

/**
 * Wiring test for the static security headers (F9).
 *
 * `src/lib/security-headers.test.ts` proves the header VALUES are right. This
 * file proves they are actually attached to every response — the half that
 * `next.config.ts` owns, and the half that silently disappears if someone
 * replaces the config wholesale (it shipped empty until this change) or
 * narrows the source pattern.
 *
 * It also pins the one non-obvious thing about that file: it imports from
 * `./src/...` by relative path, because Next compiles the config with its own
 * loader, which does not read the `@/` mapping out of tsconfig.
 */
describe('next.config headers', () => {
  async function headersFor(source: string) {
    const rules = await nextConfig.headers!();
    return rules.find((rule) => rule.source === source)?.headers ?? [];
  }

  it('applies security headers to every route', async () => {
    // `/(.*)` and not the proxy's matcher: these must also reach /api and the
    // static-asset paths the proxy deliberately skips.
    const headers = await headersFor('/(.*)');

    expect(headers.length).toBeGreaterThan(0);
  });

  it('includes the anti-framing, sniffing and referrer controls', async () => {
    const keys = (await headersFor('/(.*)')).map((h) => h.key);

    expect(keys).toContain('X-Frame-Options');
    expect(keys).toContain('X-Content-Type-Options');
    expect(keys).toContain('Referrer-Policy');
    expect(keys).toContain('Permissions-Policy');
  });

  it('does not set a Content-Security-Policy here', async () => {
    // The CSP is nonce-based and therefore per-request; it belongs to
    // src/proxy.ts. A second CSP header set here would be enforced as an
    // intersection with that one, which is a confusing thing to debug.
    const keys = (await headersFor('/(.*)')).map((h) => h.key);

    expect(keys).not.toContain('Content-Security-Policy');
    expect(keys).not.toContain('Content-Security-Policy-Report-Only');
  });
});
