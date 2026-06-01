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
      className="pointer-events-none fixed left-3 right-3 top-3 z-[1000] flex flex-col items-center gap-2 sm:left-auto sm:right-4 sm:top-4 sm:w-fit sm:items-end"
    >
      {toasts.map((toast) => (
        <ToastItem dismiss={dismiss} key={toast.id} toast={toast} />
      ))}
    </div>,
    document.body
  );
}
