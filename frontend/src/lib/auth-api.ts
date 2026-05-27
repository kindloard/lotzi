import { apiFetch } from "@/lib/api";

interface AuthRequestOptions {
  signal?: AbortSignal;
}

export interface AuthUser {
  id: string;
  email: string;
  fullName: string | null;
  avatarUrl: string | null;
  status: string;
  emailVerified: boolean;
  authzVersion: number;
  roleCodes: string[];
}

export interface SessionResponse {
  user: AuthUser;
  sessionId: string;
  accessTokenExpiresAt: string;
  routeState: {
    merchantStoreId: string | null;
    merchantStoreStatus: string | null;
    onboardingState: string | null;
    onboardingComplete: boolean;
    redirectTo: string;
  };
  redirectTo: string;
}

export function signup(
  input: {
    name: string;
    email: string;
    password: string;
    accountType?: "CUSTOMER" | "MERCHANT";
    storeName?: string;
  },
  options: AuthRequestOptions = {}
) {
  return apiFetch<{ status: string; email: string; cooldownUntil?: string }>("/auth/signup", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(input)
  });
}

export function verifySignup(input: { email: string; otp: string }, options: AuthRequestOptions = {}) {
  return apiFetch<SessionResponse>("/auth/signup/verify", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(input)
  });
}

export function resendSignupOtp(input: { email: string }, options: AuthRequestOptions = {}) {
  return apiFetch<{ status: string; email: string; cooldownUntil?: string }>("/auth/otp/resend", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(input)
  });
}

export function login(
  input: { email: string; password: string; remember?: boolean },
  options: AuthRequestOptions = {}
) {
  return apiFetch<SessionResponse>("/auth/login", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(input)
  });
}

export function googleLogin(
  idToken: string,
  options: AuthRequestOptions = {}
) {
  return apiFetch<SessionResponse>("/auth/google", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify({ idToken })
  });
}

export function googleLink(input: { idToken: string; password: string }, options: AuthRequestOptions = {}) {
  return apiFetch<SessionResponse>("/auth/google/link", {
    method: "POST",
    signal: options.signal,
    body: JSON.stringify(input)
  });
}

export function requestPasswordReset(email: string) {
  return apiFetch<{ status: string }>("/auth/password-reset/request", {
    method: "POST",
    body: JSON.stringify({ email })
  });
}

export function confirmPasswordReset(input: { token: string; newPassword: string }) {
  return apiFetch<{ status: string }>("/auth/password-reset/confirm", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function refreshSession() {
  return apiFetch<SessionResponse>("/auth/refresh", { method: "POST" });
}

export function currentSession() {
  return apiFetch<SessionResponse>("/auth/session");
}

export function logout() {
  return apiFetch<{ status: string }>("/auth/logout", { method: "POST" });
}

export function reportRejectedRedirect(input: { value: string; reason: string; sessionId?: string }) {
  return apiFetch<{ status: string }>("/auth/redirect/rejected", {
    method: "POST",
    body: JSON.stringify(input)
  });
}
