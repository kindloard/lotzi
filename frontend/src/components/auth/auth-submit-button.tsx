"use client";

import { Check, Loader2, XCircle } from "lucide-react";

type ButtonTone = "default" | "success" | "error";

interface AuthSubmitButtonProps {
  disabled?: boolean;
  label: string;
  loading?: boolean;
  loadingLabel?: string;
  status?: ButtonTone;
  type?: "button" | "submit";
  onClick?: () => void;
}

export function AuthSubmitButton({
  disabled = false,
  label,
  loading = false,
  loadingLabel = "Please wait",
  status = "default",
  type = "submit",
  onClick
}: AuthSubmitButtonProps) {
  const stateClass =
    status === "success"
      ? "bg-brand text-zinc-950"
      : status === "error"
      ? "bg-rose-600 text-white"
      : "bg-zinc-950 text-white hover:bg-zinc-900 active:translate-y-px";

  return (
    <button
      className={`mt-5 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl text-[13px] font-medium text-white shadow-sm transition-all focus:outline-none focus:ring-4 focus:ring-zinc-950/5 disabled:cursor-not-allowed disabled:opacity-50 sm:mt-6 ${stateClass}`}
      data-i18n-fit
      disabled={disabled}
      onClick={onClick}
      type={type}
    >
      {status === "success" && <Check size={14} strokeWidth={2.5} />}
      {status === "error" && <XCircle size={14} strokeWidth={2} />}
      {loading && <Loader2 className="animate-spin" size={14} strokeWidth={2} />}
      <span>{loading ? loadingLabel : label}</span>
    </button>
  );
}
