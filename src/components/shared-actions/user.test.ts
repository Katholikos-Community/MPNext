import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGetUserProfile, mockGetSession, mockHasSecurityRole } = vi.hoisted(() => ({
  mockGetUserProfile: vi.fn(),
  mockGetSession: vi.fn(),
  mockHasSecurityRole: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  auth: {
    api: {
      getSession: mockGetSession,
    },
  },
}));

vi.mock('next/headers', () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock('@/services/userService', () => ({
  UserService: {
    getInstance: vi.fn().mockResolvedValue({
      getUserProfile: mockGetUserProfile,
    }),
  },
}));

vi.mock('@/services/authorizationService', () => ({
  AuthorizationService: {
    getInstance: () => ({
      hasSecurityRole: mockHasSecurityRole,
    }),
  },
}));

import { getCurrentUserProfile } from './user';

const mockAuthSession = {
  user: { id: 'internal-id', userGuid: 'guid-123' },
};

const mockProfile = {
  User_ID: 1,
  User_GUID: 'guid-123',
  Contact_ID: 100,
  First_Name: 'John',
  Nickname: 'Johnny',
  Last_Name: 'Doe',
  Email_Address: 'john@example.com',
  Mobile_Phone: null,
  Image_GUID: null,
  roles: ['Admin'],
  userGroups: ['Staff'],
};

describe('getCurrentUserProfile', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a role-holder. The profile load itself never depends on this —
    // any MP user may sign in and see the app shell.
    mockHasSecurityRole.mockResolvedValue({ permitted: true, userId: 1, reason: null });
  });

  it('should require authentication', async () => {
    mockGetSession.mockResolvedValueOnce(null);

    await expect(getCurrentUserProfile()).rejects.toThrow('Authentication required');
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it('should reject a session with no user id', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { userGuid: 'guid-123' } });

    await expect(getCurrentUserProfile()).rejects.toThrow('Authentication required');
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it('should reject an authenticated session that carries no userGuid', async () => {
    mockGetSession.mockResolvedValueOnce({ user: { id: 'internal-id' } });

    await expect(getCurrentUserProfile()).rejects.toThrow('User GUID not found in session');
    expect(mockGetUserProfile).not.toHaveBeenCalled();
  });

  it("should look up the profile using the session's own User_GUID", async () => {
    mockGetSession.mockResolvedValueOnce(mockAuthSession);
    mockGetUserProfile.mockResolvedValueOnce(mockProfile);

    const result = await getCurrentUserProfile();

    expect(mockGetUserProfile).toHaveBeenCalledWith('guid-123');
    expect(result).toEqual({ ...mockProfile, canAccessContactFeatures: true });
  });

  it('should ignore any caller-supplied GUID and use the session GUID', async () => {
    mockGetSession.mockResolvedValueOnce(mockAuthSession);
    mockGetUserProfile.mockResolvedValueOnce(mockProfile);

    // A hostile caller can still POST an argument at the compiled endpoint; the
    // action takes no parameters, so the victim's GUID must never be used.
    await (getCurrentUserProfile as unknown as (id: string) => Promise<unknown>)(
      'someone-elses-guid'
    );

    expect(mockGetUserProfile).toHaveBeenCalledWith('guid-123');
    expect(mockGetUserProfile).not.toHaveBeenCalledWith('someone-elses-guid');
  });

  it('should return undefined when MP has no matching user', async () => {
    mockGetSession.mockResolvedValueOnce(mockAuthSession);
    mockGetUserProfile.mockResolvedValueOnce(undefined);

    await expect(getCurrentUserProfile()).resolves.toBeUndefined();
  });

  it('should propagate errors', async () => {
    mockGetSession.mockResolvedValueOnce(mockAuthSession);
    mockGetUserProfile.mockRejectedValueOnce(new Error('Service error'));

    await expect(getCurrentUserProfile()).rejects.toThrow('Service error');
  });

  /**
   * `canAccessContactFeatures` is what the sidebar and the dashboard tile read
   * to decide whether to render a link into the contact features. It is UX
   * only — every gated layer re-checks — but it must be computed SERVER-SIDE
   * from the same gate, never derived on the client from `roles`, or the nav
   * and the enforcement can drift apart.
   */
  describe('canAccessContactFeatures', () => {
    it('is true when the gate permits the user', async () => {
      mockGetSession.mockResolvedValueOnce(mockAuthSession);
      mockGetUserProfile.mockResolvedValueOnce(mockProfile);
      mockHasSecurityRole.mockResolvedValueOnce({
        permitted: true,
        userId: 1,
        reason: null,
      });

      const result = await getCurrentUserProfile();

      expect(result?.canAccessContactFeatures).toBe(true);
      expect(mockHasSecurityRole).toHaveBeenCalledWith({
        table: 'Contacts',
        operation: 'read',
      });
    });

    it('is false for a signed-in user holding no security role', async () => {
      mockGetSession.mockResolvedValueOnce(mockAuthSession);
      mockGetUserProfile.mockResolvedValueOnce({ ...mockProfile, roles: [] });
      mockHasSecurityRole.mockResolvedValueOnce({
        permitted: false,
        userId: 1,
        reason: 'no_security_role',
      });

      const result = await getCurrentUserProfile();

      expect(result?.canAccessContactFeatures).toBe(false);
    });

    it('still returns the profile for a role-less user — they keep the app shell', async () => {
      // POLICY: any MP user may sign in. A role-less session must still load
      // its own profile, or the header avatar and the sign-out menu vanish.
      mockGetSession.mockResolvedValueOnce(mockAuthSession);
      mockGetUserProfile.mockResolvedValueOnce({ ...mockProfile, roles: [] });
      mockHasSecurityRole.mockResolvedValueOnce({
        permitted: false,
        userId: 1,
        reason: 'no_security_role',
      });

      const result = await getCurrentUserProfile();

      expect(result).toMatchObject({ User_ID: 1, First_Name: 'John' });
    });

    it('uses the non-throwing gate so a refusal never breaks the shell', async () => {
      mockGetSession.mockResolvedValueOnce(mockAuthSession);
      mockGetUserProfile.mockResolvedValueOnce(mockProfile);
      mockHasSecurityRole.mockResolvedValueOnce({
        permitted: false,
        userId: null,
        reason: 'no_mp_user',
      });

      await expect(getCurrentUserProfile()).resolves.toMatchObject({
        canAccessContactFeatures: false,
      });
    });

    it('does not consult the gate when MP has no matching user', async () => {
      mockGetSession.mockResolvedValueOnce(mockAuthSession);
      mockGetUserProfile.mockResolvedValueOnce(undefined);

      await expect(getCurrentUserProfile()).resolves.toBeUndefined();
      expect(mockHasSecurityRole).not.toHaveBeenCalled();
    });
  });
});
