"use client";

import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertCircle,
  BadgeCheck,
  Building2,
  Check,
  Clock3,
  FileText,
  Loader2,
  LockKeyhole,
  LogOut,
  Mail,
  MapPin,
  Phone,
  RefreshCcw,
  Search,
  ShieldCheck,
  Store,
  UserRound,
  XCircle
} from "lucide-react";
import { useToast } from "@/components/toast/toast-context";
import {
  AdminApiError,
  AdminApprovalReview,
  AdminApprovalsResponse,
  adminLogin,
  adminLogout,
  approveMerchant,
  fetchAdminSession,
  fetchMerchantApprovals,
  rejectMerchant
} from "@/lib/admin-approvals-api";

type SessionStatus = "checking" | "authenticated" | "unauthenticated";

export function AdminMerchantApprovalsScreen() {
  const toast = useToast();
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("checking");
  const [password, setPassword] = useState("");
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginPending, setLoginPending] = useState(false);
  const [data, setData] = useState<AdminApprovalsResponse | null>(null);
  const [loadingApprovals, setLoadingApprovals] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [rejectingStoreId, setRejectingStoreId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");

  const loadApprovals = useCallback(async () => {
    setLoadingApprovals(true);
    try {
      const response = await fetchMerchantApprovals();
      setData(response);
      setSelectedId((current) => current ?? response.reviews[0]?.id ?? null);
    } catch (error) {
      if (error instanceof AdminApiError && error.status === 401) {
        setSessionStatus("unauthenticated");
        setData(null);
        return;
      }
      toast.error(errorMessage(error, "Unable to load merchant approvals."));
    } finally {
      setLoadingApprovals(false);
    }
  }, [toast]);

  useEffect(() => {
    let cancelled = false;
    fetchAdminSession()
      .then(() => {
        if (cancelled) {
          return;
        }
        setSessionStatus("authenticated");
        void loadApprovals();
      })
      .catch(() => {
        if (!cancelled) {
          setSessionStatus("unauthenticated");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [loadApprovals]);

  const filteredReviews = useMemo(() => {
    const reviews = data?.reviews ?? [];
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return reviews;
    }
    return reviews.filter((review) =>
      [
        review.store.name,
        review.store.slug,
        review.store.owner.email,
        review.store.owner.fullName,
        review.store.business?.category,
        review.store.business?.businessType,
        review.store.address.city,
        review.store.address.state,
        review.store.business?.gstin,
        review.store.business?.registrationNumber
      ]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(normalizedQuery))
    );
  }, [data?.reviews, query]);

  useEffect(() => {
    if (filteredReviews.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !filteredReviews.some((review) => review.id === selectedId)) {
      setSelectedId(filteredReviews[0].id);
    }
  }, [filteredReviews, selectedId]);

  const selectedReview = filteredReviews.find((review) => review.id === selectedId) ?? filteredReviews[0] ?? null;

  const handleLogin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLoginError(null);
    setLoginPending(true);
    try {
      await adminLogin(password);
      setPassword("");
      setSessionStatus("authenticated");
      toast.success("Admin session unlocked.");
      await loadApprovals();
    } catch (error) {
      const message = errorMessage(error, "Admin login failed.");
      setLoginError(message);
      toast.error(message);
    } finally {
      setLoginPending(false);
    }
  };

  const handleLogout = async () => {
    try {
      await adminLogout();
    } catch {
      // Clearing local state is still safe if the cookie has already expired.
    }
    setData(null);
    setSelectedId(null);
    setSessionStatus("unauthenticated");
  };

  const handleApprove = async (review: AdminApprovalReview) => {
    setPendingAction(`approve:${review.storeId}`);
    try {
      await approveMerchant(review.storeId);
      removeReview(review.id, "approved");
      toast.success(`${review.store.name} approved.`);
    } catch (error) {
      toast.error(errorMessage(error, "Approval failed."));
    } finally {
      setPendingAction(null);
    }
  };

  const handleReject = async (review: AdminApprovalReview) => {
    const reason = rejectionReason.trim();
    if (reason.length < 3) {
      toast.warning("Add a short rejection reason.");
      return;
    }
    setPendingAction(`reject:${review.storeId}`);
    try {
      await rejectMerchant(review.storeId, reason);
      removeReview(review.id, "rejected");
      setRejectingStoreId(null);
      setRejectionReason("");
      toast.success(`${review.store.name} rejected.`);
    } catch (error) {
      toast.error(errorMessage(error, "Rejection failed."));
    } finally {
      setPendingAction(null);
    }
  };

  const removeReview = (reviewId: string, outcome: "approved" | "rejected") => {
    setData((current) => {
      if (!current) {
        return current;
      }
      const nextReviews = current.reviews.filter((review) => review.id !== reviewId);
      return {
        summary: {
          ...current.summary,
          pending: Math.max(0, current.summary.pending - 1),
          approved: outcome === "approved" ? current.summary.approved + 1 : current.summary.approved,
          rejected: outcome === "rejected" ? current.summary.rejected + 1 : current.summary.rejected
        },
        reviews: nextReviews
      };
    });
  };

  if (sessionStatus === "checking") {
    return <AdminLoading />;
  }

  if (sessionStatus === "unauthenticated") {
    return (
      <AdminLogin
        error={loginError}
        onSubmit={handleLogin}
        password={password}
        pending={loginPending}
        setPassword={setPassword}
      />
    );
  }

  const summary = data?.summary ?? { pending: 0, approved: 0, rejected: 0 };
  const oldestReview = data?.reviews[0]?.submittedAt ?? null;
  const averageRisk =
    data && data.reviews.length > 0
      ? Math.round(data.reviews.reduce((total, review) => total + review.riskScore, 0) / data.reviews.length)
      : 0;

  return (
    <main className="min-h-[100dvh] bg-slate-50 text-slate-950">
      <header className="border-b border-brand-strong/20 bg-brand">
        <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6 lg:px-8">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-black text-brand">
                  <ShieldCheck size={20} />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-black/60">
                    Lotzi admin
                  </p>
                  <h1 className="truncate text-2xl font-black tracking-tight text-black">
                    Merchant approvals
                  </h1>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-4 text-sm font-black text-slate-700 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-950/10 disabled:opacity-60"
                disabled={loadingApprovals}
                onClick={() => void loadApprovals()}
                type="button"
              >
                <RefreshCcw className={loadingApprovals ? "animate-spin" : ""} size={16} />
                Refresh
              </button>
              <button
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-950/10"
                onClick={() => void handleLogout()}
                type="button"
              >
                <LogOut size={16} />
                Logout
              </button>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric icon={Clock3} label="Pending" value={String(summary.pending)} tone="amber" />
            <Metric icon={BadgeCheck} label="Approved" value={String(summary.approved)} tone="emerald" />
            <Metric icon={XCircle} label="Rejected" value={String(summary.rejected)} tone="rose" />
            <Metric icon={AlertCircle} label="Avg risk" value={`${averageRisk}/100`} tone="slate" sub={oldestReview ? `Oldest ${relativeDate(oldestReview)}` : "Queue empty"} />
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-[1500px] gap-4 px-4 py-4 sm:px-6 lg:grid-cols-[420px_minmax(0,1fr)] lg:px-8">
        <aside className="min-h-[520px] rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-200 p-4">
            <label className="relative block">
              <span className="sr-only">Search merchants</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              <input
                className="h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm font-bold text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-4 focus:ring-slate-950/5"
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search name, city, owner, GSTIN"
                type="search"
                value={query}
              />
            </label>
          </div>

          <div className="max-h-[calc(100dvh-300px)] min-h-[440px] overflow-y-auto p-2">
            {loadingApprovals && !data ? (
              <ListSkeleton />
            ) : filteredReviews.length > 0 ? (
              <div className="space-y-2">
                {filteredReviews.map((review) => (
                  <ReviewRow
                    key={review.id}
                    onSelect={() => setSelectedId(review.id)}
                    review={review}
                    selected={selectedReview?.id === review.id}
                  />
                ))}
              </div>
            ) : (
              <EmptyQueue query={query} />
            )}
          </div>
        </aside>

        <ApprovalDetail
          loading={loadingApprovals && !selectedReview}
          onApprove={handleApprove}
          onCancelReject={() => {
            setRejectingStoreId(null);
            setRejectionReason("");
          }}
          onReject={handleReject}
          pendingAction={pendingAction}
          rejectionReason={rejectionReason}
          rejectingStoreId={rejectingStoreId}
          review={selectedReview}
          setRejectingStoreId={setRejectingStoreId}
          setRejectionReason={setRejectionReason}
        />
      </section>
    </main>
  );
}

function AdminLoading() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 text-slate-950">
      <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-black shadow-sm">
        <Loader2 className="animate-spin text-teal-700" size={18} />
        Checking admin session
      </div>
    </main>
  );
}

