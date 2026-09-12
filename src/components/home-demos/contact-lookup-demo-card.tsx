"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useUser } from "@/contexts";

/**
 * The dashboard's Contact Lookup demo tile.
 *
 * A client component purely so it can read `canAccessContactFeatures` off the
 * MP profile that `UserProvider` already loads — this keeps the dashboard page
 * itself synchronous and free of any Ministry Platform round trip of its own.
 *
 * UX ONLY — hiding the tile is not a security control. The flag is computed
 * server-side by `getCurrentUserProfile` from the same AuthorizationService
 * gate enforced by the /contactlookup layout, the server actions and the
 * services; a role-less user who types the URL still meets the real gate and is
 * redirected to /no-access. Rendering nothing (rather than a disabled tile)
 * keeps the dashboard honest about what this user can actually do.
 */
export function ContactLookupDemoCard() {
  const { userProfile } = useUser();

  // `=== true` so a missing or not-yet-loaded profile fails closed.
  if (userProfile?.canAccessContactFeatures !== true) {
    return null;
  }

  return (
    <Card className="flex flex-col">
      <CardHeader>
        <CardTitle>Contact Lookup</CardTitle>
        <CardDescription>
          Contact Lookup shows an example of the full CRUD power of the MP API and quickly accessing data from the platform
        </CardDescription>
      </CardHeader>
      <CardContent className="mt-auto">
        <Link href="/contactlookup">
          <Button className="w-full">View Demo</Button>
        </Link>
      </CardContent>
    </Card>
  );
}
