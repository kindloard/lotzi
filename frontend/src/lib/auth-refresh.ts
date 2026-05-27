import { resolveApiBaseUrl } from "@/lib/api-base";
import type { SessionResponse } from "@/lib/auth-api";
import { isAbortError } from "@/lib/abort";

export const SESSION_ENVELOPE_KEY = "namastore:session-envelope:v2";

const SESSION_MIRROR_KEY = "namastore:session-envelope-tab:v2";
const CHANNEL_NAME = "namastore-auth-session";
const LOCK_NAME = "namastore-auth-refresh";
const FALLBACK_LOCK_KEY = "namastore:auth-refresh-lock:v2";
const CLOCK_SKEW_MS = 45_000;
const REFRESH_LEAD_MS = 60_000;
const RACE_RETRY_DELAY_MS = 500;
const OUTAGE_RETRY_DELAYS_MS = [1_000] as const;
const REFRESH_OUTAGE_COOLDOWN_MS = 15_000;

export interface SessionEnvelope {
  version: 2;
  generation: number;
  writtenAt: string;
  session: SessionResponse;
}

export type SessionEvent =
  | { type: "session-refreshed"; generation: number }
  | { type: "session-cleared" };

export type EnsureSessionResult =
  | { status: "authenticated"; source: "cache" | "refresh" | "broadcast"; session: SessionResponse }
  | { status: "logged_out"; reason: string }
  | { status: "outage"; reason: string; session: SessionResponse | null };

let inFlight: Promise<EnsureSessionResult> | null = null;
let refreshOutageUntil = 0;
let refreshOutageReason = "refresh_unavailable";

