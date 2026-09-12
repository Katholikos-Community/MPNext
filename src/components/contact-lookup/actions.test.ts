import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * searchContacts action tests.
 *
 * The action is a compiled POST endpoint that returns 20 contacts' names,
 * emails and phone numbers. As of F1 (2026-09-12) a session is no longer
 * sufficient to call it: MP's OIDC endpoint authenticates any `dp_Users`
 * record, and this app reads MP with its own client-credentials service
 * account, so only `AuthorizationService` decides who may see this data.
 */

const { mockContactSearch, mockRequireSecurityRole } = vi.hoisted(() => ({
  mockContactSearch: vi.fn(),
  mockRequireSecurityRole: vi.fn(),
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

vi.mock('@/services/contactService', () => ({
  ContactService: {
    getInstance: vi.fn().mockResolvedValue({
      contactSearch: mockContactSearch,
    }),
  },
}));

import { searchContacts } from './actions';
import { UnauthorizedError } from '@/services/authorizationService';

/** The gate's refusal for a session with no MP user behind it. */
function noMpUser() {
  return new UnauthorizedError(
    'Not authorized: no Ministry Platform user is attached to this session (read on Contacts)'
  );
}

/** The gate's refusal for an MP user holding no security role. */
function noRole() {
  return new UnauthorizedError(
    'Not authorized: an MP security role is required to read records in Contacts'
  );
}

describe('searchContacts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: an authorized role-holder.
    mockRequireSecurityRole.mockResolvedValue(99);
  });

  it('gates the read on an MP security role, not merely a session', async () => {
    mockContactSearch.mockResolvedValueOnce([]);

    await searchContacts('John');

    expect(mockRequireSecurityRole).toHaveBeenCalledWith({
      table: 'Contacts',
      operation: 'read',
    });
  });

  it('rejects a session with no Ministry Platform user', async () => {
    mockRequireSecurityRole.mockRejectedValueOnce(noMpUser());

    await expect(searchContacts('John')).rejects.toThrow(UnauthorizedError);
    expect(mockContactSearch).not.toHaveBeenCalled();
  });

  it('rejects an MP user who holds no security role', async () => {
    mockRequireSecurityRole.mockRejectedValueOnce(noRole());

    await expect(searchContacts('John')).rejects.toThrow(
      /an MP security role is required/
    );
    expect(mockContactSearch).not.toHaveBeenCalled();
  });

  it('surfaces the denial rather than flattening it into "Failed to search contacts"', async () => {
    // The gate is deliberately outside the try/catch: a caller must be able to
    // tell "you may not do this" from "the search blew up".
    mockRequireSecurityRole.mockRejectedValueOnce(noRole());

    await expect(searchContacts('John')).rejects.toThrow(UnauthorizedError);
  });

  it('rejects an unauthorized caller before validating the search term', async () => {
    mockRequireSecurityRole.mockRejectedValueOnce(noMpUser());

    // The empty-term early return must not become an unauthorized success path.
    await expect(searchContacts('')).rejects.toThrow(UnauthorizedError);
    expect(mockContactSearch).not.toHaveBeenCalled();
  });

  it('should return results for valid search term', async () => {
    const mockResults = [
      { Contact_ID: 1, First_Name: 'John', Last_Name: 'Doe' },
    ];
    mockContactSearch.mockResolvedValueOnce(mockResults);

    const result = await searchContacts('John');

    expect(mockContactSearch).toHaveBeenCalledWith('John');
    expect(result).toEqual(mockResults);
  });

  it('should return empty array for empty search term', async () => {
    const result = await searchContacts('');
    expect(result).toEqual([]);
    expect(mockContactSearch).not.toHaveBeenCalled();
  });

  it('should return empty array for whitespace-only search term', async () => {
    const result = await searchContacts('   ');
    expect(result).toEqual([]);
    expect(mockContactSearch).not.toHaveBeenCalled();
  });

  it('should trim whitespace from search term', async () => {
    mockContactSearch.mockResolvedValueOnce([]);

    await searchContacts('  John  ');

    expect(mockContactSearch).toHaveBeenCalledWith('John');
  });

  it('should throw on service error', async () => {
    mockContactSearch.mockRejectedValueOnce(new Error('API error'));

    await expect(searchContacts('John')).rejects.toThrow('Failed to search contacts');
  });
});
