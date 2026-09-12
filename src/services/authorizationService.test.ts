import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * AuthorizationService tests.
 *
 * These encode the decided policy (see `.claude/references/auth.md`): any
 * authenticated user holding an MP security role may read and write contact
 * data; a user with no role may sign in but may do neither; ownership is not a
 * factor; the gate fails closed when the acting MP user or the role list cannot
 * be established.
 *
 * Reads were added to the gate on 2026-09-12 (F1). The read half is the part
 * worth being paranoid about: MP data is fetched with this app's
 * client-credentials service account, so if this gate says yes the data is
 * returned regardless of what MP itself would have let the user see.
 */

const { mockGetTableRecords, mockGetActingUserIdForWrite, mockGetCurrentUserId } =
  vi.hoisted(() => ({
    mockGetTableRecords: vi.fn(),
    mockGetActingUserIdForWrite: vi.fn(),
    mockGetCurrentUserId: vi.fn(),
  }));

vi.mock("@/lib/providers/ministry-platform", () => ({
  MPHelper: class {
    getTableRecords = mockGetTableRecords;
  },
}));

vi.mock("@/services/sessionContextService", () => ({
  SessionContextService: {
    getInstance: () => ({
      getActingUserIdForWrite: mockGetActingUserIdForWrite,
      getCurrentUserId: mockGetCurrentUserId,
    }),
  },
}));

import { AuthorizationService, UnauthorizedError } from "./authorizationService";

const WRITE_CTX = { table: "Contact_Log", operation: "create" as const };
const READ_CTX = { table: "Contacts", operation: "read" as const };

