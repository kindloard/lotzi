"use client";

import {
  Archive,
  ArrowDown,
  ArrowUp,
  BadgeCheck,
  ChevronRight,
  Layers3,
  Pencil,
  Plus,
  Trash2
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { FocusEvent, KeyboardEvent, ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { Product } from "../../types/dashboard";
import { cx } from "../../lib/dashboard-utils";
import { dashboardStatusKey, dashboardStatusTone } from "../../lib/dashboard-i18n";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";

export function ConfirmDialog({
  body,
  confirmLabel,
  onCancel,
  onConfirm,
  title
}: {
  body: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
}) {
  const t = useTranslations("dashboard");
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/40 px-4 backdrop-blur-sm">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl">
        <h2 className="text-base font-semibold tracking-tight text-zinc-950">{title}</h2>
        <p className="mt-2 text-[13px] font-normal leading-relaxed text-zinc-500">{body}</p>
        <div className="mt-5 flex justify-end gap-2">
          <DashboardButton label={t("common.cancel")} onClick={onCancel} variant="secondary" />
          <DashboardButton icon={Archive} label={confirmLabel} onClick={onConfirm} />
        </div>
      </section>
    </div>
  );
}

export function PageTitle({
  actions,
  eyebrow,
  title
}: {
  actions?: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <section className="space-y-3 py-0 lg:flex lg:items-center lg:justify-between lg:gap-4 lg:space-y-0 lg:py-1">
      <div className="hidden lg:block">
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-400">{eyebrow}</p>
        <h1 className="mt-1.5 text-2xl font-semibold tracking-tight text-zinc-950 sm:text-3xl">{title}</h1>
      </div>
      {actions && (
        <div className="scrollbar-hide -mx-4 flex min-w-0 justify-end gap-2 overflow-x-auto px-4 pb-1 sm:-mx-6 sm:px-6 lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0 lg:pb-0">
          {actions}
        </div>
      )}
    </section>
  );
}

export function Panel({
  action,
  children,
  className,
  eyebrow,
  headerClassName,
  title
}: {
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  eyebrow?: string;
  headerClassName?: string;
  title: string;
}) {
  return (
    <section className={cx("min-w-0 overflow-hidden rounded-xl border border-zinc-200/70 bg-white p-4 shadow-sm sm:rounded-2xl sm:p-6 lg:p-8", className)}>
      <div className={cx("mb-4 flex min-w-0 flex-wrap items-start justify-between gap-3 sm:mb-5", headerClassName)}>
        <div className="min-w-0">
          {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400">{eyebrow}</p>}
          <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-950">{title}</h2>
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function KpiCard({
  delta,
  icon: Icon,
  label,
  tone,
  value
}: {
  delta: string;
  icon: LucideIcon;
  label: string;
  tone?: "positive" | "urgent" | "negative" | "neutral";
  value: string;
}) {
  const resolvedTone = tone ?? (delta.startsWith("+") ? "positive" : delta.startsWith("-") ? "negative" : "neutral");
  const positive = resolvedTone === "positive";
  const urgent = resolvedTone === "urgent";
  const isNegative = resolvedTone === "negative";

  return (
    <article className="min-w-0 rounded-xl border border-zinc-200/70 bg-white p-3.5 shadow-sm sm:rounded-2xl sm:p-5">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[9px] font-semibold uppercase tracking-[0.08em] text-zinc-400 sm:text-[10px] sm:tracking-wider">{label}</span>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-900 sm:size-9">
          <Icon size={15} />
        </span>
      </div>
      <div className="mt-3 flex min-w-0 items-baseline gap-2 sm:mt-4">
        <span className="min-w-0 break-words text-xl font-semibold tracking-tight text-zinc-950 font-sans tabular-nums sm:text-2xl">{value}</span>
      </div>
      <div className="mt-2">
        <span className={cx(
          "inline-flex max-w-full items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium sm:px-2 sm:text-[11px]",
          positive && "bg-emerald-50 text-emerald-800 border border-emerald-200/60",
          urgent && "bg-rose-50 text-rose-800 border border-rose-200/60",
          isNegative && "bg-rose-50 text-rose-800 border border-rose-200/60",
          !positive && !urgent && !isNegative && "bg-zinc-50 text-zinc-600 border border-zinc-200/60"
        )}>
          {positive && delta.startsWith("+") && <ArrowUp size={11} className="shrink-0" />}
          {isNegative && <ArrowDown size={11} className="shrink-0" />}
          {delta}
        </span>
      </div>
    </article>
  );
}

export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("flex max-w-full flex-col gap-3 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm lg:flex-row lg:items-center", className)}>
      {children}
    </div>
  );
}

export function DashboardButton({
  disabled = false,
  icon: Icon,
  label,
  onClick,
  showLabelOnMobile = false,
  variant = "primary"
}: {
  disabled?: boolean;
  icon?: LucideIcon;
  label: string;
  onClick?: () => void;
  showLabelOnMobile?: boolean;
  variant?: "primary" | "secondary";
}) {
  return (
    <button
      aria-label={label}
      className={cx(
        "inline-flex h-10 shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-4 text-[13px] font-medium transition disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-4 focus:ring-zinc-950/5",
        variant === "primary"
          ? "bg-zinc-950 text-white shadow-sm hover:bg-zinc-900 border border-zinc-950"
          : "border border-zinc-200 bg-white text-zinc-800 shadow-sm hover:bg-zinc-50 hover:text-zinc-950"
      )}
      disabled={disabled}
      onClick={onClick}
      title={label}
      type="button"
    >
      {Icon && <Icon size={14} />}
      <span className={cx(Icon && !showLabelOnMobile && "hidden sm:inline")}>{label}</span>
    </button>
  );
}

export function IconButton({ children, label, onClick }: { children: ReactNode; label: string; onClick?: () => void }) {
  return (
    <button
      aria-label={label}
      className="flex size-10 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-600 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
      onClick={onClick}
      title={label}
      type="button"
    >
      {children}
    </button>
  );
}

export function PanelAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      className="rounded-xl border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 shadow-sm transition hover:border-zinc-300 hover:text-zinc-950"
      onClick={onClick}
      type="button"
    >
      {label}
    </button>
  );
}