export function ensureSession(options: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
  reason?: string;
} = {}): Promise<EnsureSessionResult> {
  if (!isBrowser()) {
    return Promise.resolve({ status: "logged_out", reason: "server_runtime" });
  }

  if (!options.forceRefresh) {
    const cached = readFreshEnvelope();
    if (cached) {
      return Promise.resolve({
        status: "authenticated",
        source: "cache",
        session: cached.session
      });
    }
  }

  if (!hasReadableAuthHint()) {
    clearSessionEnvelope({ broadcast: false });
    return Promise.resolve({ status: "logged_out", reason: "csrf_missing" });
  }

  const suppressed = currentRefreshOutage();
  if (suppressed) {
    return Promise.resolve({
      status: "outage",
      reason: suppressed.reason,
      session: readSessionEnvelope()?.session ?? null
    });
  }

  if (!inFlight) {
    inFlight = withRefreshLock(() => performRefreshRecovery(options)).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

export function storeSessionEnvelope(session: SessionResponse, options: { broadcast?: boolean } = {}) {
  if (!isBrowser()) {
    return;
  }
  const previous = readSessionEnvelope();
  const envelope: SessionEnvelope = {
    version: 2,
    generation: Math.max(previous?.generation ?? 0, Date.now()) + 1,
    writtenAt: new Date().toISOString(),
    session
  };
  const serialized = JSON.stringify(envelope);
  localStorage.setItem(SESSION_ENVELOPE_KEY, serialized);
  sessionStorage.setItem(SESSION_MIRROR_KEY, serialized);
  clearRefreshOutage();
  if (options.broadcast ?? true) {
    broadcast({ type: "session-refreshed", generation: envelope.generation });
  }
}

export function clearSessionEnvelope(options: { broadcast?: boolean } = {}) {
  if (!isBrowser()) {
    return;
  }
  localStorage.removeItem(SESSION_ENVELOPE_KEY);
  sessionStorage.removeItem(SESSION_MIRROR_KEY);
  clearRefreshOutage();
  if (options.broadcast ?? true) {
    broadcast({ type: "session-cleared" });
  }
}

export function readSessionEnvelope(): SessionEnvelope | null {
  if (!isBrowser()) {
    return null;
  }
  const envelope = parseEnvelope(localStorage.getItem(SESSION_ENVELOPE_KEY));
  if (envelope) {
    sessionStorage.setItem(SESSION_MIRROR_KEY, JSON.stringify(envelope));
    return envelope;
  }
  return parseEnvelope(sessionStorage.getItem(SESSION_MIRROR_KEY));
}

export function readFreshEnvelope(skewMs = CLOCK_SKEW_MS): SessionEnvelope | null {
  const envelope = readSessionEnvelope();
  if (!envelope) {
    return null;
  }
  if (!isSessionUsable(envelope.session, skewMs)) {
    return null;
  }
  return envelope;
}

export function hasReadableAuthHint(): boolean {
  return Boolean(csrfToken());
}

export function scheduleDelayForSession(session: SessionResponse): number {
  const expiresMs = new Date(session.accessTokenExpiresAt).getTime();
  return Math.max(5_000, expiresMs - Date.now() - REFRESH_LEAD_MS);
}

export function subscribeToSessionEvents(callback: (event: SessionEvent) => void) {
  if (!isBrowser()) {
    return () => undefined;
  }
  const channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL_NAME) : null;
  const onMessage = (event: MessageEvent) => {
    if (isSessionEvent(event.data)) {
      callback(event.data);
    }
  };
  const onStorage = (event: StorageEvent) => {
    if (event.key === SESSION_ENVELOPE_KEY && event.newValue) {
      const envelope = parseEnvelope(event.newValue);
      if (envelope) {
        callback({ type: "session-refreshed", generation: envelope.generation });
      }
    }
    if (event.key === SESSION_ENVELOPE_KEY && event.newValue === null) {
      callback({ type: "session-cleared" });
    }
  };
  channel?.addEventListener("message", onMessage);
  window.addEventListener("storage", onStorage);
  return () => {
    channel?.removeEventListener("message", onMessage);
    channel?.close();
    window.removeEventListener("storage", onStorage);
  };
}

async function performRefreshRecovery(options: {
  forceRefresh?: boolean;
  signal?: AbortSignal;
  reason?: string;
}): Promise<EnsureSessionResult> {
  if (!options.forceRefresh) {
    const freshFromStorage = readFreshEnvelope();
    if (freshFromStorage) {
      return {
        status: "authenticated",
        source: "broadcast",
        session: freshFromStorage.session
      };
    }
  }

  let outage: EnsureSessionResult | null = null;
  for (let attempt = 0; attempt <= OUTAGE_RETRY_DELAYS_MS.length; attempt += 1) {
    const result = await postRefresh(options.signal, attempt > 0);
    if (result.kind === "success") {
      storeSessionEnvelope(result.session, { broadcast: true });
      return { status: "authenticated", source: "refresh", session: result.session };
    }
    if (result.kind === "race") {
      const raceRecovery = readFreshEnvelope();
      if (raceRecovery) {
        return { status: "authenticated", source: "broadcast", session: raceRecovery.session };
      }
      await delay(RACE_RETRY_DELAY_MS, options.signal);
      const retry = await postRefresh(options.signal, true);
      if (retry.kind === "success") {
        storeSessionEnvelope(retry.session, { broadcast: true });
        return { status: "authenticated", source: "refresh", session: retry.session };
      }
      if (retry.kind === "race") {
        clearSessionEnvelope({ broadcast: true });
        return { status: "logged_out", reason: "refresh_race_unresolved" };
      }
      return outcomeFromRefreshFailure(retry);
    }
    if (result.kind === "invalid") {
      clearSessionEnvelope({ broadcast: true });
      return { status: "logged_out", reason: result.reason };
    }
    outage = { status: "outage", reason: result.reason, session: readSessionEnvelope()?.session ?? null };
    const retryDelay = OUTAGE_RETRY_DELAYS_MS[attempt];
    if (retryDelay === undefined) {
      break;
    }
    await delay(retryDelay, options.signal);
  }
  const finalOutage = outage ?? {
    status: "outage" as const,
    reason: "refresh_unavailable",
    session: readSessionEnvelope()?.session ?? null
  };
  rememberRefreshOutage(finalOutage.reason);
  return finalOutage;
}

async function postRefresh(
  signal: AbortSignal | undefined,
  isRetry: boolean
): Promise<
  | { kind: "success"; session: SessionResponse }
  | { kind: "invalid"; reason: string }
  | { kind: "race" }
  | { kind: "outage"; reason: string }
> {
  const headers = new Headers();
  const csrf = csrfToken();
  if (!csrf) {
    return { kind: "invalid", reason: "csrf_missing" };
  }
  headers.set("x-csrf-token", csrf);

  let response: Response;
  try {
    response = await fetch(`${resolveApiBaseUrl()}/auth/refresh`, {
      method: "POST",
      credentials: "include",
      headers,
      signal
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    return { kind: "outage", reason: isRetry ? "refresh_network_retry_failed" : "refresh_network" };
  }

  const body = await readBody(response);
  const code = errorCode(body);
  if (response.ok) {
    if (isSessionResponse(body)) {
      return { kind: "success", session: body };
    }
    clearSessionEnvelope({ broadcast: true });
    console.warn("REFRESH_CORRUPT_SESSION_PAYLOAD", { status: response.status });
    return { kind: "invalid", reason: "refresh_corrupt_session_payload" };
  }
  if (response.status === 409 && code === "AUTH_REFRESH_RACE") {
    return { kind: "race" };
  }
  if (
    response.status === 401 &&
    (code === "AUTH_REFRESH_INVALID" || code === "AUTH_REFRESH_MISSING" || code === "UNAUTHORIZED")
  ) {
    return { kind: "invalid", reason: code.toLowerCase() };
  }
  if (response.status >= 500 || response.status === 0) {
    return { kind: "outage", reason: `refresh_${response.status}` };
  }
  return { kind: "invalid", reason: code?.toLowerCase() ?? `refresh_${response.status}` };
}

async function withRefreshLock<T>(callback: () => Promise<T>): Promise<T> {
  if ("locks" in navigator && navigator.locks) {
    return navigator.locks.request(LOCK_NAME, callback);
  }

  const now = Date.now();
  const lockUntil = Number(localStorage.getItem(FALLBACK_LOCK_KEY) ?? "0");
  if (lockUntil > now) {
    await delay(Math.min(1_000, lockUntil - now));
    const fresh = readFreshEnvelope();
    if (fresh) {
      return {
        status: "authenticated",
        source: "broadcast",
        session: fresh.session
      } as T;
    }
  }

  localStorage.setItem(FALLBACK_LOCK_KEY, String(Date.now() + 15_000));
  try {
    return await callback();
  } finally {
    localStorage.removeItem(FALLBACK_LOCK_KEY);
  }
}

function outcomeFromRefreshFailure(
  result:
    | { kind: "invalid"; reason: string }
    | { kind: "outage"; reason: string }
): EnsureSessionResult {
  if (result.kind === "invalid") {
    clearSessionEnvelope({ broadcast: true });
    return { status: "logged_out", reason: result.reason };
  }
  rememberRefreshOutage(result.reason);
  return { status: "outage", reason: result.reason, session: readSessionEnvelope()?.session ?? null };
}

function currentRefreshOutage() {
  if (refreshOutageUntil <= Date.now()) {
    return null;
  }
  return { reason: refreshOutageReason };
}

function rememberRefreshOutage(reason: string) {
  refreshOutageReason = reason;
  refreshOutageUntil = Date.now() + REFRESH_OUTAGE_COOLDOWN_MS;
}

function clearRefreshOutage() {
  refreshOutageUntil = 0;
  refreshOutageReason = "refresh_unavailable";
}

function isSessionUsable(session: SessionResponse, skewMs: number): boolean {
  const expiresMs = new Date(session.accessTokenExpiresAt).getTime();
  return Number.isFinite(expiresMs) && expiresMs - skewMs > Date.now();
}

function parseEnvelope(raw: string | null): SessionEnvelope | null {
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SessionEnvelope>;
    if (
      parsed.version === 2 &&
      typeof parsed.generation === "number" &&
      typeof parsed.writtenAt === "string" &&
      isSessionResponse(parsed.session)
    ) {
      return parsed as SessionEnvelope;
    }
  } catch {
    // Corrupt storage is handled by replacing it on the next successful refresh.
  }
  return null;
}

function isSessionResponse(value: unknown): value is SessionResponse {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SessionResponse>;
  return (
    typeof candidate.sessionId === "string" &&
    typeof candidate.accessTokenExpiresAt === "string" &&
    Number.isFinite(new Date(candidate.accessTokenExpiresAt).getTime()) &&
    Boolean(candidate.user && typeof candidate.user === "object") &&
    Boolean(candidate.routeState && typeof candidate.routeState === "object") &&
    typeof candidate.redirectTo === "string"
  );
}

function isSessionEvent(value: unknown): value is SessionEvent {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<SessionEvent>;
  return (
    candidate.type === "session-cleared" ||
    (candidate.type === "session-refreshed" && typeof candidate.generation === "number")
  );
}

function broadcast(event: SessionEvent): void {
  if (!isBrowser() || !("BroadcastChannel" in window)) {
    return;
  }
  const channel = new BroadcastChannel(CHANNEL_NAME);
  channel.postMessage(event);
  channel.close();
}

function csrfToken() {
  return cookieValue("namastore_csrf") ?? cookieValue("__Host-csrf");
}

function cookieValue(name: string) {
  if (!isBrowser()) {
    return undefined;
  }
  return document.cookie
    .split("; ")
    .find((item) => item.startsWith(`${name}=`))
    ?.split("=")[1];
}

async function readBody(response: Response) {
  const text = await response.text();
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorCode(body: unknown) {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function delay(ms: number, signal?: AbortSignal) {
  if (!signal) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Operation aborted.", "AbortError"));
      return;
    }
    const timeout = window.setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException("Operation aborted.", "AbortError"));
      },
      { once: true }
    );
  });
}

function isBrowser() {
  return typeof window !== "undefined" && typeof document !== "undefined";
}
