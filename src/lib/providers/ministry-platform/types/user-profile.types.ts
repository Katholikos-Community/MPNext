export interface MPUserProfile {
  User_ID: number;
  User_GUID: string;
  Contact_ID: number;
  First_Name: string;
  Nickname: string;
  Last_Name: string;
  Email_Address: string | null;
  Mobile_Phone: string | null;
  Image_GUID: string | null;
  roles: string[];
  userGroups: string[];
  /**
   * Whether this user may use the contact-lookup / contact-log features,
   * computed SERVER-SIDE by `getCurrentUserProfile` from the same
   * `AuthorizationService` gate the pages, actions and services enforce with.
   *
   * UX only — the client uses it to hide navigation a role-less user would
   * only be refused at. It is NOT a security control, and the client must
   * never derive policy itself by inspecting `roles`.
   *
   * Optional because `UserService` reads only `dp_Users`; the server action
   * attaches it. Consumers should test `=== true` so an absent flag fails
   * closed.
   */
  canAccessContactFeatures?: boolean;
}