export function Insight({ detail, label, value }: { detail: string; label: string; value: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-zinc-50/40 p-4" title={`${label}: ${value} (${detail})`}>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400 truncate">{label}</p>
      <p className="mt-1.5 text-lg font-semibold tracking-tight text-zinc-950 truncate tabular-nums">{value}</p>
      <p className="mt-1 text-[11px] font-normal text-zinc-500 truncate">{detail}</p>
    </div>
  );
}

export function StatusBadge({ label }: { label: string }) {
  const t = useTranslations("dashboard");
  const key = dashboardStatusKey(label);
  const tone = dashboardStatusTone(label);
  const colorClasses =
    tone === "success"
      ? "border-emerald-200/60 bg-emerald-50/60 text-emerald-800"
      : tone === "danger"
        ? "border-rose-200/60 bg-rose-50/60 text-rose-800"
        : tone === "warning"
          ? "border-amber-200/60 bg-amber-50/60 text-amber-800"
          : "border-zinc-200 bg-zinc-50 text-zinc-600";
  const dotClass =
    tone === "success"
      ? "bg-emerald-500"
      : tone === "danger"
        ? "bg-rose-500"
        : tone === "warning"
          ? "bg-amber-500"
          : "bg-zinc-400";
  const displayLabel = key ? t(key as never) : label;
  
  return (
    <span className={cx("inline-flex max-w-full items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium", colorClasses)}>
      <span className={cx("size-1.5 rounded-full", dotClass)} />
      <span className="truncate">{displayLabel}</span>
    </span>
  );
}

export function SegmentedControl({
  onChange,
  options,
  value
}: {
  onChange: (value: string) => void;
  options: Array<string | { label: string; value: string }>;
  value: string;
}) {
  return (
    <div className="scrollbar-hide flex w-max max-w-full gap-1 overflow-x-auto rounded-xl border border-zinc-200 bg-zinc-50/50 p-1.5">
      {options.map((item) => {
        const option = typeof item === "string" ? { label: item, value: item } : item;
        return (
        <button
          className={cx(
            "shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-medium transition",
            value === option.value ? "bg-zinc-950 text-white shadow-sm" : "text-zinc-500 hover:bg-white hover:text-zinc-950"
          )}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
        );
      })}
    </div>
  );
}

