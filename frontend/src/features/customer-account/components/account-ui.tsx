"use client";

import { AlertTriangle, RefreshCcw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export function Panel({
  action,
  children,
  eyebrow,
  title
}: {
  action?: ReactNode;
  children: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="min-w-0 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm sm:p-5">
      <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{eyebrow}</p>
          <h2 className="mt-1 truncate text-lg font-semibold tracking-tight text-zinc-950">{title}</h2>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}

export function Avatar({
  avatarUrl,
  initials,
  size = "md"
}: {
  avatarUrl: string | null;
  initials: string;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const sizeClass =
    size === "xl"
      ? "size-24 text-2xl sm:size-28"
      : size === "lg"
        ? "size-14 text-base"
        : size === "sm"
          ? "size-9 text-xs"
          : "size-11 text-sm";

  return (
    <span
      className={`${sizeClass} flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-zinc-950 bg-cover bg-center font-bold text-white`}
      role="img"
      style={avatarUrl ? { backgroundImage: `url(${avatarUrl})` } : undefined}
    >
      {!avatarUrl && initials}
    </span>
  );
}

export function EmptyState({
  body,
  compact = false,
  icon: Icon,
  title
}: {
  body: string;
  compact?: boolean;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <section
      className={`flex items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-white p-8 text-center ${
        compact ? "min-h-40" : "min-h-[320px]"
      }`}
    >
      <div>
        <Icon className="mx-auto text-zinc-400" size={32} />
        <h2 className="mt-4 text-base font-semibold text-zinc-950">{title}</h2>
        <p className="mt-2 max-w-sm text-sm leading-6 text-zinc-500">{body}</p>
      </div>
    </section>
  );
}

export function SectionError({
  body,
  compact = false,
  onRetry,
  title
}: {
  body: string;
  compact?: boolean;
  onRetry: () => void;
  title: string;
}) {
  return (
    <section className={`rounded-lg border border-rose-200 bg-rose-50 p-5 ${compact ? "" : "min-h-[260px]"}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 shrink-0 text-rose-700" size={20} />
        <div>
          <h2 className="text-sm font-semibold text-rose-950">{title}</h2>
          <p className="mt-1 text-sm leading-6 text-rose-700">{body}</p>
          <button
            className="mt-3 inline-flex h-9 items-center gap-2 rounded-lg bg-rose-700 px-3 text-xs font-semibold text-white transition hover:bg-rose-800"
            onClick={onRetry}
            type="button"
          >
            <RefreshCcw size={13} />
            Retry
          </button>
        </div>
      </div>
    </section>
  );
}

export function AccountShellSkeleton() {
  return (
    <main className="min-h-screen bg-zinc-50 px-4 py-4 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-[1500px] gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        <div className="hidden min-h-[calc(100vh-48px)] animate-pulse rounded-lg border border-zinc-200 bg-white lg:block" />
        <div className="space-y-4">
          <div className="h-24 animate-pulse rounded-lg border border-zinc-200 bg-white" />
          <SectionSkeleton />
        </div>
      </div>
    </main>
  );
}

export function SectionSkeleton() {
  return (
    <div className="space-y-4">
      <div className="h-72 animate-pulse rounded-lg border border-zinc-200 bg-white" />
      <div className="grid gap-4 md:grid-cols-2">
        <div className="h-44 animate-pulse rounded-lg border border-zinc-200 bg-white" />
        <div className="h-44 animate-pulse rounded-lg border border-zinc-200 bg-white" />
      </div>
    </div>
  );
}

export function InlineSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, index) => (
        <div className="h-12 animate-pulse rounded-lg bg-zinc-100" key={index} />
      ))}
    </div>
  );
}

export function TextField({
  className,
  disabled,
  label,
  onChange,
  placeholder,
  type = "text",
  value
}: {
  className?: string;
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  value: string;
}) {
  return (
    <label className={`block ${className ?? ""}`}>
      <span className="text-[13px] font-semibold text-zinc-700">{label}</span>
      <input
        className="mt-2 h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5 disabled:bg-zinc-50 disabled:text-zinc-500"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type={type}
        value={value}
      />
    </label>
  );
}

export function Button({
  disabled,
  icon: Icon,
  label,
  onClick,
  type = "button",
  variant = "primary"
}: {
  disabled?: boolean;
  icon?: LucideIcon;
  label: string;
  onClick?: () => void;
  type?: "button" | "submit";
  variant?: "primary" | "secondary" | "danger";
}) {
  const classes =
    variant === "danger"
      ? "border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100"
      : variant === "secondary"
        ? "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50"
        : "border-zinc-950 bg-zinc-950 text-white hover:bg-zinc-900";

  return (
    <button
      className={`inline-flex min-h-10 min-w-0 items-center justify-center gap-2 rounded-lg border px-4 text-sm font-semibold shadow-sm transition disabled:pointer-events-none disabled:opacity-60 ${classes}`}
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {Icon && <Icon className="shrink-0" size={15} />}
      <span className="truncate">{label}</span>
    </button>
  );
}
