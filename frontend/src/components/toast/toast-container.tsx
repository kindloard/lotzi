"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { ToastItem } from "@/components/toast/toast-item";
import { ToastRecord } from "@/components/toast/toast-context";

export function ToastContainer({
  dismiss,
  toasts
}: {
  dismiss: (id: string) => void;
  toasts: ToastRecord[];
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  return createPortal(
    <div
      className="pointer-events-none fixed left-1/2 top-3 z-[1000] flex w-[calc(100%-24px)] max-w-[256px] -translate-x-1/2 flex-col gap-2 sm:left-auto sm:right-4 sm:top-4 sm:w-[224px] sm:translate-x-0"
    >
      {toasts.map((toast) => (
        <ToastItem dismiss={dismiss} key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body
  );
}
