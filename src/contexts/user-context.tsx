"use client";

import {
  createContext,
  useContext,
  useState,
  useMemo,
  useCallback,
  useTransition,
  use,
  ReactNode,
} from "react";
import { authClient } from "@/lib/auth-client";
import { MPUserProfile } from "@/lib/providers/ministry-platform/types";
import { getCurrentUserProfile } from "@/components/shared-actions/user";

interface UserContextValue {
  userProfilePromise: Promise<MPUserProfile | null>;
  refreshUserProfile: () => void;
}

const UserContext = createContext<UserContextValue | undefined>(undefined);

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const { data: session, isPending } = authClient.useSession();
  const [refreshKey, setRefreshKey] = useState(0);
  const [, startTransition] = useTransition();

  // userGuid is the MP User_GUID stored as an additionalField on the Better Auth user.
  // Better Auth generates its own internal user.id, so we use userGuid for MP lookups.
  const userGuid = (session?.user as { userGuid?: string } | undefined)?.userGuid;

  const userProfilePromise = useMemo<Promise<MPUserProfile | null>>(() => {
    if (isPending) return Promise.resolve(null);
    if (!userGuid) return Promise.resolve(null);
    // refreshKey is read to invalidate the memo on refresh, even though
    // it isn't otherwise referenced in the body.
    void refreshKey;
    return getCurrentUserProfile(userGuid).then((p) => p ?? null);
  }, [userGuid, isPending, refreshKey]);

  const refreshUserProfile = useCallback(() => {
    startTransition(() => {
      setRefreshKey((k) => k + 1);
    });
  }, []);

  const value = useMemo<UserContextValue>(
    () => ({ userProfilePromise, refreshUserProfile }),
    [userProfilePromise, refreshUserProfile]
  );

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

interface UseUserResult {
  userProfile: MPUserProfile | null;
  refreshUserProfile: () => void;
}

export function useUser(): UseUserResult {
  const context = useContext(UserContext);
  if (context === undefined) {
    throw new Error("useUser must be used within a UserProvider");
  }
  const userProfile = use(context.userProfilePromise);
  return { userProfile, refreshUserProfile: context.refreshUserProfile };
}
