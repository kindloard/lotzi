"use client";

import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState
} from "react";
import { ToastContainer } from "@/components/toast/toast-container";

export type ToastVariant = "success" | "error" | "warning" | "info" | "loading";

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastRecord {
  id: string;
  variant: ToastVariant;
  title?: string;
  message: string;
  duration: number;
  action?: ToastAction;
}

interface ToastOptions {
  title?: string;
  duration?: number;
  action?: ToastAction;
}

interface ToastContextValue {
  toasts: ToastRecord[];
  dismiss: (id: string) => void;
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  warning: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  loading: (message: string, options?: ToastOptions) => string;
}

const ToastContext = createContext<ToastContextValue | null>(null);
const MAX_VISIBLE_TOASTS = 5;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const addToast = useCallback(
    (variant: ToastVariant, message: string, options: ToastOptions = {}) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const toast: ToastRecord = {
        id,
        variant,
        message,
        title: options.title,
        duration: options.duration ?? (variant === "loading" ? 0 : 5000),
        action: options.action
      };
      setToasts((current) => [toast, ...current].slice(0, MAX_VISIBLE_TOASTS));
      return id;
    },
    []
  );

  const success = useCallback(
    (message: string, options?: ToastOptions) => addToast("success", message, options),
    [addToast]
  );
  const error = useCallback(
    (message: string, options?: ToastOptions) => addToast("error", message, options),
    [addToast]
  );
  const warning = useCallback(
    (message: string, options?: ToastOptions) => addToast("warning", message, options),
    [addToast]
  );
  const info = useCallback(
    (message: string, options?: ToastOptions) => addToast("info", message, options),
    [addToast]
  );
  const loading = useCallback(
    (message: string, options?: ToastOptions) => addToast("loading", message, options),
    [addToast]
  );

  const value = useMemo<ToastContextValue>(
    () => ({
      toasts,
      dismiss,
      success,
      error,
      warning,
      info,
      loading
    }),
    [dismiss, error, info, loading, success, toasts, warning]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer dismiss={dismiss} toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error("useToast must be used within ToastProvider.");
  }
  return context;
}
