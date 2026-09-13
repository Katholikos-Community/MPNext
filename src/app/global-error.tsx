"use client";

import { useEffect } from "react";

/**
 * Last-resort boundary for a failure in the root `layout.tsx` itself.
 *
 * `error.tsx` never wraps the layout of its own segment, so a throw in the root
 * layout escapes both `src/app/error.tsx` and `(web)/error.tsx`. This file is
 * the only thing between that and Next's default error screen. It REPLACES the
 * root layout when active, so it must render its own `<html>` and `<body>`.
 *
 * Three constraints follow from that, all of them load-bearing:
 *
 *  1. It imports nothing from the app — no shadcn components, no providers, no
 *     `globals.css`. Whatever failed may be exactly that code, and per Next's
 *     docs `global-error` does not get the app's global styles anyway.
 *  2. Styling is therefore inline. That is safe here: the CSP set in
 *     `src/proxy.ts` is `style-src 'self' 'unsafe-inline'` with NO nonce
 *     (see .claude/references/security-headers.md), so inline style attributes
 *     are permitted. A nonce-based `style-src` would silently drop all of this.
 *  3. `metadata`/`generateMetadata` exports are not supported in a client
 *     component, so the tab title uses React's `<title>` element instead.
 */
export default function GlobalError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  // Next 16 renamed this prop: it is `retry`, not the `reset` of earlier versions.
  retry: () => void;
}) {
  useEffect(() => {
    // Identifiers and shape only — never `error.message`. See the F5 logging
    // policy in .claude/references/auth.md § Logging policy.
    console.error("ui.render.error", {
      boundary: "global",
      name: error.name,
      digest: error.digest,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "1rem",
          fontFamily:
            "system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
          color: "#1f2937",
          background: "#ffffff",
        }}
      >
        <title>Something went wrong</title>
        <div style={{ maxWidth: "28rem", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.5rem",
              fontWeight: 600,
              margin: "0 0 0.75rem",
            }}
          >
            Something went wrong
          </h1>
          <p style={{ color: "#4b5563", margin: "0 0 1.5rem" }}>
            The application failed to start. Try again, and if this keeps
            happening contact your administrator.
          </p>
          {error.digest && (
            <p
              style={{
                color: "#4b5563",
                fontSize: "0.875rem",
                margin: "0 0 1.5rem",
              }}
            >
              Reference code:{" "}
              <code style={{ fontFamily: "ui-monospace, monospace" }}>
                {error.digest}
              </code>
            </p>
          )}
          <button
            type="button"
            onClick={() => retry()}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "0.375rem",
              border: "none",
              background: "#344767",
              color: "#ffffff",
              fontWeight: 500,
              fontSize: "1rem",
              padding: "0.625rem 1.25rem",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
