"use client";

import { useQuery } from "@tanstack/react-query";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode
} from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { useAuthSession } from "@/components/session-refresh-provider";
import { ApiError } from "@/lib/api";
import { ensureSession } from "@/lib/auth-refresh";
import { fetchMerchantDashboardBootstrap } from "@/lib/merchant-dashboard-api";
import { fallbackMerchantChrome } from "../data/mock-dashboard-data";
import { toMerchantChrome } from "../lib/dashboard-utils";
import type { MerchantChrome, MerchantChromeStatus } from "../types/dashboard";

export interface MerchantIdentityContextValue {
  chrome: MerchantChrome;
  status: MerchantChromeStatus;
  errorMessage: string | null;
  isBootstrapping: boolean;
  isMissingStore: boolean;
  isReady: boolean;
  retry: () => void;
  storeId: string;
}

const MerchantIdentityContext = createContext<MerchantIdentityContextValue | null>(null);

export function MerchantIdentityProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("dashboard");
  const router = useRouter();
  const { clearSession, isSessionReady, session, sessionIssue } = useAuthSession();
  const currentSessionId = session?.sessionId ?? null;
  const redirectingRef = useRef(false);

  const redirectToLogin = useCallback(() => {
    if (redirectingRef.current) {
      return;
    }
    redirectingRef.current = true;
    clearSession();
    router.replace("/auth/login");
  }, [clearSession, router]);

  useEffect(() => {
    if (!isSessionReady || currentSessionId || sessionIssue === "temporary_outage") {
      return;
    }
    redirectToLogin();
  }, [currentSessionId, isSessionReady, redirectToLogin, sessionIssue]);

  const query = useQuery({
    enabled: isSessionReady && Boolean(currentSessionId) && sessionIssue !== "temporary_outage",
    queryKey: ["merchant", "identity", currentSessionId],
    queryFn: async ({ signal }) => {
      const result = await ensureSession({
        forceRefresh: false,
        reason: "merchant_identity_provider",
        signal
      });

      if (result.status === "authenticated") {
        return fetchMerchantDashboardBootstrap({ signal });
      }

      if (result.status === "logged_out") {
        throw new ApiError("Merchant session is not available.", 401, {
          code: "AUTH_REFRESH_INVALID",
          reason: result.reason
        });
      }

      throw new ApiError("Merchant session refresh is temporarily unavailable.", 503, {
        code: "AUTH_REFRESH_OUTAGE",
        reason: result.reason
      });
    },
    retry: (failureCount, error) =>
      failureCount < 2 &&
      !isAuthSessionFailure(error) &&
      !isAuthRefreshOutage(error) &&
      !isMerchantStoreRequired(error)
  });

  useEffect(() => {
    if (isAuthSessionFailure(query.error)) {
      redirectToLogin();
    }
  }, [query.error, redirectToLogin]);

  const chrome = query.data ? toMerchantChrome(query.data) : fallbackMerchantChrome;
  const missingStore = isMerchantStoreRequired(query.error);
  const status: MerchantChromeStatus = query.data
    ? "ready"
    : query.error && !isAuthSessionFailure(query.error)
      ? "error"
      : isSessionReady && currentSessionId && sessionIssue !== "temporary_outage"
        ? "loading"
        : "idle";
  const errorMessage = query.error
    ? merchantErrorMessage(query.error, t("shell.profileLoadFailedDescription"), t("shell.profileStoreMissing"))
    : null;

  const value = useMemo<MerchantIdentityContextValue>(
    () => ({
      chrome,
      status,
      errorMessage,
      isBootstrapping:
        !isSessionReady ||
        (Boolean(currentSessionId) && sessionIssue !== "temporary_outage" && query.isLoading),
      isMissingStore: missingStore,
      isReady: status === "ready" && Boolean(chrome.storeId),
      retry: () => {
        void query.refetch();
      },
      storeId: chrome.storeId
    }),
    [chrome, currentSessionId, errorMessage, isSessionReady, missingStore, query, sessionIssue, status]
  );

  return <MerchantIdentityContext.Provider value={value}>{children}</MerchantIdentityContext.Provider>;
}

export function useMerchantIdentity() {
  const context = useContext(MerchantIdentityContext);
  if (!context) {
    throw new Error("useMerchantIdentity must be used within MerchantIdentityProvider.");
  }
  return context;
}

function merchantErrorMessage(error: unknown, fallback: string, storeMissing: string) {
  if (error instanceof ApiError) {
    const code = errorCode(error.body);
    if (code === "MERCHANT_STORE_REQUIRED") {
      return storeMissing;
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
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

function isMerchantStoreRequired(error: unknown) {
  return error instanceof ApiError && errorCode(error.body) === "MERCHANT_STORE_REQUIRED";
}

function isAuthRefreshOutage(error: unknown) {
  return error instanceof ApiError && errorCode(error.body) === "AUTH_REFRESH_OUTAGE";
}

function errorCode(body: unknown) {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
