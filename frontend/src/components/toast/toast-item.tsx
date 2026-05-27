"use client";

import { useEffect } from "react";
import { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Loader2,
  X,
  XCircle
} from "lucide-react";
import { ToastRecord, ToastVariant } from "@/components/toast/toast-context";

const variantStyles: Record<ToastVariant, { icon: ReactNode; className: string }> = {
  success: {
    icon: <CheckCircle2 size={18} />,
    className: "border-emerald-200 bg-emerald-50 text-emerald-700"
  },
  error: {
    icon: <XCircle size={18} />,
    className: "border-rose-200 bg-rose-50 text-rose-700"
  },
  warning: {
    icon: <AlertTriangle size={18} />,
    className: "border-amber-200 bg-amber-50 text-amber-700"
  },
  info: {
    icon: <Info size={18} />,
    className: "border-blue-200 bg-blue-50 text-blue-700"
  },
  loading: {
    icon: <Loader2 className="animate-spin" size={18} />,
    className: "border-slate-200 bg-white text-slate-700"
  }
};

export function ToastItem({
  dismiss,
  toast
}: {
  dismiss: (id: string) => void;
  toast: ToastRecord;
}) {
  useEffect(() => {
    if (!toast.duration) {
      return undefined;
    }
    const timer = window.setTimeout(() => dismiss(toast.id), toast.duration);
    return () => window.clearTimeout(timer);
  }, [dismiss, toast.duration, toast.id]);

  const styles = variantStyles[toast.variant];

  return (
    <div
      aria-live={toast.variant === "error" ? "assertive" : "polite"}
      className={`toast-enter pointer-events-auto overflow-hidden rounded-[12px] border p-3 shadow-[0_18px_48px_rgba(15,23,42,0.16)] ${styles.className}`}
      role="status"
    >
      <div className="grid grid-cols-[auto_1fr_auto] gap-3">
        <span className="mt-0.5">{styles.icon}</span>
        <div className="min-w-0">
          {toast.title && (
            <p className="text-[13px] font-black leading-5 text-slate-950">{toast.title}</p>
          )}
          <p className="text-[13px] font-extrabold leading-5">{toast.message}</p>
          {toast.action && (
            <button
              className="mt-2 rounded-full bg-white px-3 py-1 text-[12px] font-black text-slate-950 shadow-sm transition hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-950/10"
              onClick={() => {
                toast.action?.onClick();
                dismiss(toast.id);
              }}
              type="button"
            >
              {toast.action.label}
            </button>
          )}
        </div>
        <button
          aria-label="Dismiss notification"
          className="flex size-7 items-center justify-center rounded-full text-slate-500 transition hover:bg-white/70 hover:text-slate-950 focus:outline-none focus:ring-4 focus:ring-slate-950/10"
          onClick={() => dismiss(toast.id)}
          type="button"
        >
          <X size={15} />
        </button>
      </div>
      {toast.duration > 0 && (
        <div
          className="toast-progress mt-3 h-0.5 rounded-full bg-current/30"
          style={{ animationDuration: `${toast.duration}ms` }}
        />
      )}
    </div>
  );
}
