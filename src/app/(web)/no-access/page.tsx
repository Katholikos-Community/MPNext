import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Landing page for a signed-in user who holds no Ministry Platform security
 * role and therefore may not use the contact features.
 *
 * Deliberately INSIDE the `(web)` route group: the user has a perfectly valid
 * session, so they keep the app shell — header, avatar, user menu and, most
 * importantly, sign-out. (Contrast `/session-error`, which lives outside the
 * group precisely because the shell cannot render there.)
 *
 * No auto-redirect and no retry: the fix is an administrator granting a role in
 * MP, which cannot happen while this page sits in a refresh loop.
 */
export default function NoAccessPage() {
  return (
    <div className="container mx-auto max-w-2xl p-8 sm:p-20">
      <Card>
        <CardHeader>
          <CardTitle>Additional access required</CardTitle>
          <CardDescription>
            Your Ministry Platform account is signed in, but it does not have a
            security role that grants access to this area.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-muted-foreground">
          <p>
            Contact lookup and contact logs read and write real Ministry
            Platform records, so they require a Ministry Platform security role.
          </p>
          <p>
            Please contact your Ministry Platform administrator and ask to be
            assigned a security role. Once it has been granted, return to this
            page — the change takes effect on your next request, with no need to
            sign out and back in.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
