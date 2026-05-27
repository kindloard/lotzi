"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import type { SessionResponse } from "@/lib/auth-api";
import {
  clearSessionEnvelope,
  ensureSession,
  hasReadableAuthHint,
  readFreshEnvelope,
  readSessionEnvelope,
  scheduleDelayForSession,
  storeSessionEnvelope,
  subscribeToSessionEvents
} from "@/lib/auth-refresh";

const PENDING_SIGNUP_EMAIL_KEY = "namastore:pending-signup-email";
const OUTAGE_RETRY_BASE_MS = 30_000;
const OUTAGE_RETRY_MAX_MS = 120_000;

interface AuthSessionContextValue {
  session: SessionResponse | null;
  isSessionReady: boolean;
  sessionIssue: "none" | "temporary_outage";
  setSession: (session: SessionResponse) => void;
  clearSession: () => void;
}

const AuthSessionContext = createContext<AuthSessionContextValue | null>(null);

export function SessionRefreshProvider({ children }: { children: ReactNode }) {
  const timeout = useRef<number | undefined>(undefined);
  const outageRetryCount = useRef(0);
  const scheduleRef = useRef<(nextSession: SessionResponse) => void>(() => undefined);
  const [session, setSessionState] = useState<SessionResponse | null>(null);
  const [isSessionReady, setIsSessionReady] = useState(false);
  const [sessionIssue, setSessionIssue] = useState<AuthSessionContextValue["sessionIssue"]>("none");

  const scheduleOutageRetry = useCallback(() => {
    window.clearTimeout(timeout.current);
    const delay = Math.min(
      OUTAGE_RETRY_MAX_MS,
      OUTAGE_RETRY_BASE_MS * 2 ** outageRetryCount.current
    );
    outageRetryCount.current += 1;
    timeout.current = window.setTimeout(() => {
      void ensureSession({ forceRefresh: true, reason: "scheduled_refresh_recovery" }).then((result) => {
        if (result.status === "authenticated") {
          outageRetryCount.current = 0;
          setSessionState(result.session);
          setSessionIssue("none");
          scheduleRef.current(result.session);
          return;
        }
        if (result.status === "outage") {
          setSessionState(result.session);
          setSessionIssue("temporary_outage");
          scheduleOutageRetry();
          return;
        }
        window.clearTimeout(timeout.current);
        setSessionState(null);
        setSessionIssue("none");
      });
    }, delay);
  }, []);

  const schedule = useCallback((nextSession: SessionResponse) => {
    window.clearTimeout(timeout.current);
    timeout.current = window.setTimeout(() => {
      void ensureSession({ forceRefresh: true, reason: "scheduled_refresh" }).then((result) => {
        if (result.status === "authenticated") {
          outageRetryCount.current = 0;
          setSessionState(result.session);
          setSessionIssue("none");
          schedule(result.session);
          return;
        }
        if (result.status === "outage") {
          setSessionState(result.session);
          setSessionIssue("temporary_outage");
          scheduleOutageRetry();
          return;
        }
        setSessionState(null);
        setSessionIssue("none");
      });
    }, scheduleDelayForSession(nextSession));
  }, [scheduleOutageRetry]);
  scheduleRef.current = schedule;

  const setSession = useCallback(
    (nextSession: SessionResponse) => {
      setSessionState(nextSession);
      setIsSessionReady(true);
      setSessionIssue("none");
      outageRetryCount.current = 0;
      storeSessionEnvelope(nextSession, { broadcast: true });
      localStorage.removeItem(PENDING_SIGNUP_EMAIL_KEY);
      schedule(nextSession);
    },
    [schedule]
  );

  const clearSession = useCallback(() => {
    window.clearTimeout(timeout.current);
    localStorage.removeItem(PENDING_SIGNUP_EMAIL_KEY);
    outageRetryCount.current = 0;
    clearSessionEnvelope({ broadcast: true });
    setSessionState(null);
    setIsSessionReady(true);
    setSessionIssue("none");
  }, []);

  useEffect(() => {
    const applyStoredSession = () => {
      const envelope = readSessionEnvelope();
      if (!envelope) {
        setSessionState(null);
        return;
      }
      setSessionState(envelope.session);
      schedule(envelope.session);
    };

    const unsubscribe = subscribeToSessionEvents((event) => {
      if (event.type === "session-cleared") {
        window.clearTimeout(timeout.current);
        setSessionState(null);
        setSessionIssue("none");
        return;
      }
      applyStoredSession();
      setSessionIssue("none");
    });

    const boot = async () => {
      if (!hasReadableAuthHint()) {
        clearSessionEnvelope({ broadcast: false });
        setSessionState(null);
        setIsSessionReady(true);
        return;
      }

      const fresh = readFreshEnvelope();
      if (fresh) {
        setSessionState(fresh.session);
        setIsSessionReady(true);
        setSessionIssue("none");
        outageRetryCount.current = 0;
        schedule(fresh.session);
        return;
      }

      const result = await ensureSession({ reason: "boot" });
      if (result.status === "authenticated") {
        outageRetryCount.current = 0;
        setSessionState(result.session);
        setSessionIssue("none");
        schedule(result.session);
      } else if (result.status === "outage") {
        setSessionState(result.session);
        setSessionIssue("temporary_outage");
        scheduleOutageRetry();
      } else {
        setSessionState(null);
        setSessionIssue("none");
      }
      setIsSessionReady(true);
    };

    void boot().catch(() => {
      setSessionState(null);
      setSessionIssue("temporary_outage");
      setIsSessionReady(true);
    });

    return () => {
      window.clearTimeout(timeout.current);
      unsubscribe();
    };
  }, [schedule, scheduleOutageRetry]);

  const value = useMemo(
    () => ({
      session,
      isSessionReady,
      sessionIssue,
      setSession,
      clearSession
    }),
    [clearSession, isSessionReady, session, sessionIssue, setSession]
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession() {
  const context = useContext(AuthSessionContext);
  if (!context) {
    throw new Error("useAuthSession must be used within SessionRefreshProvider.");
  }
  return context;
}