function AdminLogin({
  error,
  onSubmit,
  password,
  pending,
  setPassword
}: {
  error: string | null;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  password: string;
  pending: boolean;
  setPassword: (value: string) => void;
}) {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-slate-50 px-4 py-10 text-slate-950">
      <form
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.10)]"
        onSubmit={onSubmit}
      >
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-lg bg-slate-950 text-white">
            <LockKeyhole size={20} />
          </span>
          <div>
            <p className="text-[11px] font-black uppercase tracking-[0.16em] text-teal-700">Restricted</p>
            <h1 className="text-2xl font-black tracking-tight">Admin approvals</h1>
          </div>
        </div>

        <label className="mt-7 block">
          <span className="text-sm font-black text-slate-700">Password</span>
          <input
            autoComplete="current-password"
            autoFocus
            className="mt-2 h-12 w-full rounded-lg border border-slate-200 bg-white px-4 text-base font-bold text-slate-950 outline-none transition placeholder:text-slate-400 focus:border-slate-950 focus:ring-4 focus:ring-slate-950/5"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Admin password"
            type="password"
            value={password}
          />
        </label>

        {error && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">
            {error}
          </div>
        )}

        <button
          className="mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-black text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-950/10 disabled:opacity-60"
          disabled={pending || !password}
          type="submit"
        >
          {pending ? <Loader2 className="animate-spin" size={17} /> : <ShieldCheck size={17} />}
          Unlock console
        </button>
      </form>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  tone,
  sub
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: "amber" | "emerald" | "rose" | "slate";
  sub?: string;
}) {
  const toneClass = {
    amber: "bg-amber-50 text-amber-700 border-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-100",
    rose: "bg-rose-50 text-rose-700 border-rose-100",
    slate: "bg-slate-100 text-slate-700 border-slate-200"
  }[tone];

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-black tracking-tight text-slate-950">{value}</p>
          {sub && <p className="mt-1 text-xs font-bold text-slate-500">{sub}</p>}
        </div>
        <span className={`flex size-9 items-center justify-center rounded-lg border ${toneClass}`}>
          <Icon size={17} />
        </span>
      </div>
    </div>
  );
}

