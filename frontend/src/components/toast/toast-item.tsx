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
    icon: <div className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-[#00e400] text-white"><Check size={14} strokeWidth={3} /></div>,
    className: "border-slate-200 bg-white text-slate-700"
  },
  error: {
    icon: <div className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-red-500 text-white"><X size={14} strokeWidth={3} /></div>,
    className: "border-slate-200 bg-white text-slate-700"
  },
  warning: {
    icon: <div className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-amber-500 text-white"><AlertTriangle size={14} strokeWidth={2.5} /></div>,
    className: "border-slate-200 bg-white text-slate-700"
  },
  info: {
    icon: <div className="flex size-[22px] shrink-0 items-center justify-center rounded-full bg-blue-500 text-white"><Info size={14} strokeWidth={2.5} /></div>,
    className: "border-slate-200 bg-white text-slate-700"
  },
  loading: {
    icon: <div className="flex size-[22px] shrink-0 items-center justify-center text-slate-500"><Loader2 className="animate-spin" size={18} strokeWidth={2.5} /></div>,
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
      className={`toast-enter pointer-events-auto overflow-hidden rounded-xl border px-3 py-2 shadow-lg ${styles.className}`}
      role="status"
    >
      <div className="flex items-center gap-2.5">
        <span className="shrink-0">{styles.icon}</span>
        <div className="min-w-0 py-0.5">
          {toast.title && (
            <p className="text-[12px] font-bold leading-snug">{toast.title}</p>
          )}
          <p className="text-[12px] font-semibold leading-snug">{toast.message}</p>
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
          className="ml-auto flex size-6 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-900 focus:outline-none"
          onClick={() => dismiss(toast.id)}
          type="button"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );
}
