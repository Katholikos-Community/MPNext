import { ContactLog } from "@/lib/providers/ministry-platform/models/ContactLog";
import { ContactLogTypes } from "@/lib/providers/ministry-platform/models/ContactLogTypes";
import { ContactLogSchema, ContactLogInput } from "@/lib/providers/ministry-platform/models/ContactLogSchema";
import { MPHelper } from "@/lib/providers/ministry-platform";
import { sanitizeNumericId } from "@/lib/providers/ministry-platform/utils/filter-sanitize";
import { DomainTimezoneService } from "@/services/domainTimezoneService";
import { AuthorizationService } from "@/services/authorizationService";

/**
 * What a caller may supply when creating a contact log.
 *
 * `Made_By` is absent by construction: authorship is stamped server-side from
 * the authorization gate, never accepted from the caller. See F4 in the auth
 * review and `.claude/references/auth.md` § Authorization.
 */
export type ContactLogCreateInput = Omit<ContactLogInput, "Contact_Log_ID" | "Made_By">;

/**
 * What a caller may supply when updating a contact log.
 *
 * Both `Contact_ID` and `Made_By` are absent by construction — a log may not be
 * re-parented onto a different contact's record, and its authorship is stamped
 * server-side from the authorization gate (F4).
 */
export type ContactLogUpdateInput = Partial<
  Omit<ContactLogInput, "Contact_Log_ID" | "Contact_ID" | "Made_By">
>;

/**
 * ContactLogService - Singleton service for managing contact log operations
 * 
 * This service provides methods to interact with contact log data from Ministry Platform,
 * including searching, retrieving, creating, updating, and deleting contact log records.
 * Uses the singleton pattern to ensure a single instance across the application.
 *
 * ## Authorization
 *
 * Every method here — reads included — goes through `AuthorizationService`, so
 * a caller that bypasses the gated server actions still cannot reach contact
 * logs without an MP security role. Writes take their `$userId` attribution
 * from the gate's return value rather than resolving the acting user
 * separately. See `.claude/references/auth.md` § Authorization.
 */
export class ContactLogService {
  private static instance: ContactLogService;
  private mp: MPHelper | null = null;

  /**
   * Private constructor to enforce singleton pattern
   * Initializes the service when instantiated
   */
  private constructor() {
    this.initialize();
  }

  /**
   * Gets the singleton instance of ContactLogService
   * Creates a new instance if one doesn't exist and ensures it's properly initialized
   * 
   * @returns Promise<ContactLogService> - The initialized ContactLogService instance
   */
  public static async getInstance(): Promise<ContactLogService> {
    if (!ContactLogService.instance) {
      ContactLogService.instance = new ContactLogService();
      await ContactLogService.instance.initialize();
    }
    return ContactLogService.instance;
  }

  /**
   * Initializes the ContactLogService by creating a new MPHelper instance
   * This method sets up the Ministry Platform connection helper
   * 
   * @returns Promise<void>
   */
  private async initialize(): Promise<void> {
    this.mp = new MPHelper();
  }

  /**
   * Retrieves all contact log types
   * 
   * @returns Promise<ContactLogTypes[]> - Array of all contact log type records
   * @throws UnauthorizedError when the caller holds no MP security role
   */
  public async getContactLogTypes(): Promise<ContactLogTypes[]> {
    await AuthorizationService.getInstance().requireSecurityRole({
      table: "Contact_Log_Types",
      operation: "read",
    });

    const records = await this.mp!.getTableRecords<ContactLogTypes>({
      table: "Contact_Log_Types",
      select: "Contact_Log_Type_ID,Contact_Log_Type,Description",
      top: 100,
      orderBy: "Contact_Log_Type"
    });

    return records;
  }