function ReviewRow({
  onSelect,
  review,
  selected
}: {
  onSelect: () => void;
  review: AdminApprovalReview;
  selected: boolean;
}) {
  const business = review.store.business;
  return (
    <button
      className={`w-full rounded-lg border p-3 text-left transition focus:outline-none focus:ring-4 focus:ring-slate-950/10 ${
        selected
          ? "border-slate-950 bg-slate-950 text-white shadow-sm"
          : "border-slate-200 bg-white text-slate-950 hover:border-slate-300 hover:bg-slate-50"
      }`}
      onClick={onSelect}
      type="button"
    >
      <div className="flex gap-3">
        <StoreAvatar name={review.store.name} selected={selected} />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center justify-between gap-2">
            <p className="truncate text-sm font-black">{review.store.name}</p>
            <RiskBadge riskScore={review.riskScore} compact selected={selected} />
          </div>
          <p className={`mt-1 truncate text-xs font-bold ${selected ? "text-slate-300" : "text-slate-500"}`}>
            {business?.category ? humanize(business.category) : "Uncategorized"} · {review.store.address.city ?? "City missing"}
          </p>
          <p className={`mt-2 truncate text-xs font-semibold ${selected ? "text-slate-300" : "text-slate-500"}`}>
            Submitted {relativeDate(review.submittedAt)}
          </p>
        </div>
      </div>
    </button>
  );
}

