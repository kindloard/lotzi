import { resolveApiBaseUrl } from "./api-base";
import { isAbortError } from "./abort";
import { clearSessionEnvelope, ensureSession } from "./auth-refresh";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
  }
}

export interface ApiFetchMeta {
  status: number;
  headers: Headers;
  requestId: string | null;
  serverTiming: string | null;
}

export interface ApiFetchResult<TResponse> {
  data: TResponse;
  meta: ApiFetchMeta;
}

export async function apiFetch<TResponse>(
  path: string,
  init?: RequestInit
): Promise<TResponse> {
  const result = await apiFetchWithMeta<TResponse>(path, init);
  return result.data;
}

export async function apiFetchWithMeta<TResponse>(
  path: string,
  init?: RequestInit
): Promise<ApiFetchResult<TResponse>> {
  const headers = new Headers(init?.headers);
  setJsonContentTypeWhenNeeded(headers, init);
  const csrf = shouldSendCsrf(path, init?.method) ? csrfToken() : undefined;
  if (csrf) {
    headers.set("x-csrf-token", csrf);
  }
  const method = init?.method ?? "GET";
  const markPrefix = `api:${method}:${path}`;
  markPerformance(`${markPrefix}:request-start`);

  let response: Response;
  try {
    response = await sendApiRequest(path, init, headers);
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new ApiError(
      "Connection error. Please check your internet and try again.",
      0,
      { cause: error instanceof Error ? error.message : "network_error" }
    );
  }
  markPerformance(`${markPrefix}:response`);

  const body = await readBody(response);
  measurePerformance(`${markPrefix}:duration`, `${markPrefix}:request-start`, `${markPrefix}:response`);
  if (
    !response.ok &&
    response.status === 401 &&
    shouldRefreshAfterUnauthorized(path) &&
    shouldRefreshForAuthCode(body)
  ) {
    const refreshed = await ensureSession({
      forceRefresh: true,
      signal: init?.signal ?? undefined,
      reason: `api_401:${path}`
    });
    if (refreshed.status === "authenticated") {
      const retryHeaders = new Headers(init?.headers);
      setJsonContentTypeWhenNeeded(retryHeaders, init);
      const retryCsrf = shouldSendCsrf(path, init?.method) ? csrfToken() : undefined;
      if (retryCsrf) {
        retryHeaders.set("x-csrf-token", retryCsrf);
      }
      const retry = await sendApiRequest(path, init, retryHeaders);
      const retryBody = await readBody(retry);
      if (retry.status === 401 && shouldRefreshForAuthCode(retryBody)) {
        clearSessionEnvelope({ broadcast: true });
        console.warn("REFRESH_CORRUPT_ACCESS", { path, status: retry.status });
      }
      if (!retry.ok) {
        throw new ApiError(
          extractErrorMessage(retryBody) ?? `API request failed: ${retry.status}`,
          retry.status,
          retryBody
        );
      }
      return responseResult<TResponse>(retry, retryBody);
    }
  }
  if (!response.ok) {
    throw new ApiError(
      extractErrorMessage(body) ?? `API request failed: ${response.status}`,
      response.status,
      body
    );
  }

  return responseResult<TResponse>(response, body);
}

function responseResult<TResponse>(response: Response, body: unknown): ApiFetchResult<TResponse> {
  return {
    data: body as TResponse,
    meta: {
      status: response.status,
      headers: response.headers,
      requestId: response.headers.get("x-request-id"),
      serverTiming: response.headers.get("server-timing") ?? response.headers.get("Server-Timing")
    }
  };
}

function setJsonContentTypeWhenNeeded(headers: Headers, init?: RequestInit) {
  if (!headers.has("Content-Type") && typeof init?.body === "string") {
    headers.set("Content-Type", "application/json");
  }
}

function sendApiRequest(path: string, init: RequestInit | undefined, headers: Headers) {
  return fetch(`${resolveApiBaseUrl()}${path}`, {
    ...init,
    cache: init?.cache ?? "no-store",
    credentials: init?.credentials ?? "include",
    headers
  });
}

function markPerformance(name: string) {
  if (typeof performance !== "undefined" && "mark" in performance) {
    performance.mark(name);
  }
}

function measurePerformance(name: string, startMark: string, endMark: string) {
  if (typeof performance !== "undefined" && "measure" in performance) {
    try {
      performance.measure(name, startMark, endMark);
    } catch {
      // Missing marks should never break auth.
    }
  }
}

function shouldSendCsrf(path: string, method = "GET") {
  if (method.toUpperCase() === "GET") {
    return false;
  }

  if (isPublicAuthPath(path)) {
    return false;
  }

  return true;
}

function isPublicAuthPath(path: string) {
  return [
    "/auth/signup",
    "/auth/signup/verify",
    "/auth/otp/resend",
    "/auth/login",
    "/auth/google",
    "/auth/password-reset/request",
    "/auth/password-reset/confirm",
    "/auth/redirect/rejected"
  ].includes(path) || path.startsWith("/v1/auth/");
}

function shouldRefreshAfterUnauthorized(path: string) {
  return !isPublicAuthPath(path) && path !== "/auth/refresh";
}

function shouldRefreshForAuthCode(body: unknown) {
  const code = errorCode(body);
  return (
    code === "AUTH_ACCESS_MISSING" ||
    code === "AUTH_ACCESS_INVALID" ||
    code === "UNAUTHORIZED"
  );
}

function csrfToken() {
  return cookieValue("lotzi_csrf") ?? cookieValue("__Host-csrf");
}

function cookieValue(name: string) {
  if (typeof document === "undefined") {
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

function extractErrorMessage(body: unknown) {
  if (body && typeof body === "object" && "message" in body) {
    const message = (body as { message?: unknown }).message;
    return Array.isArray(message) ? message.join(", ") : String(message);
  }
  return undefined;
}

function errorCode(body: unknown) {
  if (body && typeof body === "object" && "code" in body) {
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}
