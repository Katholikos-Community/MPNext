import { describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * Better Auth catch-all route tests (F7 allowlist).
 *
 * `src/app/api/auth/[...all]/route.ts` mounts ~30 better-auth endpoints, but
 * this app's browser client calls exactly three of them (see the table on
 * `allowedAuthRoutes` in route.ts). Everything else must 404 — deny-by-default
 * so a future better-auth version cannot silently reopen dead surface.
 *
 * These tests drive the REAL exported `GET`/`POST` against the REAL `auth`
 * instance (via real `toNextJsHandler(auth)`) with real `NextRequest` objects,
 * so a regression in the allowlist wrapper itself is caught — no mocking of
 * `@/lib/auth` or `better-auth/next-js`. Only `@/lib/providers/ministry-platform`
 * is mocked (MPHelper as a class, per .claude/references/testing.md), because
 * importing the real `@/lib/auth` module must never reach Ministry Platform.
 */

// A minimal stub of MP's OIDC discovery document. genericOAuth's plugin
// `init` fetches this eagerly when `@/lib/auth` is constructed (at import
// time, before any test body runs), so the stub has to be installed inside
// `vi.hoisted()` — the only thing that runs before the `import "./route"`
// below actually executes and triggers that construction. Without it,
// discovery fails (no real network in tests, correctly per CLAUDE.md), the
// "ministry-platform" provider is never registered, and even an ALLOWED
// `POST /sign-in/social` would 404 for the wrong reason (no such provider),
// masking whether the allowlist wrapper itself delegates correctly.
const { mockGetTableRecords } = vi.hoisted(() => {
  const realFetch = globalThis.fetch;
  const stubbedFetch: typeof fetch = (input, init) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    if (url.endsWith("/oauth/.well-known/openid-configuration")) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            issuer: "https://test-mp.example.com",
            authorization_endpoint:
              "https://test-mp.example.com/oauth/connect/authorize",
            token_endpoint: "https://test-mp.example.com/oauth/connect/token",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    }
    return realFetch(input, init);
  };
  globalThis.fetch = stubbedFetch;
  return {
    mockGetTableRecords: vi.fn(),
  };
});

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
  },
}));

import { GET, POST, allowedAuthRoutes } from "./route";

const ORIGIN = "http://localhost:3000";

function get(path: string) {
  return GET(new NextRequest(new URL(`/api/auth${path}`, ORIGIN)));
}

function post(path: string, body?: unknown) {
  return POST(
    new NextRequest(new URL(`/api/auth${path}`, ORIGIN), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  );
}

describe("auth catch-all route allowlist", () => {
  describe("allowedAuthRoutes", () => {
    it("pins the exact allowed set", () => {
      expect(allowedAuthRoutes).toEqual({
        GET: ["/get-session", "/callback/ministry-platform"],
        POST: ["/sign-in/social"],
      });
    });
  });

  describe("allowed endpoints reach better-auth", () => {
    it("GET /get-session is not 404 (control — with no cookie better-auth returns 200 with a null body)", async () => {
      const response = await get("/get-session");
      expect(response.status).not.toBe(404);
    });

    it("POST /sign-in/social is not 404 (reaches better-auth's real handler)", async () => {
      const response = await post("/sign-in/social", {
        provider: "ministry-platform",
      });
      expect(response.status).not.toBe(404);
    });
  });

  describe("everything else 404s without reaching better-auth", () => {
    it("GET /list-accounts", async () => {
      const response = await get("/list-accounts");
      expect(response.status).toBe(404);
    });

    it("POST /get-access-token", async () => {
      const response = await post("/get-access-token");
      expect(response.status).toBe(404);
    });

    it("POST /sign-out", async () => {
      const response = await post("/sign-out");
      expect(response.status).toBe(404);
    });

    it("GET /error", async () => {
      const response = await get("/error");
      expect(response.status).toBe(404);
    });

    it("GET /ok", async () => {
      const response = await get("/ok");
      expect(response.status).toBe(404);
    });

    it("POST /update-user", async () => {
      const response = await post("/update-user", {});
      expect(response.status).toBe(404);
    });

    it("POST /callback/ministry-platform (wrong method — the callback is GET only here; better-auth also registers POST for form_post providers, which MP does not use)", async () => {
      const response = await post("/callback/ministry-platform");
      expect(response.status).toBe(404);
    });
  });

  describe("trailing-slash and prefix tricks do not bypass exact matching", () => {
    it("GET /get-session/ (trailing slash) is treated as the same path by our allowlist", async () => {
      // Our own matching strips the trailing slash, so this path is NOT
      // rejected by allowedAuthRoutes (unlike /get-sessionX below) — it is let
      // through to better-auth exactly as /get-session would be. better-auth's
      // own router does its own exact-path match with no slash-stripping, so it
      // 404s this particular request itself; that 404 comes from better-auth,
      // not from a gap in our allowlist. Real callers (authClient) never add a
      // trailing slash, so this is not a functional concern.
      const allowedResponse = await get("/get-session");
      const trailingSlashResponse = await get("/get-session/");
      expect(allowedResponse.status).not.toBe(404);
      expect(trailingSlashResponse.status).toBe(404);
    });

    it("GET /get-sessionX does not match /get-session", async () => {
      const response = await get("/get-sessionX");
      expect(response.status).toBe(404);
    });

    it("GET /get-session/../list-accounts does not reach list-accounts", async () => {
      // NextRequest/URL normalizes ".." before pathname is ever read, so this
      // resolves to /api/auth/list-accounts — which is correctly NOT allowed.
      // The request must never resolve to /get-session instead.
      const request = new NextRequest(
        new URL("/api/auth/get-session/../list-accounts", ORIGIN),
      );
      expect(request.nextUrl.pathname).toBe("/api/auth/list-accounts");

      const response = await GET(request);
      expect(response.status).toBe(404);
    });

    it("GET //get-session (doubled leading slash) does not match", async () => {
      const request = new NextRequest(new URL("/api/auth//get-session", ORIGIN));
      const response = await GET(request);
      expect(response.status).toBe(404);
    });
  });

  it("adds no extra exports Next.js would treat as route config", async () => {
    const mod = await import("./route");
    expect(Object.keys(mod).sort()).toEqual(["GET", "POST", "allowedAuthRoutes"]);
  });
});
