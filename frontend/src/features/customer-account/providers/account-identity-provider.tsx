"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode
} from "react";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useAuthSession } from "@/components/session-refresh-provider";
import { ApiError } from "@/lib/api";
import { logout } from "@/lib/auth-api";
import {
  type CustomerProfile,
  fetchAccountBootstrap,
  fetchCustomerProfile
} from "../customer-account-api";
import { accountBootstrapKey, accountProfileKey } from "../lib/account-query-keys";

type AccountChrome = {
  id: string | null;
  avatarUrl: string | null;
  email: string | null;
  emailVerified: boolean;
  fullName: string | null;
  profileVersion: string | null;
};

type AccountIdentityStatus = "idle" | "loading" | "ready" | "error";

interface AccountIdentityContextValue {
  account: AccountChrome;
  applySessionProfile: (profile: CustomerProfile) => void;
  errorMessage: string | null;
  isBootstrapping: boolean;
  isLoggingOut: boolean;
  logout: () => Promise<void>;
  profile: CustomerProfile | null;
  profileError: unknown;
  profileLoading: boolean;
  refetchIdentity: () => void;
  refetchProfile: () => void;
  status: AccountIdentityStatus;
}

const AccountIdentityContext = createContext<AccountIdentityContextValue | null>(null);

export function AccountIdentityProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const { clearSession, isSessionReady, session, sessionIssue, setSession } = useAuthSession();
  const currentSessionId = session?.sessionId ?? null;
  const redirectingRef = useRef(false);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) {
      return;
    }
    redirectingRef.current = true;
    clearSession();
    router.replace(`/auth/login?next=${encodeURIComponent(pathname || "/account")}`);
  }, [clearSession, pathname, router]);

  useEffect(() => {
    if (!isSessionReady || currentSessionId || sessionIssue === "temporary_outage") {
      return;
    }
    redirectToLogin();
  }, [currentSessionId, isSessionReady, redirectToLogin, sessionIssue]);

  const bootstrap = useQuery({
    enabled: isSessionReady && Boolean(currentSessionId),
    queryKey: accountBootstrapKey,
    queryFn: fetchAccountBootstrap
  });

  const profileQuery = useQuery({
    enabled: isSessionReady && Boolean(currentSessionId),
    queryKey: accountProfileKey,
    queryFn: fetchCustomerProfile
  });

  useEffect(() => {
    if (isAuthSessionFailure(bootstrap.error) || isAuthSessionFailure(profileQuery.error)) {
      redirectToLogin();
    }
  }, [bootstrap.error, profileQuery.error, redirectToLogin]);

  const applySessionProfile = useCallback(
    (nextProfile: CustomerProfile) => {
      queryClient.setQueryData(accountProfileKey, { apiVersion: "v1", profile: nextProfile });
      if (!session) {
        return;
      }
      setSession({
        ...session,
        user: {
          ...session.user,
          avatarUrl: nextProfile.avatarUrl,
          email: nextProfile.email,
          emailVerified: nextProfile.emailVerified,
          fullName: nextProfile.fullName
        }
      });
    },
    [queryClient, session, setSession]
  );

  const handleLogout = useCallback(async () => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    clearSession();
    try {
      await logout();
    } catch {
      // Local session has already been cleared.
    } finally {
      router.replace("/auth/login");
    }
  }, [clearSession, isLoggingOut, router]);

  const profile = profileQuery.data?.profile ?? null;
  const account = toAccountChrome(profile, bootstrap.data?.account ?? null, session?.user ?? null);
  const hasAnyIdentity = Boolean(profile || bootstrap.data?.account || session?.user);
  const isBootstrapping =
    !isSessionReady ||
    (Boolean(currentSessionId) && !hasAnyIdentity && (bootstrap.isLoading || profileQuery.isLoading));
  const hasFatalError =
    !hasAnyIdentity &&
    (bootstrap.isError || profileQuery.isError) &&
    !isAuthSessionFailure(bootstrap.error) &&
    !isAuthSessionFailure(profileQuery.error);
  const status: AccountIdentityStatus = isBootstrapping ? "loading" : hasFatalError ? "error" : hasAnyIdentity ? "ready" : "idle";

  const value = useMemo<AccountIdentityContextValue>(
    () => ({
      account,
      applySessionProfile,
      errorMessage: hasFatalError
        ? readableError(bootstrap.error ?? profileQuery.error, "Account details could not load.")
        : null,
      isBootstrapping,
      isLoggingOut,
      logout: handleLogout,
      profile,
      profileError: profileQuery.error,
      profileLoading: profileQuery.isLoading,
      refetchIdentity: () => {
        void bootstrap.refetch();
        void profileQuery.refetch();
      },
      refetchProfile: () => {
        void profileQuery.refetch();
      },
      status
    }),
    [
      account,
      applySessionProfile,
      bootstrap,
      handleLogout,
      hasFatalError,
      isBootstrapping,
      isLoggingOut,
      profile,
      profileQuery,
      status
    ]
  );

  return <AccountIdentityContext.Provider value={value}>{children}</AccountIdentityContext.Provider>;
}

export function useAccountIdentity() {
  const context = useContext(AccountIdentityContext);
  if (!context) {
    throw new Error("useAccountIdentity must be used within AccountIdentityProvider.");
  }
  return context;
}

function toAccountChrome(
  profile: CustomerProfile | null,
  bootstrapAccount: AccountChrome | null,
  sessionUser: {
    id: string;
    avatarUrl: string | null;
    email: string;
    emailVerified: boolean;
    fullName: string | null;
  } | null
): AccountChrome {
  if (profile) {
    return {
      id: profile.id,
      avatarUrl: profile.avatarUrl,
      email: profile.email,
      emailVerified: profile.emailVerified,
      fullName: profile.fullName,
      profileVersion: profile.profileVersion
    };
  }

  if (bootstrapAccount) {
    return bootstrapAccount;
  }

  if (sessionUser) {
    return {
      id: sessionUser.id,
      avatarUrl: sessionUser.avatarUrl,
      email: sessionUser.email,
      emailVerified: sessionUser.emailVerified,
      fullName: sessionUser.fullName,
      profileVersion: null
    };
  }

  return {
    id: null,
    avatarUrl: null,
    email: null,
    emailVerified: false,
    fullName: null,
    profileVersion: null
  };
}

function readableError(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message : fallback;
}

function isAuthSessionFailure(error: unknown) {
  if (!(error instanceof ApiError) || error.status !== 401) {
    return false;
  }
  const code = errorCode(error.body);
  return (
    code === "AUTH_ACCESS_MISSING" ||
    code === "AUTH_ACCESS_INVALID" ||
    code === "AUTH_REFRESH_MISSING" ||
    code === "AUTH_REFRESH_INVALID" ||
    code === "UNAUTHORIZED"
  );
}

function errorCode(body: unknown) {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