export function ProductCard({
  onArchive,
  onDuplicate,
  onEdit,
  product
}: {
  onArchive: () => void;
  onDuplicate: () => void;
  onEdit: () => void;
  product: Product;
}) {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const displayName = product.unitDisplay ? `${product.name} - ${product.unitDisplay}` : product.name;
  return (
    <article className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm hover:border-zinc-300 transition-colors">
      <div
        className="aspect-[4/3] rounded-xl bg-zinc-50 bg-cover bg-center"
        style={{ backgroundImage: product.images[0] ? `url(${product.images[0].url})` : undefined }}
      />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold text-zinc-950">{displayName}</p>
          <p className="mt-0.5 truncate text-[11px] font-normal text-zinc-500 font-mono tracking-normal">{product.sku || product.productType || product.subCategory || product.category}</p>
        </div>
        <StatusBadge label={product.status} />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <Insight label={t("common.price")} value={format.currency(product.price)} detail={product.pricePerBaseUnitDisplay ?? t("common.live")} />
        <Insight label={t("common.stock")} value={format.number(product.stock)} detail={t("common.onHand")} />
        <Insight label={t("common.sales")} value={format.number(product.sales)} detail={t("common.total")} />
      </div>
      <div className="mt-3 flex justify-end gap-1">
        <IconButton label={t("products.duplicate")} onClick={onDuplicate}>
          <Layers3 size={14} />
        </IconButton>
        <IconButton label={t("products.edit")} onClick={onEdit}>
          <Pencil size={14} />
        </IconButton>
        <IconButton label={t("products.archive")} onClick={onArchive}>
          <Trash2 size={14} />
        </IconButton>
      </div>
    </article>
  );
}

export function ProductThumb({ product }: { product: Product }) {
  return (
    <span
      aria-label={product.name}
      className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 bg-cover bg-center text-[10px] font-semibold text-zinc-500"
      role="img"
      style={{ backgroundImage: product.images[0] ? `url(${product.images[0].url})` : undefined }}
    >
      {!product.images[0] && product.name.slice(0, 2).toUpperCase()}
    </span>
  );
}

export function EmptyState({
  actionIcon,
  actionLabel,
  body,
  icon: Icon,
  onAction,
  title
}: {
  actionIcon?: LucideIcon;
  actionLabel?: string;
  body: string;
  icon: LucideIcon;
  onAction?: () => void;
  title: string;
}) {
  return (
    <section className="flex min-h-[320px] items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-white p-8 text-center">
      <div>
        <Icon className="mx-auto text-zinc-400" size={32} />
        <h2 className="mt-4 text-base font-semibold tracking-tight text-zinc-950">{title}</h2>
        <p className="mt-2 max-w-xs text-xs font-normal leading-relaxed text-zinc-500">{body}</p>
        {actionLabel && onAction && (
          <div className="mt-5">
            <DashboardButton icon={actionIcon ?? Plus} label={actionLabel} onClick={onAction} showLabelOnMobile />
          </div>
        )}
      </div>
    </section>
  );
}

export function SettingsPanel({ icon: Icon, rows, title }: { icon: LucideIcon; rows: string[]; title: string }) {
  const t = useTranslations("dashboard");
  return (
    <Panel title={title} eyebrow={t("common.configurable")}>
      <div className="mb-4 flex size-9 items-center justify-center rounded-xl bg-zinc-950 text-white">
        <Icon size={15} />
      </div>
      <div className="divide-y divide-zinc-100">
        {rows.map((item) => (
          <div className="flex items-center justify-between py-3" key={item}>
            <span className="text-[13px] font-semibold text-zinc-800">{item}</span>
            <ChevronRight size={15} className="text-zinc-400" />
          </div>
        ))}
      </div>
    </Panel>
  );
}

