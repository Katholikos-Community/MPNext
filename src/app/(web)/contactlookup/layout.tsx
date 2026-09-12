import { redirect } from "next/navigation";
import { AuthorizationService } from "@/services/authorizationService";

/**
 * Page-layer authorization gate for every route under `/contactlookup`.
 *
 * This is the outermost of three enforcement layers (layout → server action →
 * service); each one re-checks, because each is independently reachable. The
 * layout is what stops a role-less user seeing a broken page full of thrown
 * actions: it redirects them somewhere that explains the refusal instead.
 *
 * **It covers `[guid]/page.tsx` too.** That page calls `getContactDetails`,
 * `getContactLogsByContactId` and `getMpTimezone` during its own render — but
 * React renders this layout first and only renders `children` once this
 * component has returned, so a `redirect()` here means the page component never
 * runs and those calls never happen. The actions gate themselves anyway.
 *
 * Uses the non-throwing `hasSecurityRole` so a refusal becomes a redirect
 * rather than an error page. Infrastructure failures (MP unreachable) still
 * throw, so "MP is down" never silently reads as "you are not allowed".
 *
 * Closes F1 (2026-09-12) — see `.claude/references/auth.md` § Authorization.
 */
export default async function ContactLookupLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const decision = await AuthorizationService.getInstance().hasSecurityRole({
    table: "Contacts",
    operation: "read",
  });

  if (!decision.permitted) {
    redirect("/no-access");
  }

  return <>{children}</>;
}
