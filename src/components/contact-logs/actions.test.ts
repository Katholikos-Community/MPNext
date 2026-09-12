import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Contact-log action tests.
 *
 * These encode the decided authorization policy, not just the code's shape:
 * every action — reads as well as writes — requires an authenticated session
 * AND an MP security role; any role-holder may read, edit, or delete a log
 * another user created. See `.claude/references/auth.md`.
 *
 * Reads joined the gate on 2026-09-12 (F1). Before that they took a bare
 * session check, which proved nothing: MP's OIDC endpoint authenticates any
 * `dp_Users` record and this app reads MP with its own client-credentials
 * service account, so MP's per-user record security never applied to what came
 * back. There is no longer a session-only assertion to make here — the gate
 * subsumes authentication, which is why `mockGetSession` is gone from this file.
 */

const {
  mockGetContactLogTypes,
  mockCreateContactLog,
  mockUpdateContactLog,
  mockDeleteContactLog,
  mockGetContactLogsByContactId,
  mockGetContactLogById,
  mockRequireSecurityRole,
} = vi.hoisted(() => ({
  mockGetContactLogTypes: vi.fn(),
  mockCreateContactLog: vi.fn(),
  mockUpdateContactLog: vi.fn(),
  mockDeleteContactLog: vi.fn(),
  mockGetContactLogsByContactId: vi.fn(),
  mockGetContactLogById: vi.fn(),
  mockRequireSecurityRole: vi.fn(),
}));

vi.mock('@/services/contactLogService', () => ({
  ContactLogService: {
    getInstance: vi.fn().mockResolvedValue({
      getContactLogTypes: mockGetContactLogTypes,
      createContactLog: mockCreateContactLog,
      updateContactLog: mockUpdateContactLog,
      deleteContactLog: mockDeleteContactLog,
      getContactLogsByContactId: mockGetContactLogsByContactId,
      getContactLogById: mockGetContactLogById,
    }),
  },
}));

vi.mock('@/services/authorizationService', () => {
  class UnauthorizedError extends Error {
    constructor(message: string) {
      super(message);
      this.name = 'UnauthorizedError';
    }
  }
  return {
    UnauthorizedError,
    AuthorizationService: {
      getInstance: () => ({
        requireSecurityRole: mockRequireSecurityRole,
      }),
    },
  };
});

import {
  getContactLogTypes,
  createContactLog,
  updateContactLog,
  deleteContactLog,
  getContactLogsByContactId,
  getContactLogById,
} from './actions';
import { UnauthorizedError } from '@/services/authorizationService';

/** The gate's refusal for an MP user holding no security role. */
function noRole() {
  return new UnauthorizedError(
    'Not authorized: an MP security role is required'
  );
}

/** The gate's refusal for a session with no MP user behind it. */
function noMpUser() {
  return new UnauthorizedError(
    'Not authorized: no Ministry Platform user is attached to this session'
  );
}

const validCreateInput = {
  Contact_ID: 42,
  Contact_Date: '2024-01-15T10:00:00Z',
  Notes: 'Test note',
  Contact_Log_Type_ID: 1,
  Planned_Contact_ID: null,
  Contact_Successful: null,
  Original_Contact_Log_Entry: null,
  Feedback_Entry_ID: null,
};