function ApprovalDetail({
  loading,
  onApprove,
  onCancelReject,
  onReject,
  pendingAction,
  rejectionReason,
  rejectingStoreId,
  review,
  setRejectingStoreId,
  setRejectionReason
}: {
  loading: boolean;
  onApprove: (review: AdminApprovalReview) => void;
  onCancelReject: () => void;
  onReject: (review: AdminApprovalReview) => void;
  pendingAction: string | null;
  rejectionReason: string;
  rejectingStoreId: string | null;
  review: AdminApprovalReview | null;
  setRejectingStoreId: (storeId: string) => void;
  setRejectionReason: (value: string) => void;
}) {
  if (loading) {
    return <DetailSkeleton />;
  }

  if (!review) {
    return (
      <section className="flex min-h-[520px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center">
        <div>
          <BadgeCheck className="mx-auto text-emerald-600" size={34} />
          <h2 className="mt-4 text-xl font-black tracking-tight">No pending merchants</h2>
          <p className="mt-2 max-w-sm text-sm font-semibold leading-6 text-slate-500">
            The approval queue is clear.
          </p>
        </div>
      </section>
    );
  }

  const business = review.store.business;
  const address = review.store.address;
  const branding = review.store.branding;
  const approving = pendingAction === `approve:${review.storeId}`;
  const rejecting = pendingAction === `reject:${review.storeId}`;
  const isRejecting = rejectingStoreId === review.storeId;

  return (
    <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-200 p-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex min-w-0 gap-4">
            <StoreAvatar name={review.store.name} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="truncate text-2xl font-black tracking-tight text-slate-950">
                  {review.store.name}
                </h2>
                <RiskBadge riskScore={review.riskScore} />
              </div>
              <p className="mt-1 text-sm font-bold text-slate-500">
                {business?.businessType ? humanize(business.businessType) : "Business type missing"} · {review.store.slug}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <StatusPill icon={Clock3} label={review.store.onboarding?.lifecycle ?? "APPROVAL_PENDING"} />
                <StatusPill icon={BadgeCheck} label={`${review.store.onboarding?.completionPercent ?? 100}% complete`} />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-rose-200 bg-white px-4 text-sm font-black text-rose-700 transition hover:bg-rose-50 focus:outline-none focus:ring-4 focus:ring-rose-500/10 disabled:opacity-60"
              disabled={Boolean(pendingAction)}
              onClick={() => setRejectingStoreId(review.storeId)}
              type="button"
            >
              <XCircle size={16} />
              Reject
            </button>
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700 focus:outline-none focus:ring-4 focus:ring-emerald-500/15 disabled:opacity-60"
              disabled={Boolean(pendingAction)}
              onClick={() => void onApprove(review)}
              type="button"
            >
              {approving ? <Loader2 className="animate-spin" size={16} /> : <Check size={16} />}
              Approve
            </button>
          </div>
        </div>
      </div>

      {isRejecting && (
        <div className="border-b border-rose-100 bg-rose-50 p-5">
          <label className="block">
            <span className="text-sm font-black text-rose-800">Rejection reason</span>
            <textarea
              className="mt-2 min-h-24 w-full resize-none rounded-lg border border-rose-200 bg-white p-3 text-sm font-semibold text-slate-950 outline-none transition focus:border-rose-600 focus:ring-4 focus:ring-rose-500/10"
              maxLength={500}
              onChange={(event) => setRejectionReason(event.target.value)}
              placeholder="Reason shared in the audit trail"
              value={rejectionReason}
            />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-rose-600 px-4 text-sm font-black text-white transition hover:bg-rose-700 disabled:opacity-60"
              disabled={rejecting || rejectionReason.trim().length < 3}
              onClick={() => void onReject(review)}
              type="button"
            >
              {rejecting ? <Loader2 className="animate-spin" size={16} /> : <XCircle size={16} />}
              Confirm rejection
            </button>
            <button
              className="inline-flex h-10 items-center justify-center rounded-lg border border-rose-200 bg-white px-4 text-sm font-black text-rose-700 transition hover:bg-rose-50"
              onClick={onCancelReject}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="grid gap-6 p-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <InfoSection icon={Building2} title="Business">
            <InfoGrid>
              <InfoLine label="Business name" value={business?.businessName ?? review.store.name} />
              <InfoLine label="Category" value={business?.category ? humanize(business.category) : null} />
              <InfoLine label="Legal name" value={business?.legalName} />
              <InfoLine label="Country" value={business?.country} />
              <InfoLine label="GSTIN" value={business?.gstin} />
              <InfoLine label="Registration" value={business?.registrationNumber} />
            </InfoGrid>
          </InfoSection>

          <InfoSection icon={MapPin} title="Location">
            <InfoGrid>
              <InfoLine label="Address" value={address.line} />
              <InfoLine label="City" value={address.city} />
              <InfoLine label="State" value={address.state} />
              <InfoLine label="Pincode" value={address.pincode} />
              <InfoLine label="Latitude" value={address.latitude?.toString()} />
              <InfoLine label="Longitude" value={address.longitude?.toString()} />
            </InfoGrid>
          </InfoSection>

          <InfoSection icon={FileText} title="Review signals">
            <div className="flex flex-wrap gap-2">
              {review.reasonCodes.length > 0 ? (
                review.reasonCodes.map((reason) => (
                  <span
                    className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-black text-amber-800"
                    key={reason}
                  >
                    {humanize(reason)}
                  </span>
                ))
              ) : (
                <span className="text-sm font-bold text-slate-500">No risk reasons captured.</span>
              )}
            </div>
          </InfoSection>
        </div>

        <aside className="space-y-6">
          <InfoSection icon={UserRound} title="Owner">
            <InfoLine label="Name" value={review.store.owner.fullName ?? "Not provided"} />
            <InfoLine icon={Mail} label="Email" value={review.store.owner.email} />
            <InfoLine icon={Phone} label="Store phone" value={review.store.phone ?? business?.phone} />
            <InfoLine label="Contact email" value={review.store.email ?? business?.contactEmail} />
          </InfoSection>

          <InfoSection icon={Store} title="Brand">
            <InfoLine label="Tagline" value={branding?.tagline} />
            <InfoLine label="Description" value={branding?.description} />
            <div className="mt-3 flex items-center gap-3">
              <ColorSwatch color={branding?.primaryColor} label="Primary" />
              <ColorSwatch color={branding?.accentColor} label="Accent" />
            </div>
          </InfoSection>

          <InfoSection icon={Clock3} title="Timeline">
            <InfoLine label="Submitted" value={formatDate(review.submittedAt)} />
            <InfoLine label="State version" value={String(review.store.onboarding?.version ?? 1)} />
            <InfoLine label="Current step" value={review.store.onboarding?.currentStep} />
          </InfoSection>
        </aside>
      </div>
    </section>
  );
}

function StoreAvatar({
  name,
  selected = false,
  size = "md"
}: {
  name: string;
  selected?: boolean;
  size?: "md" | "lg";
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "S";
  const sizeClass = size === "lg" ? "size-14 text-base" : "size-10 text-sm";
  return (
    <span
      className={`flex shrink-0 items-center justify-center rounded-lg font-black ${
        selected ? "bg-white text-slate-950" : "bg-teal-50 text-teal-800"
      } ${sizeClass}`}
    >
      {initials}
    </span>
  );
}

function RiskBadge({
  compact = false,
  riskScore,
  selected = false
}: {
  compact?: boolean;
  riskScore: number;
  selected?: boolean;
}) {
  const tone =
    riskScore >= 70
      ? selected
        ? "border-rose-300 bg-rose-100 text-rose-800"
        : "border-rose-200 bg-rose-50 text-rose-700"
      : riskScore >= 35
        ? selected
          ? "border-amber-300 bg-amber-100 text-amber-800"
          : "border-amber-200 bg-amber-50 text-amber-700"
        : selected
          ? "border-emerald-300 bg-emerald-100 text-emerald-800"
          : "border-emerald-200 bg-emerald-50 text-emerald-700";

  return (
    <span className={`shrink-0 rounded-full border font-black ${tone} ${compact ? "px-2 py-0.5 text-[11px]" : "px-3 py-1 text-xs"}`}>
      Risk {riskScore}
    </span>
  );
}

function StatusPill({ icon: Icon, label }: { icon: LucideIcon; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-black text-slate-700">
      <Icon size={13} />
      {humanize(label)}
    </span>
  );
}

function InfoSection({
  children,
  icon: Icon,
  title
}: {
  children: ReactNode;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <section>
      <div className="mb-3 flex items-center gap-2 border-b border-slate-100 pb-2">
        <Icon className="text-slate-500" size={17} />
        <h3 className="text-sm font-black uppercase tracking-[0.12em] text-slate-500">{title}</h3>
      </div>
      {children}
    </section>
  );
}

function InfoGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2">{children}</div>;
}

function InfoLine({
  icon: Icon,
  label,
  value
}: {
  icon?: LucideIcon;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-xs font-black uppercase tracking-[0.12em] text-slate-400">
        {Icon && <Icon size={12} />}
        {label}
      </p>
      <p className="mt-1 break-words text-sm font-bold leading-6 text-slate-900">
        {value || "Not provided"}
      </p>
    </div>
  );
}

function ColorSwatch({ color, label }: { color?: string | null; label: string }) {
  return (
    <div className="min-w-0">
      <span
        className="block size-9 rounded-lg border border-slate-200 shadow-inner"
        style={{ backgroundColor: color || "#f1f5f9" }}
      />
      <p className="mt-1 text-xs font-black text-slate-500">{label}</p>
    </div>
  );
}

function ListSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2, 3].map((item) => (
        <div className="h-24 animate-pulse rounded-lg border border-slate-200 bg-slate-100" key={item} />
      ))}
    </div>
  );
}

