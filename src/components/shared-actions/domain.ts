'use server';

import { DomainTimezoneService } from '@/services/domainTimezoneService';
import { auth } from '@/lib/auth';
import { headers } from 'next/headers';

/**
 * Returns the IANA time zone identifier for the active Ministry Platform
 * domain. Use this to drive any client-side `Intl.DateTimeFormat` rendering
 * of MP-sourced datetime values so the displayed wall-clock matches MP's
 * database regardless of the user's browser zone.
 *
 * Requires an authenticated session (F11, 2026-09-12 — this was the last
 * server action in the app with no check at all, and a compiled server action
 * is a callable POST endpoint). A session check is sufficient here rather than
 * the full `AuthorizationService` role gate: the value is a single domain-wide
 * configuration string, not per-person data, and its only consumer is the
 * already role-gated contact detail page.
 *
 * Result is cached for the lifetime of the server process.
 */
export async function getMpTimezone(): Promise<string> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session?.user?.id) {
    throw new Error('Authentication required');
  }

  const tz = DomainTimezoneService.getInstance();
  return tz.getMpTimezone();
}