describe('contact-logs actions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: an authorized role-holder. Individual tests override.
    mockRequireSecurityRole.mockResolvedValue(99);
  });

  describe('getContactLogTypes', () => {
    it('refuses a caller with no security role', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(noRole());

      await expect(getContactLogTypes()).rejects.toThrow(UnauthorizedError);
      expect(mockGetContactLogTypes).not.toHaveBeenCalled();
    });

    it('refuses a session with no Ministry Platform user', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(noMpUser());

      await expect(getContactLogTypes()).rejects.toThrow(
        /no Ministry Platform user is attached/
      );
      expect(mockGetContactLogTypes).not.toHaveBeenCalled();
    });

    it('should return types when authenticated', async () => {
      const mockTypes = [{ Contact_Log_Type_ID: 1, Contact_Log_Type: 'Email' }];
      mockGetContactLogTypes.mockResolvedValueOnce(mockTypes);

      const result = await getContactLogTypes();
      expect(result).toEqual(mockTypes);
    });

    it('gates the read on a security role (F1 — it used to gate on nothing)', async () => {
      mockGetContactLogTypes.mockResolvedValueOnce([]);

      await getContactLogTypes();

      expect(mockRequireSecurityRole).toHaveBeenCalledWith({
        table: 'Contact_Log',
        operation: 'read',
      });
    });
  });

  describe('createContactLog', () => {
    it('refuses a session with no Ministry Platform user', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(noMpUser());

      await expect(createContactLog(validCreateInput)).rejects.toThrow(
        /no Ministry Platform user is attached/
      );
      expect(mockCreateContactLog).not.toHaveBeenCalled();
    });

    it('should create the log with Made_By taken from the acting session', async () => {
      const mockLog = { Contact_Log_ID: 1, Contact_ID: 42 };
      mockCreateContactLog.mockResolvedValueOnce(mockLog);

      const result = await createContactLog(validCreateInput);

      expect(mockRequireSecurityRole).toHaveBeenCalledWith({
        table: 'Contact_Log',
        operation: 'create',
      });
      expect(mockCreateContactLog).toHaveBeenCalledWith(
        expect.objectContaining({
          Contact_ID: 42,
          Made_By: 99,
          Notes: 'Test note',
        })
      );
      expect(result).toEqual(mockLog);
    });

    it('should throw when required fields are missing', async () => {
      await expect(
        createContactLog({
          ...validCreateInput,
          Contact_ID: 0,
          Contact_Date: '',
          Notes: '',
        })
      ).rejects.toThrow('Required fields are missing');
      expect(mockCreateContactLog).not.toHaveBeenCalled();
    });

    it.each([
      ['Contact_ID', { Contact_ID: 0 }],
      ['Contact_Date', { Contact_Date: '' }],
      ['Notes', { Notes: '' }],
    ])('should reject a create missing %s', async (_field, override) => {
      await expect(
        createContactLog({ ...validCreateInput, ...override })
      ).rejects.toThrow('Required fields are missing');
      expect(mockCreateContactLog).not.toHaveBeenCalled();
    });

    it('should not write when the caller holds no security role', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(
        new UnauthorizedError('Not authorized: an MP security role is required')
      );

      await expect(createContactLog(validCreateInput)).rejects.toThrow(
        'Not authorized: an MP security role is required'
      );
      expect(mockCreateContactLog).not.toHaveBeenCalled();
    });

    it('should not resolve the acting user itself — SessionContextService owns that', async () => {
      // Regression guard for the inline dp_Users lookup this action used to do
      // on every write. Made_By must come from the authorization gate's return
      // value, which reads the session-baked (already cached) User_ID.
      mockRequireSecurityRole.mockResolvedValueOnce(4242);
      mockCreateContactLog.mockResolvedValueOnce({ Contact_Log_ID: 1 });

      await createContactLog(validCreateInput);

      expect(mockCreateContactLog).toHaveBeenCalledWith(
        expect.objectContaining({ Made_By: 4242 })
      );
    });

    it('should wrap a non-Error rejection from the service', async () => {
      mockCreateContactLog.mockRejectedValueOnce('boom');

      await expect(createContactLog(validCreateInput)).rejects.toThrow(
        'Failed to create contact log'
      );
    });
  });

  describe('updateContactLog', () => {
    it('refuses a session with no Ministry Platform user', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(noMpUser());

      await expect(updateContactLog(1, { Notes: 'Updated' })).rejects.toThrow(
        /no Ministry Platform user is attached/
      );
      expect(mockUpdateContactLog).not.toHaveBeenCalled();
    });

    it('should throw for invalid contactLogId', async () => {
      await expect(updateContactLog(0, { Notes: 'Updated' })).rejects.toThrow(
        'Invalid Contact Log ID'
      );
      // The gate runs before argument parsing now, so an unauthorized caller
      // never reaches this check at all — but an authorized one still does.
      expect(mockUpdateContactLog).not.toHaveBeenCalled();
    });

    it('should reject a negative contact log ID', async () => {
      await expect(updateContactLog(-5, { Notes: 'x' })).rejects.toThrow(
        'Invalid Contact Log ID'
      );
      expect(mockUpdateContactLog).not.toHaveBeenCalled();
    });

    it('should update the log after the security-role gate passes', async () => {
      const mockLog = { Contact_Log_ID: 1, Notes: 'Updated' };
      mockUpdateContactLog.mockResolvedValueOnce(mockLog);

      const result = await updateContactLog(1, { Notes: 'Updated' });

      expect(mockRequireSecurityRole).toHaveBeenCalledWith({
        table: 'Contact_Log',
        operation: 'update',
      });
      expect(mockUpdateContactLog).toHaveBeenCalledWith(1, { Notes: 'Updated' });
      expect(result).toEqual(mockLog);
    });

    it('should NOT stamp Made_By with the editor', async () => {
      // Made_By records who made the *contact*. Since any role-holder may edit
      // anyone's log, stamping the editor would rewrite the record's authorship.
      // MP's audit trail captures the editor via $userId in ContactLogService.
      mockUpdateContactLog.mockResolvedValueOnce({ Contact_Log_ID: 1 });

      await updateContactLog(1, { Notes: 'Updated' });

      expect(mockUpdateContactLog).toHaveBeenCalledWith(
        1,
        expect.not.objectContaining({ Made_By: expect.anything() })
      );
    });

    it('should not write when the caller holds no security role', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(
        new UnauthorizedError('Not authorized: an MP security role is required')
      );

      await expect(updateContactLog(1, { Notes: 'x' })).rejects.toThrow(
        'Not authorized: an MP security role is required'
      );
      expect(mockUpdateContactLog).not.toHaveBeenCalled();
    });

    it('should permit editing a log made by a different user', async () => {
      // POLICY: ownership is not a factor. This test exists so a future reader
      // knows the absence of an ownership check was chosen, not overlooked.
      mockUpdateContactLog.mockResolvedValueOnce({ Contact_Log_ID: 7, Made_By: 12345 });

      await expect(updateContactLog(7, { Notes: 'Corrected typo' })).resolves.toEqual({
        Contact_Log_ID: 7,
        Made_By: 12345,
      });
      // No read of the target log is performed to compare Made_By.
      expect(mockGetContactLogById).not.toHaveBeenCalled();
    });

    it('should wrap a non-Error rejection from the service', async () => {
      mockUpdateContactLog.mockRejectedValueOnce('boom');

      await expect(updateContactLog(1, { Notes: 'x' })).rejects.toThrow(
        'Failed to update contact log'
      );
    });
  });

  describe('deleteContactLog', () => {
    it('refuses a session with no Ministry Platform user', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(noMpUser());

      await expect(deleteContactLog(1)).rejects.toThrow(
        /no Ministry Platform user is attached/
      );
      expect(mockDeleteContactLog).not.toHaveBeenCalled();
    });

    it('should throw for invalid contactLogId', async () => {
      await expect(deleteContactLog(0)).rejects.toThrow('Invalid Contact Log ID');
      expect(mockDeleteContactLog).not.toHaveBeenCalled();
    });

    it('should delete after the security-role gate passes', async () => {
      mockDeleteContactLog.mockResolvedValueOnce(undefined);

      await deleteContactLog(42);

      expect(mockRequireSecurityRole).toHaveBeenCalledWith({
        table: 'Contact_Log',
        operation: 'delete',
      });
      expect(mockDeleteContactLog).toHaveBeenCalledWith(42);
    });

    it('should NOT delete when the caller holds no security role', async () => {
      // This is the sharpest edge the gate closes: previously any authenticated
      // session could delete any contact log in the domain by ID.
      mockRequireSecurityRole.mockRejectedValueOnce(
        new UnauthorizedError('Not authorized: an MP security role is required')
      );

      await expect(deleteContactLog(42)).rejects.toThrow(
        'Not authorized: an MP security role is required'
      );
      expect(mockDeleteContactLog).not.toHaveBeenCalled();
    });

    it('should permit deleting a log made by a different user', async () => {
      // POLICY: ownership is not a factor — see updateContactLog above.
      mockDeleteContactLog.mockResolvedValueOnce(undefined);

      await deleteContactLog(7);

      expect(mockDeleteContactLog).toHaveBeenCalledWith(7);
      expect(mockGetContactLogById).not.toHaveBeenCalled();
    });

    it('should wrap a non-Error rejection from the service', async () => {
      mockDeleteContactLog.mockRejectedValueOnce('boom');

      await expect(deleteContactLog(42)).rejects.toThrow('Failed to delete contact log');
    });
  });

  describe('getContactLogsByContactId', () => {
    it('refuses a caller with no security role', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(noRole());

      await expect(getContactLogsByContactId(42)).rejects.toThrow(UnauthorizedError);
      expect(mockGetContactLogsByContactId).not.toHaveBeenCalled();
    });

    it('should throw for invalid contactId', async () => {
      await expect(getContactLogsByContactId(0)).rejects.toThrow(
        'Invalid Contact ID'
      );
    });

    it('returns logs to a role-holder, after the read gate passes', async () => {
      const mockLogs = [{ Contact_Log_ID: 1, Contact_ID: 42 }];
      mockGetContactLogsByContactId.mockResolvedValueOnce(mockLogs);

      const result = await getContactLogsByContactId(42);

      expect(result).toEqual(mockLogs);
      expect(mockRequireSecurityRole).toHaveBeenCalledWith({
        table: 'Contact_Log',
        operation: 'read',
      });
    });

    it('should wrap a non-Error rejection from the service', async () => {
      mockGetContactLogsByContactId.mockRejectedValueOnce('boom');

      await expect(getContactLogsByContactId(42)).rejects.toThrow(
        'Failed to fetch contact logs'
      );
    });
  });

  describe('getContactLogById', () => {
    it('refuses a caller with no security role', async () => {
      mockRequireSecurityRole.mockRejectedValueOnce(noRole());

      await expect(getContactLogById(1)).rejects.toThrow(UnauthorizedError);
      expect(mockGetContactLogById).not.toHaveBeenCalled();
    });

    it('should throw for invalid contactLogId', async () => {
      await expect(getContactLogById(0)).rejects.toThrow('Invalid Contact Log ID');
    });

    it('should return log when found', async () => {
      const mockLog = { Contact_Log_ID: 1, Notes: 'Test' };
      mockGetContactLogById.mockResolvedValueOnce(mockLog);

      const result = await getContactLogById(1);

      expect(result).toEqual(mockLog);
      expect(mockRequireSecurityRole).toHaveBeenCalledWith({
        table: 'Contact_Log',
        operation: 'read',
      });
    });

    it('should return null when not found', async () => {
      mockGetContactLogById.mockResolvedValueOnce(null);

      const result = await getContactLogById(999);
      expect(result).toBeNull();
    });

    it('should wrap a non-Error rejection from the service', async () => {
      mockGetContactLogById.mockRejectedValueOnce('boom');

      await expect(getContactLogById(1)).rejects.toThrow('Failed to fetch contact log');
    });
  });

  describe('Authorization guards', () => {
    it('refuses every write for a session with no MP user behind it', async () => {
      mockRequireSecurityRole.mockRejectedValue(noMpUser());

      await expect(createContactLog(validCreateInput)).rejects.toThrow(UnauthorizedError);
      await expect(updateContactLog(1, { Notes: 'x' })).rejects.toThrow(UnauthorizedError);
      await expect(deleteContactLog(1)).rejects.toThrow(UnauthorizedError);

      expect(mockCreateContactLog).not.toHaveBeenCalled();
      expect(mockUpdateContactLog).not.toHaveBeenCalled();
      expect(mockDeleteContactLog).not.toHaveBeenCalled();
    });

    it('refuses every read for a session with no MP user behind it', async () => {
      // F1: these three used to succeed for any session at all.
      mockRequireSecurityRole.mockRejectedValue(noMpUser());

      await expect(getContactLogTypes()).rejects.toThrow(UnauthorizedError);
      await expect(getContactLogsByContactId(42)).rejects.toThrow(UnauthorizedError);
      await expect(getContactLogById(1)).rejects.toThrow(UnauthorizedError);

      expect(mockGetContactLogTypes).not.toHaveBeenCalled();
      expect(mockGetContactLogsByContactId).not.toHaveBeenCalled();
      expect(mockGetContactLogById).not.toHaveBeenCalled();
    });

    it('every exported action calls the gate — none is reachable on a session alone', async () => {
      // Guards against a new action (or a restored one) shipping ungated.
      mockGetContactLogTypes.mockResolvedValue([]);
      mockGetContactLogsByContactId.mockResolvedValue([]);
      mockGetContactLogById.mockResolvedValue(null);
      mockCreateContactLog.mockResolvedValue({ Contact_Log_ID: 1 });
      mockUpdateContactLog.mockResolvedValue({ Contact_Log_ID: 1 });
      mockDeleteContactLog.mockResolvedValue(undefined);

      await getContactLogTypes();
      await getContactLogsByContactId(42);
      await getContactLogById(1);
      await createContactLog(validCreateInput);
      await updateContactLog(1, { Notes: 'x' });
      await deleteContactLog(1);

      expect(mockRequireSecurityRole.mock.calls.map((c) => c[0])).toEqual([
        { table: 'Contact_Log', operation: 'read' },
        { table: 'Contact_Log', operation: 'read' },
        { table: 'Contact_Log', operation: 'read' },
        { table: 'Contact_Log', operation: 'create' },
        { table: 'Contact_Log', operation: 'update' },
        { table: 'Contact_Log', operation: 'delete' },
      ]);
    });
  });

  // Regression guard for `.claude/TODO/mp-filter-injection-numeric-ids.md`.
  //
  // These actions compile to POST endpoints, so a caller controls the payload's
  // shape as well as its values — a string reaches a `number` parameter. The old
  // `!id || id <= 0` guard passed such values through: for '1 OR 1=1',
  // `!id` is false and `id <= 0` is false, so the guard was a no-op.
  describe('numeric ID validation at the action boundary', () => {
    const injectionPayloads = ['1 OR 1=1', '5; DROP', "1' OR '1'='1", '1 --', '', 'abc', '  7  '];

    it.each(injectionPayloads)('getContactLogById rejects %j before reaching the service', async (payload) => {
      await expect(getContactLogById(payload as unknown as number)).rejects.toThrow(
        'Invalid Contact Log ID'
      );
      expect(mockGetContactLogById).not.toHaveBeenCalled();
    });

    it.each(injectionPayloads)('getContactLogsByContactId rejects %j before reaching the service', async (payload) => {
      await expect(getContactLogsByContactId(payload as unknown as number)).rejects.toThrow(
        'Invalid Contact ID'
      );
      expect(mockGetContactLogsByContactId).not.toHaveBeenCalled();
    });

    it.each(injectionPayloads)('updateContactLog rejects %j before the service', async (payload) => {
      await expect(
        updateContactLog(payload as unknown as number, { Notes: 'x' })
      ).rejects.toThrow('Invalid Contact Log ID');
      expect(mockUpdateContactLog).not.toHaveBeenCalled();
    });

    it.each(injectionPayloads)('deleteContactLog rejects %j before the service', async (payload) => {
      await expect(deleteContactLog(payload as unknown as number)).rejects.toThrow(
        'Invalid Contact Log ID'
      );
      expect(mockDeleteContactLog).not.toHaveBeenCalled();
    });

    it('refuses an unauthorized caller before it even validates the ID', async () => {
      // Authorization runs before argument parsing, so a caller with no role
      // gets one answer — "not authorized" — and learns nothing about which
      // IDs the endpoint would have accepted.
      mockRequireSecurityRole.mockRejectedValueOnce(noMpUser());

      await expect(deleteContactLog('1 OR 1=1' as unknown as number)).rejects.toThrow(
        /no Ministry Platform user is attached/
      );
    });

    it('passes a digits-only ID through to the service as a number', async () => {
      mockGetContactLogById.mockResolvedValueOnce({ Contact_Log_ID: 42 });

      await getContactLogById('42' as unknown as number);

      expect(mockGetContactLogById).toHaveBeenCalledWith(42);
    });
  });
});
