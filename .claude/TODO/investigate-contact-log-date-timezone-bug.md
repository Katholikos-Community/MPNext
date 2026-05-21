# TODO: Contact Log entries save with wrong date/time (timezone bug)

**Created:** 2026-05-21
**Severity:** Real customer-facing data bug — entries appear on the wrong day, and editing makes it worse.
**Reported by:** Customer feedback on `/contactlookup` demo app, 2026-05-20.

## Symptom

- Customer created a Contact Log entry at approximately **11:33 PM on 2026-05-17**.
- The saved record displayed as **2026-05-16 at 8:00 PM** — wrong by ~27.5 hours.
- **Editing** the same entry shifted it back an **additional day** (so the displayed date moved further into the past with each edit).

The pattern (off by a day + edits compound the drift) strongly suggests a double UTC conversion: a value that is already UTC is being treated as local time and re-converted, and the edit path re-runs the same conversion on the already-shifted value.

## Where to look

Likely suspects, in order:

1. **`src/components/contact-logs/contact-logs.tsx`** — date input handling. Check whether the date is being read as a local-time `Date` and then passed through `.toISOString()` (which subtracts the local offset). On a US time zone at 11:33 PM, `toISOString()` of a date constructed as `new Date('2026-05-17')` (midnight local) would yield `2026-05-17T05:00:00Z` ish — but if instead a `Date` object is being built from already-UTC strings and `.toISOString()`'d again, the offset doubles.
2. **`src/components/contact-logs/actions.ts`** — server action that calls the service. Verify what string format is being sent to MP.
3. **`src/services/contactLogService.ts`** — the service wrapper. Check if any normalization happens here.
4. **Edit flow** — separately verify whether the edit form initializes from the stored value (already UTC) by treating it as local. That would explain why **each edit shifts another day**.

## Things to check

- What does the `Contact_Date` field expect on the MP side? (MP typically stores datetimes in the instance's configured time zone, not UTC — this is a common source of mismatch.)
- Is there a `new Date(stringFromMP)` happening anywhere on the read path that's being re-serialized with `.toISOString()` on the write path?
- Does the date input component use `<input type="datetime-local">` (local) vs `<input type="datetime">` (deprecated) vs a library that has its own zone handling?
- Does any code path call `.toISOString()` on a value that already came back as ISO from MP?

## How to reproduce

1. Sign in to the demo app.
2. Look up a contact via `/contactlookup`.
3. Open Contact Logs for that contact.
4. Add a new log entry late in the day (e.g., after 10 PM local).
5. Save and observe the displayed date/time vs what was entered.
6. Edit the saved entry without changing any fields, save again, and observe whether the date drifts further.

## Out of scope / related

- The **`Feedback_Entry_ID` error in Contact Lookup search** is a known, separate issue (discussed in Office Hours) — not this TODO.
- Once fixed, add a regression test in `src/components/contact-logs/` that creates a log at a fixed instant and asserts round-trip equality.
