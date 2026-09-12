"use server";

import { ContactLog } from "@/lib/providers/ministry-platform/models/ContactLog";
import { ContactLogTypes } from "@/lib/providers/ministry-platform/models/ContactLogTypes";
import { ContactLogInput } from "@/lib/providers/ministry-platform/models/ContactLogSchema";
import { ContactLogService } from "@/services/contactLogService";
import { AuthorizationService } from "@/services/authorizationService";
import { sanitizeNumericId } from "@/lib/providers/ministry-platform/utils/filter-sanitize";
import type { MpOperation } from "@/services/authorizationService";

/**
 * Contact-log server actions.
 *
 * ## Authorization policy (writes decided 2026-08-21; reads added 2026-09-12)
 *
 * **Every action here — reads and writes alike — requires an authenticated
 * session AND an MP security role.** Any user holding a security role may read,
 * edit, or delete **any** contact log, including one another user created —
 * ownership (`Made_By`) is deliberately not a factor, because staff need to be
 * able to correct and remove each other's logs.
 *
 * Reads used to require only a session. That was F1 (2026-09-12): MP's OIDC
 * endpoint authenticates ANY `dp_Users` record, and this app reads MP with its
 * own client-credentials service account (`dataplatform/scopes/all`), so MP's
 * per-user record security never applies to what these actions return. A
 * session by itself therefore proved nothing about whether the caller may see
 * pastoral records.
 *
 * `AuthorizationService` owns the gate; see `.claude/references/auth.md` for
 * the full rationale.
 */

/**
 * Confirms the caller may perform `operation` on `Contact_Log` and returns
 * their MP `User_ID`.
 *
 * The gate implies an authenticated session (it fails closed when no MP user
 * resolves), so it replaces the bare session check the reads used to make. The
 * acting user comes from `SessionContextService` via `AuthorizationService` —
 * the session already carries a resolved `userId` (baked in by `customSession`
 * and cached process-wide by `resolveMpUserId`), so this costs no `dp_Users`
 * round-trip, and the `dp_User_Roles` read is memoized per request.
 */
async function requireContactLogAccess(operation: MpOperation): Promise<number> {
  return AuthorizationService.getInstance().requireSecurityRole({
    table: "Contact_Log",
    operation,
  });
}

export async function getContactLogTypes(): Promise<ContactLogTypes[]> {
  try {
    await requireContactLogAccess("read");

    const contactLogService = await ContactLogService.getInstance();
    const types = await contactLogService.getContactLogTypes();

    return types;
  } catch (error) {
    console.error("Error fetching contact log types:", error);
    throw error instanceof Error ? error : new Error("Failed to fetch contact log types");
  }
}

export async function createContactLog(
  contactLogData: Omit<ContactLogInput, "Contact_Log_ID" | "Made_By">
): Promise<ContactLog> {
  try {
    const userId = await requireContactLogAccess("create");

    if (!contactLogData.Contact_ID || !contactLogData.Contact_Date || !contactLogData.Notes) {
      throw new Error("Required fields are missing: Contact_ID, Contact_Date, and Notes are required");
    }

    // Made_By records who made the contact, taken from the acting session.
    const logDataWithUser = {
      ...contactLogData,
      Made_By: userId,
    };

    const contactLogService = await ContactLogService.getInstance();
    const contactLog = await contactLogService.createContactLog(logDataWithUser);

    return contactLog;
  } catch (error) {
    console.error("Error creating contact log:", error);
    throw error instanceof Error ? error : new Error("Failed to create contact log");
  }
}

export async function updateContactLog(
  contactLogId: number,
  contactLogData: Partial<Omit<ContactLogInput, "Contact_Log_ID" | "Made_By">>
): Promise<ContactLog> {
  try {
    // Gate first: an unauthorized caller gets no argument feedback at all.
    // The returned User_ID is deliberately NOT written to Made_By — see below.
    await requireContactLogAccess("update");

    // Validates at the boundary. TypeScript's `number` is erased at runtime and a
    // caller controls this POST payload's shape, so the ID must be checked here
    // rather than trusted downstream.
    const logId = sanitizeNumericId(contactLogId, "Contact Log ID");

    // Made_By records who made the *contact*, not who last edited the row.
    // Under this policy any role-holder may edit anyone's log, so stamping the
    // editor would rewrite the pastoral record's authorship. MP's audit trail
    // already captures the editor via `$userId` in ContactLogService.
    const contactLogService = await ContactLogService.getInstance();
    const contactLog = await contactLogService.updateContactLog(logId, contactLogData);

    return contactLog;
  } catch (error) {
    console.error("Error updating contact log:", error);
    throw error instanceof Error ? error : new Error("Failed to update contact log");
  }
}

export async function deleteContactLog(contactLogId: number): Promise<void> {
  try {
    await requireContactLogAccess("delete");

    const logId = sanitizeNumericId(contactLogId, "Contact Log ID");

    const contactLogService = await ContactLogService.getInstance();
    await contactLogService.deleteContactLog(logId);
  } catch (error) {
    console.error("Error deleting contact log:", error);
    throw error instanceof Error ? error : new Error("Failed to delete contact log");
  }
}

export async function getContactLogsByContactId(contactId: number): Promise<ContactLog[]> {
  try {
    await requireContactLogAccess("read");

    const id = sanitizeNumericId(contactId, "Contact ID");

    const contactLogService = await ContactLogService.getInstance();
    const results = await contactLogService.getContactLogsByContactId(id);

    return results;
  } catch (error) {
    console.error("Error fetching contact logs by contact ID:", error);
    throw error instanceof Error ? error : new Error("Failed to fetch contact logs");
  }
}

export async function getContactLogById(contactLogId: number): Promise<ContactLog | null> {
  try {
    await requireContactLogAccess("read");

    const logId = sanitizeNumericId(contactLogId, "Contact Log ID");

    const contactLogService = await ContactLogService.getInstance();
    const result = await contactLogService.getContactLogById(logId);

    return result;
  } catch (error) {
    console.error("Error fetching contact log by ID:", error);
    throw error instanceof Error ? error : new Error("Failed to fetch contact log");
  }
}
