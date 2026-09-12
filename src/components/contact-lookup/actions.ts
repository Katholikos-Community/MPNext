'use server';

import { ContactService } from '@/services/contactService';
import { ContactSearch } from '@/lib/dto';
import { AuthorizationService } from '@/services/authorizationService';

export async function searchContacts(searchTerm: string): Promise<ContactSearch[]> {
  // Server actions compile to callable POST endpoints and src/proxy.ts lets all
  // /api paths through without a session, so this gate is the only thing
  // standing between a caller and 20 contacts' emails and phones.
  //
  // A session alone is NOT enough (F1, 2026-09-12): MP's OIDC endpoint
  // authenticates any dp_Users record, and this app reads MP with its own
  // client-credentials service account, so MP's per-user record security never
  // applies. The role gate — which implies an authenticated session — is what
  // decides. Kept outside the try below so UnauthorizedError reaches the caller
  // instead of being flattened into "Failed to search contacts".
  await AuthorizationService.getInstance().requireSecurityRole({
    table: 'Contacts',
    operation: 'read',
  });

  try {
    if (!searchTerm || searchTerm.trim().length === 0) {
      return [];
    }

    const contactService = await ContactService.getInstance();
    const results = await contactService.contactSearch(searchTerm.trim());

    return results;
  } catch (error) {
    console.error('Error searching contacts:', error);
    throw new Error('Failed to search contacts');
  }
}
