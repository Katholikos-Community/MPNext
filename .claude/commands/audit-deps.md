# Dependency Audit Command

Review package.json for security vulnerabilities and available updates.

> **No Ministry Platform writes.** This command only touches local dependencies
> (`node_modules`, `package.json`, `package-lock.json`). It never reads or writes
> MP data, so the MP Data Safety rule in CLAUDE.md is not triggered here.

## Instructions

Perform a comprehensive security and update audit of the project's dependencies:

### 0. Sync check FIRST (do this before anything else)

The installed tree is frequently **stale** relative to `package.json` (someone bumped
a range but didn't reinstall). Auditing a stale tree produces misleading results.

- Run `npm ls 2>&1 | grep -i invalid` — any `invalid:` markers mean the installed
  version doesn't satisfy `package.json`. If found, run `npm install` and re-check.
- To confirm `package.json` and the lockfile are in sync, run `npm ci` (it fails loudly
  if they've diverged). If `npm ci` errors, run `npm install` to regenerate the lock,
  then investigate the diff before proceeding.
- Only audit **after** the tree matches `package.json`.

### 1. Vulnerability Analysis
- Run `npm audit` to identify known vulnerabilities
- Search the web for recent CVEs affecting the key dependencies listed below
- For each finding, assess **actual exposure**, not just the advisory range:
  - Is the vulnerable code path even used? (e.g. a Better Auth `oidc-provider`/`mcp`
    advisory does **not** apply here — this app only uses the `genericOAuth` client.)
  - Is it dev/build-time only (vitest, vite, esbuild, tsx) vs. runtime/shipped?
  - Is it Windows-only? (several esbuild/vite advisories are.)
- Classify by severity (Critical, High, Moderate, Low) **and** by real-world risk.

### 2. Update Analysis
- Run `npm outdated` to identify available updates
- Categorize updates as:
  - **Safe updates**: Patch and minor versions within existing `^` ranges — usually
    applied automatically by `npm install` / `npm audit fix`.
  - **Major updates**: Require evaluation of breaking changes, peer-dependency support,
    and migration effort. Do **not** apply blindly (see §5 gotchas).

### 3. Use Context7
- Query Context7 for migration guides and breaking changes for any major version updates
- Check official documentation for upgrade paths

### 4. Generate Report
Provide a structured report with:

#### Security Issues (by severity)
- Critical/High: Immediate action required with specific fix commands
- Moderate/Low: Assessment of risk and recommended timeline
- **Call out false positives explicitly** (see §5) so they aren't "fixed" later.

#### Recommended Updates
| Package | Current | Latest | Risk Level | Notes |
|---------|---------|--------|------------|-------|

#### Action Plan
1. **Urgent**: Commands to fix critical vulnerabilities
2. **Soon**: Safe updates to apply
3. **Plan for**: Major version upgrades requiring testing

### 5. Execution — safe procedure & known gotchas

If the user requests execution, follow this exact order:

1. `npm install` — syncs the tree to `package.json` ranges (fixes most in-range vulns).
2. `npm audit fix` — applies remaining in-range security patches.
   - **NEVER run `npm audit fix --force`.** In this repo it tries to "fix" a
     `postcss` advisory by downgrading **`next` to 9.3.3** — a catastrophic breaking
     downgrade. `--force` is banned for this command.
3. Verify (all three, in order):
   - `npm run build` (Turbopack build + TypeScript check)
   - `npm run lint`
   - `npm run test:run` (Vitest single run)
4. Report final `npm audit` count and the verification results.

**Known false positive — do not try to eliminate it:**
- `npm audit` reports 2 moderate `postcss` findings under `node_modules/next/...`.
  This is the `postcss` copy **bundled inside Next.js**, not the app's direct dep
  (which is already patched). Next controls it; the only offered fix is the `--force`
  downgrade above. Leave these 2 as accepted/known.

**Major version bumps — verify toolchain compatibility, revert cleanly on failure:**
- Bump the version in `package.json`, then `npm install`. Watch for `ERESOLVE` peer
  warnings and `invalid:` markers in `npm ls <pkg>` — these mean surrounding tooling
  hasn't adopted the new major.
- Always run `npm run build` after a major bump. If it fails, **revert**:
  restore `package.json`, then `git checkout package-lock.json`, then `npm install`,
  and confirm `git status` is clean and the build passes again.
- **Currently blocked (verified, do not retry without upstream support):**
  - **TypeScript 7** — breaks the Next.js 16 build worker and is rejected by
    `typescript-eslint` (peer capped `<6.1.0`). Stay on TypeScript 6.
  - **ESLint 10**, **@types/node 26** — outside current ranges; evaluate individually.

## Key Dependencies to Always Check (this repo's actual stack)
- **next** — framework; security-critical, runtime. (No `next-auth` — see Better Auth.)
- **react / react-dom** — core framework, runtime.
- **better-auth** — authentication (OAuth client via `genericOAuth`). Auth/crypto-critical.
  Check advisories, but confirm whether they apply to the `oidc-provider`/`mcp` plugins
  (not used here) vs. the client path (used here).
- **zod** — validation at API boundaries.
- **openai** — API client (used in tooling/scripts).
- **Radix UI / lucide-react / tailwindcss** — UI; low security risk, watch for breaking majors.
- **vitest / vite / esbuild / tsx / jsdom** — dev/build tooling; most advisories here are
  dev-only and often Windows-only. Weigh accordingly.

> Note: this project has **no** `next-auth`, `jsonwebtoken`, `bcryptjs`, Drizzle, or AWS
> SDK. Don't chase those.
