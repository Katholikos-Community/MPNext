# TODO: Investigate `@emnapi/*` lockfile drift on Windows `npm install`

**Created:** 2026-05-17
**Severity:** Annoying — CI breaks every time someone bumps a dep on Windows.
**Workaround in place:** Manually re-add the four `@emnapi/*` lockfile entries by hand after every Windows `npm install`. Tracked by commits `dc5e439` and the follow-up patch after `ecaa009`.

## Symptom

CI `npm ci` on Ubuntu fails with:

```
npm error Missing: @emnapi/runtime@1.10.0 from lock file
npm error Missing: @emnapi/core@1.10.0 from lock file
```

…immediately after a dep bump that was prepared on Windows. The same pattern has now hit twice:

- `bdd2e47` (npm dedupe on Windows) → fixed by `dc5e439`
- `ecaa009` (tsx + @vitejs/plugin-react bump on Windows) → fixed by the follow-up commit to this TODO

## Hypothesis

The `@emnapi/core` and `@emnapi/runtime` packages are pulled in as **optional, peer** deps of `@rolldown/binding-wasm32-wasi` (a Linux-only optional dep). When `npm install` runs on Windows, npm prunes them out of the lockfile because the parent `@rolldown/binding-wasm32-wasi` doesn't resolve on Windows. CI on Linux then reads `package.json`, sees the requirement, and the lockfile is "missing" entries → `npm ci` refuses to proceed.

## Things to try

1. **`npm install --include=optional`** on Windows — does this preserve the Linux-only optional graph? If yes, document it as the required install command and add to CLAUDE.md / contributing guide.
2. **`npm install --os=linux --cpu=x64`** — force npm to resolve the lockfile as if it were Linux. This was reportedly used in `e6da5c5` (referenced by `dc5e439`'s commit message) and produced a passing main commit.
3. **Move all dep-bump work to a Linux container or WSL** so lockfiles are always generated against the CI platform.
4. **Pre-commit hook or CI guard** that detects the four missing `@emnapi/*` lockfile entries and fails fast (or auto-restores them) before they reach `main`. Cheap insurance even if we pick option 1 or 2.
5. **Investigate whether `@tailwindcss/oxide-wasm32-wasi` and `@rolldown/binding-wasm32-wasi` are actually needed** — if neither is being used at build/runtime, removing them eliminates the source of the optional/peer entanglement.

## How to verify a fix

After applying a candidate fix on Windows:

```pwsh
Remove-Item -Recurse -Force node_modules
npm install            # or whatever variant is being tested
git diff package-lock.json   # the @emnapi/core and @emnapi/runtime entries should still be present
```

Then push to a branch and confirm CI's `npm ci` step succeeds on Ubuntu.

## References

- `dc5e439` — prior manual fix with full context in commit message
- `bdd2e47` — original drift introduction (npm dedupe)
- `ecaa009` — second drift introduction (this incident)
- CI run that failed: https://github.com/MinistryPlatform-Community/MPNext/actions/runs/25991275743
