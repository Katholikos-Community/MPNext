import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockGetMpTimezone, mockGetInstance, mockGetSession } = vi.hoisted(() => {
  const getMpTimezone = vi.fn();
  return {
    mockGetMpTimezone: getMpTimezone,
    mockGetInstance: vi.fn(() => ({ getMpTimezone })),
    mockGetSession: vi.fn(),
  };
});

vi.mock('@/services/domainTimezoneService', () => ({
  DomainTimezoneService: {
    getInstance: mockGetInstance,
  },
}));

vi.mock('@/lib/auth', () => ({
  auth: { api: { getSession: mockGetSession } },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

import { getMpTimezone } from '@/components/shared-actions/domain';

/**
 * getMpTimezone action Tests
 *
 * Thin server action over DomainTimezoneService. It exists so client components
 * can drive Intl.DateTimeFormat with the MP domain zone rather than the browser
 * zone - per CLAUDE.md, MP stores wall-clock values in the domain time zone, so
 * rendering them in the viewer's zone shifts every displayed timestamp.
 *
 * Worth pinning: the action resolves the singleton per call (not at module load)
 * and does not swallow failures into a silent fallback zone, which would render
 * wrong times rather than surfacing the problem.
 *
 * It also requires an authenticated session (F11, 2026-09-12). This was the
 * last server action in the app with no check at all, and a compiled server
 * action is a callable POST endpoint. A session check rather than the full role
 * gate is deliberate: the value is one domain-wide configuration string, not
 * per-person data, and its only consumer is the already role-gated contact
 * detail page.
 */
describe('getMpTimezone action', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSession.mockResolvedValue({ user: { id: 'internal-id' } });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should return the IANA zone resolved by DomainTimezoneService', async () => {
    mockGetMpTimezone.mockResolvedValueOnce('America/New_York');

    await expect(getMpTimezone()).resolves.toBe('America/New_York');

    expect(mockGetInstance).toHaveBeenCalledTimes(1);
    expect(mockGetMpTimezone).toHaveBeenCalledTimes(1);
  });

  it('should resolve the service on each call rather than caching a stale instance', async () => {
    mockGetMpTimezone.mockResolvedValue('America/Chicago');

    await getMpTimezone();
    await getMpTimezone();

    expect(mockGetInstance).toHaveBeenCalledTimes(2);
  });

  it('should propagate service failures instead of falling back to a default zone', async () => {
    mockGetMpTimezone.mockRejectedValueOnce(new Error('Failed to resolve MP time zone'));

    await expect(getMpTimezone()).rejects.toThrow('Failed to resolve MP time zone');
  });

  describe('authentication', () => {
    it('rejects an anonymous caller before resolving the service', async () => {
      mockGetSession.mockResolvedValueOnce(null);

      await expect(getMpTimezone()).rejects.toThrow('Authentication required');
      expect(mockGetInstance).not.toHaveBeenCalled();
      expect(mockGetMpTimezone).not.toHaveBeenCalled();
    });

    it('rejects a session carrying no user id', async () => {
      mockGetSession.mockResolvedValueOnce({ user: {} });

      await expect(getMpTimezone()).rejects.toThrow('Authentication required');
      expect(mockGetMpTimezone).not.toHaveBeenCalled();
    });
  });
});