function DetailSkeleton() {
  return (
    <section className="min-h-[520px] rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
      <div className="h-20 animate-pulse rounded-lg bg-slate-100" />
      <div className="mt-6 grid gap-4 xl:grid-cols-2">
        {[0, 1, 2, 3].map((item) => (
          <div className="h-32 animate-pulse rounded-lg bg-slate-100" key={item} />
        ))}
      </div>
    </section>
  );
}

function EmptyQueue({ query }: { query: string }) {
  return (
    <div className="flex min-h-[380px] items-center justify-center px-4 text-center">
      <div>
        <BadgeCheck className="mx-auto text-emerald-600" size={32} />
        <p className="mt-4 text-base font-black text-slate-950">
          {query ? "No matching merchants" : "Approval queue is clear"}
        </p>
        <p className="mt-1 text-sm font-semibold text-slate-500">
          {query ? "Try a different search." : "New launched stores will appear here."}
        </p>
      </div>
    </div>
  );
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function humanize(value?: string | null) {
  if (!value) {
    return "";
  }
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .replace(/\w\S*/g, (part) => part[0].toUpperCase() + part.slice(1).toLowerCase());
}

function formatDate(value?: string | null) {
  if (!value) {
    return "Not provided";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Not provided";
  }
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);
}

function relativeDate(value?: string | null) {
  if (!value) {
    return "unknown";
  }
  const date = new Date(value);
  const deltaMs = Date.now() - date.getTime();
  if (Number.isNaN(deltaMs)) {
    return "unknown";
  }
  const minutes = Math.max(0, Math.floor(deltaMs / 60_000));
  if (minutes < 60) {
    return `${minutes || 1}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}