  /**
   * Searches for contact log records based on contact ID
   * 
   * @param contactId - The contact ID to search for logs; omit for an unfiltered read
   * @param limit - Maximum number of records to return (default: 50)
   * @returns Promise<ContactLog[]> - Array of matching contact log records
   * @throws Error if contactId is supplied but is not a positive integer ID
   * @throws UnauthorizedError when the caller holds no MP security role
   */
  public async searchContactLogs(contactId?: number, limit: number = 50): Promise<ContactLog[]> {
    await AuthorizationService.getInstance().requireSecurityRole({
      table: "Contact_Log",
      operation: "read",
    });

    let filter = "";

    if (contactId !== undefined && contactId !== null) {
      filter = `Contact_ID = ${sanitizeNumericId(contactId, "Contact ID")}`;
    }

    const records = await this.mp!.getTableRecords<ContactLog>({
      table: "Contact_Log",
      filter: filter,
      select: "Contact_Log_ID,Contact_ID,Contact_Date,Made_By,Notes,Contact_Log_Type_ID,Planned_Contact_ID,Contact_Successful,Original_Contact_Log_Entry,Feedback_Entry_ID",
      top: limit,
      orderBy: "Contact_Date DESC"
    });
    
    return records;
  }

  /**
   * Retrieves a specific contact log record by its ID
   * 
   * @param contactLogId - The unique ID of the contact log record
   * @returns Promise<ContactLog | null> - The matching contact log record or null if not found
   * @throws Error if contactLogId is not a positive integer ID
   * @throws UnauthorizedError when the caller holds no MP security role
   */
  public async getContactLogById(contactLogId: number): Promise<ContactLog | null> {
    await AuthorizationService.getInstance().requireSecurityRole({
      table: "Contact_Log",
      operation: "read",
    });

    const records = await this.mp!.getTableRecords<ContactLog>({
      table: "Contact_Log",
      filter: `Contact_Log_ID = ${sanitizeNumericId(contactLogId, "Contact Log ID")}`,
      select: "Contact_Log_ID,Contact_ID,Contact_Date,Made_By,Notes,Contact_Log_Type_ID,Planned_Contact_ID,Contact_Successful,Original_Contact_Log_Entry,Feedback_Entry_ID",
      top: 1
    });
    
    return records.length > 0 ? records[0] : null;
  }

  /**
   * Retrieves all contact log records for a specific contact
   * 
   * @param contactId - The contact ID to get logs for
   * @returns Promise<ContactLog[]> - Array of contact log records for the contact
   * @throws Error if contactId is not a positive integer ID
   * @throws UnauthorizedError when the caller holds no MP security role
   */
  public async getContactLogsByContactId(contactId: number): Promise<ContactLog[]> {
    await AuthorizationService.getInstance().requireSecurityRole({
      table: "Contact_Log",
      operation: "read",
    });

    const records = await this.mp!.getTableRecords<ContactLog>({
      table: "Contact_Log",
      filter: `Contact_ID = ${sanitizeNumericId(contactId, "Contact ID")}`,
      select: "Contact_Log_ID,Contact_ID,Contact_Date,Made_By,Notes,Contact_Log_Type_ID,Planned_Contact_ID,Contact_Successful,Original_Contact_Log_Entry,Feedback_Entry_ID",
      orderBy: "Contact_Date DESC"
    });
    
    return records;
  }

