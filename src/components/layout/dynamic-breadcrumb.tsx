"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

interface BreadcrumbSegment {
  label: string;
  href?: string;
}

interface DynamicBreadcrumbProps {
  customSegments?: BreadcrumbSegment[];
}

export function DynamicBreadcrumb({ customSegments }: DynamicBreadcrumbProps) {
  const pathname = usePathname();

  // Generate breadcrumbs from pathname if no custom segments provided
  const segments = customSegments || generateSegmentsFromPath(pathname);

  return (
    <Breadcrumb>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <Link href="/">Home</Link>
          </BreadcrumbLink>
        </BreadcrumbItem>

        {segments.map((segment, index) => (
          <div key={index} className="flex items-center">
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              {segment.href && index < segments.length - 1 ? (
                <BreadcrumbLink asChild>
                  <Link href={segment.href}>{segment.label}</Link>
                </BreadcrumbLink>
              ) : (
                <BreadcrumbPage>{segment.label}</BreadcrumbPage>
              )}
            </BreadcrumbItem>
          </div>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

/**
 * Display labels for the route segments this app actually has (see the folders
 * under `src/app/`). The mechanical transform below cannot recover the word
 * boundary in a squashed segment like "contactlookup", so those are named here.
 */
const SEGMENT_LABELS = new Map<string, string>([
  ["home", "Home"],
  ["contactlookup", "Contact Lookup"],
  ["no-access", "No Access"],
  ["session-error", "Session Error"],
  ["auth-error", "Auth Error"],
  ["signin", "Sign In"],
]);

/**
 * A standard 8-4-4-4-12 hex GUID, anchored so ordinary slugs (and hex-looking
 * words) cannot match. Contact detail routes are keyed by GUID, and a raw GUID
 * in the trail is unreadable.
 *
 * It deliberately renders as the generic "Details" rather than the contact's
 * name: this component is mounted by the layout, which has no access to the
 * page's data, so the name simply is not available here. Resolving it would
 * need a context provider (or the page passing `customSegments`), not a better
 * regex — so this is a considered fallback, not an oversight.
 */
const GUID_SEGMENT = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function generateSegmentsFromPath(pathname: string): BreadcrumbSegment[] {
  const pathSegments = pathname.split("/").filter(Boolean);

  return pathSegments.map((segment, index) => {
    const href = "/" + pathSegments.slice(0, index + 1).join("/");
    const label =
      SEGMENT_LABELS.get(segment) ??
      (GUID_SEGMENT.test(segment)
        ? "Details"
        : // Crude but serviceable fallback for anything unmapped.
          segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " "));

    return {
      label,
      href: index < pathSegments.length - 1 ? href : undefined,
    };
  });
}