describe("AuthorizationService", () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the singleton so a stale MPHelper never leaks between tests.
    (AuthorizationService as unknown as { instance: unknown }).instance = undefined;
    delete process.env.MP_SECURITY_ROLES;
    delete process.env.MP_WRITE_SECURITY_ROLES;
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    delete process.env.MP_SECURITY_ROLES;
    delete process.env.MP_WRITE_SECURITY_ROLES;
  });

  describe("getInstance", () => {
    it("returns the same instance on repeat calls", () => {
      expect(AuthorizationService.getInstance()).toBe(AuthorizationService.getInstance());
    });
  });

  describe("getSecurityRoles", () => {
    it("queries dp_User_Roles for the given User_ID and returns role names", async () => {
      mockGetTableRecords.mockResolvedValueOnce([
        { Role_Name: "Administrators" },
        { Role_Name: "Pastoral Staff" },
      ]);

      const roles = await AuthorizationService.getInstance().getSecurityRoles(99);

      expect(mockGetTableRecords).toHaveBeenCalledWith({
        table: "dp_User_Roles",
        filter: "User_ID = 99",
        select: "Role_ID_TABLE.Role_Name",
      });
      expect(roles).toEqual(["Administrators", "Pastoral Staff"]);
    });

    it("returns an empty array when the user holds no roles", async () => {
      mockGetTableRecords.mockResolvedValueOnce([]);
      expect(await AuthorizationService.getInstance().getSecurityRoles(99)).toEqual([]);
    });

    it("drops null and blank role names rather than treating them as roles", async () => {
      // A blank Role_Name must not satisfy the "holds any security role" check.
      mockGetTableRecords.mockResolvedValueOnce([
        { Role_Name: null },
        { Role_Name: "   " },
        { Role_Name: "Administrators" },
      ]);

      expect(await AuthorizationService.getInstance().getSecurityRoles(99)).toEqual([
        "Administrators",
      ]);
    });

    it("tolerates a nullish response from MP", async () => {
      mockGetTableRecords.mockResolvedValueOnce(undefined);
      expect(await AuthorizationService.getInstance().getSecurityRoles(99)).toEqual([]);
    });

    it.each([0, -1, 1.5, NaN])(
      "refuses to interpolate a non-positive-integer User_ID (%s)",
      async (badId) => {
        await expect(
          AuthorizationService.getInstance().getSecurityRoles(badId)
        ).rejects.toThrow(UnauthorizedError);
        expect(mockGetTableRecords).not.toHaveBeenCalled();
      }
    );

    it("validates the User_ID before the per-request memo sees it", async () => {
      // A rejected ID must never become a cache key, valid-looking or not.
      await expect(
        AuthorizationService.getInstance().getSecurityRoles(-5)
      ).rejects.toThrow(/not a valid identifier/);
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });
  });

  /**
   * Per-request memoization is React `cache()`. Outside a React request scope —
   * which is every test in this file, and any plain Node caller — `cache()` is
   * a passthrough: React calls through when no cache dispatcher is installed.
   * So these assertions describe the UNCACHED behavior, which is exactly the
   * behavior that must hold in both environments: no decision is ever carried
   * across requests, and a revoked role is effective on the next request.
   */
  describe("role lookup memoization", () => {
    it("re-reads roles on each call outside a React request scope", async () => {
      mockGetTableRecords.mockResolvedValue([{ Role_Name: "Administrators" }]);
      const svc = AuthorizationService.getInstance();

      await svc.getSecurityRoles(99);
      await svc.getSecurityRoles(99);

      expect(mockGetTableRecords).toHaveBeenCalledTimes(2);
    });

    it("exposes the uncached MP read the memo is built on", async () => {
      mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Administrators" }]);

      await expect(
        AuthorizationService.getInstance().readSecurityRolesFromMp(99)
      ).resolves.toEqual(["Administrators"]);
    });
  });

  describe("hasSecurityRole (non-throwing form)", () => {
    it("reports a permitted read with the acting User_ID and no denial log", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Pastoral Staff" }]);

      const decision = await AuthorizationService.getInstance().hasSecurityRole(READ_CTX);

      expect(decision).toEqual({ permitted: true, userId: 99, reason: null });
      // The UI calls this on every profile load; it must not spam the log.
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("reports a refusal instead of throwing when the user holds no role", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([]);

      const decision = await AuthorizationService.getInstance().hasSecurityRole(READ_CTX);

      expect(decision).toEqual({ permitted: false, userId: 99, reason: "no_security_role" });
      expect(warnSpy).not.toHaveBeenCalled();
    });

    it("reports no_mp_user when the session carries no MP user", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(null);

      const decision = await AuthorizationService.getInstance().hasSecurityRole(READ_CTX);

      expect(decision).toEqual({ permitted: false, userId: null, reason: "no_mp_user" });
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });

    it("still throws when MP itself fails, so 'down' never reads as 'denied'", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(99);
      mockGetTableRecords.mockRejectedValueOnce(new Error("MP unavailable"));

      await expect(
        AuthorizationService.getInstance().hasSecurityRole(READ_CTX)
      ).rejects.toThrow("MP unavailable");
    });

    it("resolves a read's acting user without the write-attribution warning", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Administrators" }]);

      await AuthorizationService.getInstance().hasSecurityRole(READ_CTX);

      expect(mockGetCurrentUserId).toHaveBeenCalledTimes(1);
      expect(mockGetActingUserIdForWrite).not.toHaveBeenCalled();
    });

    it("routes a write through getActingUserIdForWrite so mp.write.non_user still fires", async () => {
      mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Administrators" }]);

      await AuthorizationService.getInstance().hasSecurityRole(WRITE_CTX);

      expect(mockGetActingUserIdForWrite).toHaveBeenCalledWith(WRITE_CTX);
      expect(mockGetCurrentUserId).not.toHaveBeenCalled();
    });
  });

  describe("requireSecurityRole — reads", () => {
    it("returns the acting User_ID when the user holds any security role", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Pastoral Staff" }]);

      await expect(
        AuthorizationService.getInstance().requireSecurityRole(READ_CTX)
      ).resolves.toBe(99);
    });

    it("refuses a session with an MP user but zero security roles", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([]);

      await expect(
        AuthorizationService.getInstance().requireSecurityRole(READ_CTX)
      ).rejects.toThrow(/an MP security role is required to read records in Contacts/);
    });

    it("refuses a session with no MP user without even reading roles", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(null);

      await expect(
        AuthorizationService.getInstance().requireSecurityRole(READ_CTX)
      ).rejects.toThrow(/no Ministry Platform user is attached/);
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });

    it("logs a refused read as mp.read.unauthorized, not mp.write.unauthorized", async () => {
      mockGetCurrentUserId.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([]);

      await expect(
        AuthorizationService.getInstance().requireSecurityRole(READ_CTX)
      ).rejects.toThrow(UnauthorizedError);

      const payload = JSON.parse(warnSpy.mock.calls.at(-1)![0] as string);
      expect(payload).toMatchObject({
        event: "mp.read.unauthorized",
        table: "Contacts",
        operation: "read",
        userId: 99,
        reason: "no_security_role",
      });
    });
  });

  describe("requireSecurityRoleForWrite", () => {
    it("returns the acting User_ID when the user holds any security role", async () => {
      mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Pastoral Staff" }]);

      const userId = await AuthorizationService.getInstance().requireSecurityRoleForWrite(
        WRITE_CTX
      );

      expect(userId).toBe(99);
      expect(mockGetActingUserIdForWrite).toHaveBeenCalledWith(WRITE_CTX);
    });

    it("rejects when no MP user is attached to the session", async () => {
      mockGetActingUserIdForWrite.mockResolvedValueOnce(null);

      await expect(
        AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
      ).rejects.toThrow(/no Ministry Platform user is attached/);

      // Fails closed — no role lookup is even attempted.
      expect(mockGetTableRecords).not.toHaveBeenCalled();
    });

    it("rejects an authenticated user who holds no security role", async () => {
      mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([]);

      await expect(
        AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
      ).rejects.toThrow(/an MP security role is required to create records in Contact_Log/);
    });

    it("emits a greppable mp.write.unauthorized warning on denial", async () => {
      mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
      mockGetTableRecords.mockResolvedValueOnce([]);

      await expect(
        AuthorizationService.getInstance().requireSecurityRoleForWrite({
          table: "Contact_Log",
          operation: "delete",
        })
      ).rejects.toThrow(UnauthorizedError);

      const payload = JSON.parse(warnSpy.mock.calls.at(-1)![0] as string);
      expect(payload).toMatchObject({
        event: "mp.write.unauthorized",
        table: "Contact_Log",
        operation: "delete",
        userId: 99,
        reason: "no_security_role",
      });
    });

    it("distinguishes a missing MP user from a missing role in the denial log", async () => {
      mockGetActingUserIdForWrite.mockResolvedValueOnce(null);

      await expect(
        AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
      ).rejects.toThrow(UnauthorizedError);

      const payload = JSON.parse(warnSpy.mock.calls.at(-1)![0] as string);
      expect(payload).toMatchObject({ reason: "no_mp_user", userId: null });
    });

    it("propagates a failed role lookup instead of allowing the write", async () => {
      mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
      mockGetTableRecords.mockRejectedValueOnce(new Error("MP unavailable"));

      await expect(
        AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
      ).rejects.toThrow("MP unavailable");
    });

    it("does not cache the authorization decision across writes", async () => {
      // A revoked role must take effect immediately.
      mockGetActingUserIdForWrite.mockResolvedValue(99);
      mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Administrators" }]);
      const svc = AuthorizationService.getInstance();

      await expect(svc.requireSecurityRoleForWrite(WRITE_CTX)).resolves.toBe(99);

      mockGetTableRecords.mockResolvedValueOnce([]);
      await expect(svc.requireSecurityRoleForWrite(WRITE_CTX)).rejects.toThrow(
        UnauthorizedError
      );
      expect(mockGetTableRecords).toHaveBeenCalledTimes(2);
    });

    describe("MP_SECURITY_ROLES", () => {
      it("permits only the named roles when the env var is set", async () => {
        process.env.MP_SECURITY_ROLES = "Administrators,Pastoral Staff";
        mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Pastoral Staff" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
        ).resolves.toBe(99);
      });

      it("rejects a role that is not on the list", async () => {
        process.env.MP_SECURITY_ROLES = "Administrators";
        mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Volunteer" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
        ).rejects.toThrow(UnauthorizedError);

        const payload = JSON.parse(warnSpy.mock.calls.at(-1)![0] as string);
        expect(payload).toMatchObject({ reason: "role_not_permitted" });
      });

      it("restricts reads as well as writes", async () => {
        process.env.MP_SECURITY_ROLES = "Administrators";
        mockGetCurrentUserId.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Volunteer" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRole(READ_CTX)
        ).rejects.toThrow(UnauthorizedError);

        const payload = JSON.parse(warnSpy.mock.calls.at(-1)![0] as string);
        expect(payload).toMatchObject({
          event: "mp.read.unauthorized",
          reason: "role_not_permitted",
        });
      });

      it("compares role names case- and whitespace-insensitively", async () => {
        process.env.MP_SECURITY_ROLES = "  administrators , Pastoral Staff ";
        mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "ADMINISTRATORS" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
        ).resolves.toBe(99);
      });

      it("falls back to 'any security role' when the env var is blank or all separators", async () => {
        process.env.MP_SECURITY_ROLES = " , , ";
        mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Volunteer" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
        ).resolves.toBe(99);
      });

      it("is read per call, not captured at module load", async () => {
        mockGetActingUserIdForWrite.mockResolvedValue(99);
        mockGetTableRecords.mockResolvedValue([{ Role_Name: "Volunteer" }]);
        const svc = AuthorizationService.getInstance();

        await expect(svc.requireSecurityRoleForWrite(WRITE_CTX)).resolves.toBe(99);

        process.env.MP_SECURITY_ROLES = "Administrators";
        await expect(svc.requireSecurityRoleForWrite(WRITE_CTX)).rejects.toThrow(
          UnauthorizedError
        );
      });
    });

    /**
     * `MP_WRITE_SECURITY_ROLES` predates the read gate and named only writes.
     * It stays readable so an existing deployment is not silently widened to
     * "any role" by this change — but `MP_SECURITY_ROLES` wins where both are
     * set, so a migration is one variable at a time.
     */
    describe("MP_WRITE_SECURITY_ROLES (deprecated fallback)", () => {
      it("still restricts writes when it is the only var set", async () => {
        process.env.MP_WRITE_SECURITY_ROLES = "Administrators";
        mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Volunteer" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
        ).rejects.toThrow(UnauthorizedError);
      });

      it("permits a named role when it is the only var set", async () => {
        process.env.MP_WRITE_SECURITY_ROLES = "Administrators";
        mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Administrators" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
        ).resolves.toBe(99);
      });

      it("now applies to reads too, since the gate is one policy", async () => {
        process.env.MP_WRITE_SECURITY_ROLES = "Administrators";
        mockGetCurrentUserId.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Volunteer" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRole(READ_CTX)
        ).rejects.toThrow(UnauthorizedError);
      });

      it("loses to MP_SECURITY_ROLES when both are set", async () => {
        process.env.MP_SECURITY_ROLES = "Volunteer";
        process.env.MP_WRITE_SECURITY_ROLES = "Administrators";
        mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Volunteer" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
        ).resolves.toBe(99);
      });

      it("is used when MP_SECURITY_ROLES is present but blank", async () => {
        process.env.MP_SECURITY_ROLES = "   ";
        process.env.MP_WRITE_SECURITY_ROLES = "Administrators";
        mockGetActingUserIdForWrite.mockResolvedValueOnce(99);
        mockGetTableRecords.mockResolvedValueOnce([{ Role_Name: "Volunteer" }]);

        await expect(
          AuthorizationService.getInstance().requireSecurityRoleForWrite(WRITE_CTX)
        ).rejects.toThrow(UnauthorizedError);
      });
    });
  });
});