export function ChecklistItem({ done, label }: { done: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-zinc-100 py-3 last:border-0">
      <span className={cx("flex size-6 items-center justify-center rounded-full border", done ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-400")}>
        <BadgeCheck size={13} />
      </span>
      <span className="text-[13px] font-medium text-zinc-800">{label}</span>
    </div>
  );
}

export function SectionHeading({ body, title }: { body: string; title: string }) {
  return (
    <div>
      <h3 className="text-base font-semibold tracking-tight text-zinc-950">{title}</h3>
      <p className="mt-1 max-w-2xl text-[12px] font-normal leading-relaxed text-zinc-500">{body}</p>
    </div>
  );
}

export function FormGrid({ children }: { children: ReactNode }) {
  return <div className="grid gap-4 md:grid-cols-2">{children}</div>;
}

export function FormField({
  label,
  onChange,
  placeholder,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  value: string;
}) {
  return (
    <label className="block" data-auto-scroll-field>
      <span className="text-[13px] font-medium text-zinc-700">{label}</span>
      <input
        className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-normal text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5"
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        value={value}
      />
    </label>
  );
}

type NumberInputMode = "decimal" | "integer";

export function NumberField({
  error,
  label,
  mode = "decimal",
  onChange,
  value
}: {
  error?: string;
  label: string;
  mode?: NumberInputMode;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <SmartNumberInput
      error={error}
      label={label}
      mode={mode}
      onChange={onChange}
      value={value}
    />
  );
}

export function InlineInput({ error, label, onChange, value }: { error?: string; label: string; onChange: (value: string) => void; value: string }) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  return (
    <div className="block w-full" data-auto-scroll-field>
      <label className="block" htmlFor={inputId}>
        <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{label}</span>
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          className={cx(
            "mt-1 h-9 w-full rounded-lg border bg-white px-2.5 text-[13px] font-normal text-zinc-950 outline-none transition focus:ring-2 focus:ring-zinc-950/5",
            error ? "border-rose-300 focus:border-rose-500" : "border-zinc-200 focus:border-zinc-950"
          )}
          id={inputId}
          onChange={(event) => onChange(event.target.value)}
          value={value}
        />
      </label>
      {error && <span className="mt-1 block text-[10px] font-medium leading-snug text-rose-600" id={errorId}>{error}</span>}
    </div>
  );
}

export function InlineNumber({
  error,
  label,
  mode = "decimal",
  onChange,
  value
}: {
  error?: string;
  label: string;
  mode?: NumberInputMode;
  onChange: (value: number) => void;
  value: number;
}) {
  return (
    <SmartNumberInput
      compact
      error={error}
      label={label}
      mode={mode}
      onChange={onChange}
      value={value}
    />
  );
}

function SmartNumberInput({
  compact = false,
  error,
  label,
  mode,
  onChange,
  value
}: {
  compact?: boolean;
  error?: string;
  label: string;
  mode: NumberInputMode;
  onChange: (value: number) => void;
  value: number;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [isFocused, setIsFocused] = useState(false);
  const [textValue, setTextValue] = useState(() => formatNumericValue(value, mode));

  useEffect(() => {
    if (!isFocused) {
      setTextValue(formatNumericValue(value, mode));
    }
  }, [isFocused, mode, value]);

  const commitText = (rawValue: string) => {
    const nextText = sanitizeNumericText(rawValue, mode);
    setTextValue(nextText);
    onChange(toNumericValue(nextText, mode));
  };

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    setIsFocused(true);
    if (value === 0) {
      setTextValue("");
      return;
    }
    event.currentTarget.select();
  };

  const handleBlur = () => {
    setIsFocused(false);
    const nextValue = toNumericValue(textValue, mode);
    onChange(nextValue);
    setTextValue(formatNumericValue(nextValue, mode));
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (["e", "E", "+", "-"].includes(event.key) || (mode === "integer" && event.key === ".")) {
      event.preventDefault();
    }
  };

  return (
    <div className="block w-full" data-auto-scroll-field>
      <label className="block" htmlFor={inputId}>
        <span className={compact ? "text-[10px] font-semibold uppercase tracking-wider text-zinc-400" : "text-[13px] font-medium text-zinc-700"}>{label}</span>
        <input
          aria-describedby={error ? errorId : undefined}
          aria-invalid={Boolean(error)}
          autoComplete="off"
          className={cx(
            compact
              ? "mt-1 h-9 rounded-lg px-2.5 focus:ring-2"
              : "mt-2 h-10 rounded-xl px-3 focus:ring-4",
            "w-full border bg-white text-[13px] font-normal tabular-nums text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:ring-zinc-950/5",
            error ? "border-rose-300 focus:border-rose-500" : "border-zinc-200 focus:border-zinc-950"
          )}
          id={inputId}
          inputMode={mode === "integer" ? "numeric" : "decimal"}
          onBlur={handleBlur}
          onChange={(event) => commitText(event.target.value)}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          pattern={mode === "integer" ? "[0-9]*" : "[0-9]*[.]?[0-9]*"}
          type="text"
          value={textValue}
        />
      </label>
      {error && <span className="mt-1 block text-[10px] font-medium leading-snug text-rose-600" id={errorId}>{error}</span>}
    </div>
  );
}

function sanitizeNumericText(rawValue: string, mode: NumberInputMode) {
  if (mode === "integer") {
    return stripLeadingZeros(rawValue.replace(/\D/g, ""));
  }

  const normalized = rawValue.replace(/[^\d.]/g, "");
  const [integerPart = "", ...fractionParts] = normalized.split(".");
  const hasDecimal = normalized.includes(".");
  const integer = stripLeadingZeros(integerPart);
  const fraction = fractionParts.join("").replace(/\D/g, "").slice(0, 2);

  if (!hasDecimal) {
    return integer;
  }

  return `${integer || "0"}.${fraction}`;
}

function stripLeadingZeros(value: string) {
  if (!value) {
    return "";
  }
  return value.replace(/^0+(?=\d)/, "");
}

function toNumericValue(value: string, mode: NumberInputMode) {
  if (!value || value === ".") {
    return 0;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return 0;
  }
  if (mode === "integer") {
    return Math.floor(parsed);
  }
  return Math.round(parsed * 100) / 100;
}

function formatNumericValue(value: number, mode: NumberInputMode) {
  const safeValue = Number.isFinite(value) && value > 0 ? value : 0;
  if (mode === "integer") {
    return String(Math.floor(safeValue));
  }
  return String(Math.round(safeValue * 100) / 100);
}

/* ─── Recent Order Row ───────────────────────────────────── */

export function RecentOrderRow({
  customer,
  total,
  status,
  placedAt,
  items
}: {
  customer: string;
  total: string;
  status: string;
  placedAt: string;
  items: number;
}) {
  const format = useDashboardFormatters();
  return (
    <div className="group flex items-center gap-3 rounded-xl border border-transparent px-3 py-3 transition hover:border-zinc-200 hover:bg-zinc-50/60">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-[11px] font-bold text-zinc-600 group-hover:bg-zinc-950 group-hover:text-white transition-colors">
        {customer.split(/\s+/).map((w) => w[0]?.toUpperCase()).join("").slice(0, 2) || "?"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-zinc-950">{customer}</p>
        <p className="mt-0.5 text-[11px] text-zinc-400">{items} item{items !== 1 ? "s" : ""} · {format.relativeDate(placedAt)}</p>
      </div>
      <div className="text-right shrink-0">
        <p className="text-[13px] font-semibold tabular-nums text-zinc-950">{total}</p>
        <StatusBadge label={status} />
      </div>
    </div>
  );
}

/* ─── Status Distribution Bar ────────────────────────────── */

export function StatusDistributionBar({
  data,
}: {
  data: Array<{ status: string; count: number; color: string }>;
}) {
  const total = data.reduce((s, d) => s + d.count, 0);
  if (total === 0) {
    return null;
  }

  return (
    <div className="space-y-4">
      {/* stacked bar */}
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100">
        {data.map((d) => (
          <div
            className="transition-all duration-500"
            key={d.status}
            style={{
              width: `${(d.count / total) * 100}%`,
              backgroundColor: d.color,
              minWidth: d.count > 0 ? "4px" : "0"
            }}
            title={`${d.status}: ${d.count}`}
          />
        ))}
      </div>
      {/* legend */}
      <div className="flex flex-wrap gap-x-5 gap-y-2">
        {data.map((d) => (
          <div className="flex items-center gap-2" key={d.status}>
            <span
              className="size-2.5 rounded-full"
              style={{ backgroundColor: d.color }}
            />
            <span className="text-[11px] font-medium text-zinc-600">
              {d.status}
            </span>
            <span className="text-[11px] font-bold tabular-nums text-zinc-950">
              {d.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
