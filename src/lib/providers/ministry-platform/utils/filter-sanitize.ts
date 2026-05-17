/**
 * Filter sanitization utilities for Ministry Platform REST API queries.
 *
 * The MP API accepts an OData-style $filter parameter that maps to SQL WHERE clauses.
 * All values interpolated into filter strings MUST be sanitized to prevent filter injection.
 */

/**
 * Escapes a string value for safe interpolation inside a single-quoted filter value.
 * Doubles single quotes (SQL standard escaping) so that input like O'Brien
 * becomes O''Brien and cannot break out of the quoted context.
 *
 * Use for equality comparisons: `Column = '${sanitizeFilterValue(value)}'`.
 * For LIKE patterns, use {@link sanitizeLikeValue} instead.
 */
export function sanitizeFilterValue(value: string): string {
  return value.replace(/'/g, "''");
}

/**
 * Escapes a string value for safe interpolation inside a LIKE pattern.
 * Escapes the SQL LIKE wildcards (`%`, `_`) and the backslash escape character
 * itself, then doubles single quotes for string-literal escaping. Callers MUST
 * include `ESCAPE '\'` in the LIKE clause for the escapes to be honored, e.g.
 * `Column LIKE '%${sanitizeLikeValue(value)}%' ESCAPE '\\'`.
 */
export function sanitizeLikeValue(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_")
    .replace(/'/g, "''");
}

/**
 * Validates a GUID/UUID string format and returns the sanitized value.
 * Accepts any UUID variant (v1–v5) — Ministry Platform GUIDs are not guaranteed
 * to be v4. Throws if the value does not match the canonical 8-4-4-4-12 hex format.
 */
export function sanitizeGuid(guid: string): string {
  const guidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!guidRegex.test(guid)) {
    throw new Error('Invalid GUID format');
  }
  return guid;
}
