import type { NextConfig } from "next";
// Relative, not the `@/` alias: this file is compiled by Next's own config
// loader, which does not read the tsconfig path mapping.
import { buildStaticSecurityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  /**
   * Request-independent security headers (F9).
   *
   * Applied here rather than in `src/proxy.ts` so they reach EVERY response —
   * `/api/*` and the `_next/static`, `_next/image`, `favicon.ico` and `assets/`
   * paths that the proxy matcher deliberately excludes.
   *
   * The Content-Security-Policy is NOT here. It carries a per-request nonce, so
   * it is built in `src/proxy.ts`; a value fixed at build time could not.
   * See `src/lib/security-headers.ts` for why the two halves are split.
   */
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: buildStaticSecurityHeaders(),
      },
    ];
  },
};

export default nextConfig;
