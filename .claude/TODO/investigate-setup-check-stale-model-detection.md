# TODO: `setup:check` cannot detect stale or never-regenerated Ministry Platform models

**Created:** 2026-05-21
**Severity:** Misleading — `setup:check` reports green when the on-disk models do not actually match the configured MP instance.
**Reported by:** Customer walkthrough #4, 2026-05-21.

## Symptom

When the interactive `npm run setup` flow fails at step 8 (type generation) — for example, because `MINISTRY_PLATFORM_CLIENT_SECRET` is wrong — the script leaves the **previously committed 603 generated model files on disk untouched**. Running `npm run setup:check` immediately afterward then reports:

```
6 passed, 2 warnings, 0 failed
```

…because the `setup:check` validation counts files in `src/lib/providers/ministry-platform/models/` and finds the expected number. It has no way to know:

1. Those files were generated against a **different** MP instance (the repo's reference instance, not the customer's).
2. The customer's credentials never successfully produced a single generated file.
3. The build step "passed" against those stale models, so the customer's app will type-check against the wrong schema.

A customer who hits this sequence sees a green `setup:check` and reasonably concludes their environment is healthy when it is not.

## Why this matters

- The whole point of `setup:check` is to be a quick "is this environment correctly configured" command. Right now it can be lying.
- The failure mode is silent: `setup:check` is green, build is green, `npm run dev` will probably even start. The customer only discovers the problem when their data shapes don't match the generated types — which may be far away from the cause in time and frustration.
- This compounds the type-gen error truncation issue (fixed in commit `b022be5`): even with the real OAuth error now visible, a customer who misses it and runs `setup:check` will be told everything is fine.

## Possible approaches

In rough order from least to most invasive:

1. **Compare model directory mtime to `.env.local` mtime.** If `.env.local` is newer than every file in `models/`, flag a warning: "Environment changed since types were last generated — run `npm run mp:generate:models`". Cheap, doesn't make a network call. Doesn't catch the case where `.env.local` is wrong from the start.
2. **Look for a per-instance signature inside the models.** Embed the MP host (or a hash of it) into a generated `MODELS_PROVENANCE.json` at type-gen time, then have `setup:check` read it and verify it matches the current `.env.local`. Catches the cross-instance staleness case. Requires changes to the type generator too.
3. **Issue a single low-cost authenticated metadata call** in `setup:check` (e.g., `GET /tables?$top=1`) to confirm the credentials in `.env.local` actually work. Catches both "wrong credentials" and "credentials work but models are from a different instance" when combined with approach 2. Adds network dependency to `setup:check`.
4. **Record the result of the last `mp:generate:models` run.** Write a timestamp and exit code to a `.setup-state.json` (gitignored). `setup:check` reads it and warns if the last generate run failed or never ran. Doesn't catch out-of-band schema changes but does catch the customer's exact scenario.

Approach 4 is the smallest change. Approach 2 is the most accurate. Approach 3 might be overkill for a check command.

## How to verify a fix

1. Clone the repo fresh (so committed models are present).
2. Configure `.env.local` with **deliberately wrong** `MINISTRY_PLATFORM_CLIENT_SECRET`.
3. Run `npm run setup` and observe type generation fail.
4. Run `npm run setup:check`. Today: green. After fix: should warn or fail with an explanation of which check triggered (mtime mismatch, provenance mismatch, network probe failure, or last-run state).

## Out of scope

- Don't change the **type generator** itself in this work unless approach 2 is chosen — keep the change scoped to the check command and (if needed) a small provenance file.
- Don't auto-regenerate from `setup:check`. The check should report, not mutate.

## References

- Commit `b022be5` — fixes the truncated type-gen error and the dishonest "Setup Complete!" summary. This TODO is the next layer of the same customer journey.
- `scripts/setup.ts` — `runSetupCheck` function and its dependents.
- `src/lib/providers/ministry-platform/scripts/generate-types.ts` — type generator (touch only if approach 2 is chosen).