  /**
   * Creates a new contact log record with validation
   * 
   * @param contactLogData - The contact log data to create
   * @param schema - Optional Zod schema for runtime validation (defaults to ContactLogSchema)
   * @returns Promise<ContactLog> - The created contact log record
   * @throws UnauthorizedError when the caller holds no MP security role
   */
  public async createContactLog(
    contactLogData: ContactLogCreateInput,
  ): Promise<ContactLog> {
    // Gate first. Its return value is the ONLY source of `Made_By` — nothing a
    // caller sends can become the author of a pastoral record (F4).
    const $userId = await AuthorizationService.getInstance().requireSecurityRole({
      table: "Contact_Log",
      operation: "create",
    });

    // Validate non-date fields with the generated schema; Contact_Date is
    // handled separately by DomainTimezoneService since the generated schema
    // expects ISO and MP needs SQL wall-clock in the domain time zone.
    //
    // `Made_By` is omitted from the schema too, and a Zod object parse strips
    // keys it does not declare, so a smuggled `Made_By` is dropped here rather
    // than merely untyped. TypeScript is erased at runtime and this payload
    // arrives over a server action POST, so the type alone guards nothing.
    const { Contact_Date, ...rest } = contactLogData;
    const validatedRest = ContactLogSchema
      .omit({ Contact_Log_ID: true, Contact_Date: true, Made_By: true })
      .parse(rest);

    // The subject contact legitimately comes from the caller (it is the record
    // being viewed), so it is validated as a positive integer ID, not trusted.
    const contactId = sanitizeNumericId(validatedRest.Contact_ID, "Contact ID");

    const tz = DomainTimezoneService.getInstance();
    const mpDate = await tz.toMpSqlDatetime(Contact_Date);

    const result = await this.mp!.createTableRecords(
      "Contact_Log",
      [{
        ...validatedRest,
        Contact_ID: contactId,
        Contact_Date: mpDate,
        // Last, so no spread above can override server-stamped attribution.
        Made_By: $userId,
      }],
      { $userId }
    );

    if (!result || result.length === 0) {
      throw new Error('Failed to create contact log record');
    }

    return result[0] as ContactLog;
  }

  /**
   * Updates an existing contact log record with validation
   * 
   * @param contactLogId - The ID of the contact log record to update
   * @param contactLogData - The updated contact log data (partial)
   * @returns Promise<ContactLog> - The updated contact log record
   * @throws UnauthorizedError when the caller holds no MP security role
   */
  public async updateContactLog(
    contactLogId: number,
    contactLogData: ContactLogUpdateInput
  ): Promise<ContactLog> {
    // Gate first. Its return value is the ONLY source of `Made_By` (F4).
    const $userId = await AuthorizationService.getInstance().requireSecurityRole({
      table: "Contact_Log",
      operation: "update",
    });

    // `Contact_ID` and `Made_By` are omitted from the schema, and a Zod object
    // parse strips keys it does not declare, so both are dropped from whatever
    // the caller sent (F4). `Contact_ID` is then never included in the PUT at
    // all, so MP preserves the contact the log was created against — a log
    // cannot be moved onto someone else's record.
    const { Contact_Date, ...rest } = contactLogData;
    const validatedRest = ContactLogSchema
      .omit({
        Contact_Log_ID: true,
        Contact_Date: true,
        Contact_ID: true,
        Made_By: true,
      })
      .partial()
      .parse(rest);

    let mpDate: string | undefined;
    if (Contact_Date !== undefined && Contact_Date !== null) {
      const tz = DomainTimezoneService.getInstance();
      mpDate = await tz.toMpSqlDatetime(Contact_Date);
    }

    const updateData = {
      Contact_Log_ID: contactLogId,
      ...validatedRest,
      ...(mpDate !== undefined ? { Contact_Date: mpDate } : {}),
      // Last, so no spread above can override server-stamped attribution.
      Made_By: $userId,
    };

    const result = await this.mp!.updateTableRecords(
      "Contact_Log",
      [updateData],
      { $userId }
    );

    if (!result || result.length === 0) {
      throw new Error('Failed to update contact log record');
    }

    return result[0] as ContactLog;
  }

  /**
   * Deletes a contact log record
   * 
   * @param contactLogId - The ID of the contact log record to delete
   * @returns Promise<void>
   * @throws UnauthorizedError when the caller holds no MP security role
   */
  public async deleteContactLog(contactLogId: number): Promise<void> {
    const $userId = await AuthorizationService.getInstance().requireSecurityRole({
      table: "Contact_Log",
      operation: "delete",
    });

    await this.mp!.deleteTableRecords("Contact_Log", [contactLogId], { $userId });
  }
}
