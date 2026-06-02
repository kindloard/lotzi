import { resolveApiBaseUrl } from "./api-base";

export class AdminApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown
  ) {
    super(message);
  }
}

export interface AdminApprovalSummary {
  pending: number;
  approved: number;
  rejected: number;
}

export interface AdminApprovalReview {
  id: string;
  storeId: string;
  status: string;
  riskScore: number;
  reasonCodes: string[];
  submittedAt: string | null;
  reviewedAt: string | null;
  store: {
    id: string;
    name: string;
    slug: string;
    status: string;
    phone: string | null;
    email: string | null;
    owner: {
      id: string;
      email: string;
      fullName: string | null;
    };
    address: {
      line: string | null;
      city: string | null;
      state: string | null;
      pincode: string | null;
      latitude: number | null;
      longitude: number | null;
    };
    business: {
      businessName: string;
      category: string | null;
      businessType: string | null;
      country: string;
      legalName: string | null;
      taxId: string | null;
      gstin: string | null;
      registrationNumber: string | null;
      contactEmail: string | null;
      phone: string | null;
      verificationStatus: string;
    } | null;
    branding: {
      tagline: string | null;
      description: string | null;
      primaryColor: string | null;
      accentColor: string | null;
      logoUrl: string | null;
      bannerUrl: string | null;
    } | null;
    settings: {
      businessHours: unknown;
    } | null;
    onboarding: {
      lifecycle: string;
      currentStep: string;
      completionPercent: number;
      version: number;
      approvalSubmittedAt: string | null;
    } | null;
  };
}

export interface AdminApprovalsResponse {
  summary: AdminApprovalSummary;
  reviews: AdminApprovalReview[];
}

export interface AdminSessionResponse {
  authenticated: boolean;
  sessionId?: string;
  expiresAt?: string;
}

export interface AdminDecisionResponse {
  storeId: string;
  status: string;
  reviewStatus: string;
  state: {
    lifecycle: string;
    currentStep: string;
    completionPercent: number;
    version: number;
  };
  reviewedAt: string;
}

export function adminLogin(password: string) {
  return adminFetch<AdminSessionResponse>("/admin/merchant-approvals/login", {
    method: "POST",
    body: JSON.stringify({ password })
  });
}

export function adminLogout() {
  return adminFetch<AdminSessionResponse>("/admin/merchant-approvals/logout", {
    method: "POST",
    body: JSON.stringify({})
  });
}

export function fetchAdminSession() {
  return adminFetch<AdminSessionResponse>("/admin/merchant-approvals/session");
}

export function fetchMerchantApprovals() {
  return adminFetch<AdminApprovalsResponse>("/admin/merchant-approvals");
}

export function approveMerchant(storeId: string, note?: string) {
  return adminFetch<AdminDecisionResponse>(`/admin/merchant-approvals/${storeId}/approve`, {
    method: "POST",
    body: JSON.stringify({ note })
  });
}

export function rejectMerchant(storeId: string, reason: string) {
  return adminFetch<AdminDecisionResponse>(`/admin/merchant-approvals/${storeId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason })
  });
}

async function adminFetch<TResponse>(path: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");

  const method = init.method ?? "GET";
  if (method.toUpperCase() !== "GET") {
    const csrf = cookieValue("lotzi_admin_csrf");
    if (csrf) {
      headers.set("x-admin-csrf", csrf);
    }
  }

  let response: Response;
  try {
    response = await fetch(`${resolveApiBaseUrl()}${path}`, {
      ...init,
      credentials: "include",
      headers
    });
  } catch (error) {
    throw new AdminApiError(
      "Connection failed. Please check the API server and try again.",
      0,
      { cause: error instanceof Error ? error.message : "network_error" }
    );
  }

  const body = await readBody(response);
  if (!response.ok) {
    throw new AdminApiError(
      extractErrorMessage(body) ?? `Admin API request failed: ${response.status}`,
      response.status,
      body
    );
  }

  return body as TResponse;
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
