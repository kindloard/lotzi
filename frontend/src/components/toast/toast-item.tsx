"use client";

import { useEffect } from "react";
import { ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  Info,
  Loader2,
  X
} from "lucide-react";
import { ToastRecord, ToastVariant } from "@/components/toast/toast-context";

const variantStyles: Record<ToastVariant, { icon: ReactNode; className: string }> = {
  success: {
    icon: <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-emerald-100"><Check size={18} strokeWidth={3} /></div>,
    className: "border-emerald-100 bg-white text-slate-800"
  },
  error: {
    icon: <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600 ring-1 ring-red-100"><X size={18} strokeWidth={3} /></div>,
    className: "border-red-100 bg-white text-slate-800"
  },
  warning: {
    icon: <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-100"><AlertTriangle size={18} strokeWidth={2.5} /></div>,
    className: "border-amber-100 bg-white text-slate-800"
  },
  info: {
    icon: <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-100"><Info size={18} strokeWidth={2.5} /></div>,
    className: "border-blue-100 bg-white text-slate-800"
  },
  loading: {
    icon: <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-50 text-slate-500 ring-1 ring-slate-100"><Loader2 className="animate-spin" size={18} strokeWidth={2.5} /></div>,
    className: "border-slate-200 bg-white text-slate-800"
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
      className={`toast-enter pointer-events-auto w-fit max-w-full overflow-hidden rounded-2xl border px-4 py-3 shadow-[0_18px_45px_-20px_rgba(15,23,42,0.55)] ring-1 ring-black/5 ${styles.className}`}
      role={toast.variant === "error" ? "alert" : "status"}
    >
      <div className="flex items-start gap-3">
        <span className="shrink-0">{styles.icon}</span>
        <div className="min-w-0 max-w-[calc(100vw-120px)] py-0.5 sm:max-w-[38ch]">
          {toast.title && (
            <p className="text-[13px] font-black leading-snug tracking-tight">{toast.title}</p>
          )}
          <p className="text-[14px] font-bold leading-snug tracking-normal text-slate-700">{toast.message}</p>
          {toast.action && (
            <button
              className="mt-2 rounded-full bg-slate-950 px-3 py-1.5 text-[12px] font-black text-white shadow-sm transition hover:bg-slate-800 focus:outline-none focus:ring-4 focus:ring-slate-950/10"
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
          className="-mr-1 -mt-1 flex size-7 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-950/10"
          onClick={() => dismiss(toast.id)}
          type="button"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
