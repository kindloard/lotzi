"use client";

import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { Check, CheckCircle2, Copy, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { getPaymentStatus, retryPayment, verifyPayment, type PaymentStatusResponse } from "@/features/checkout/checkout-api";
import { loadCashfree } from "@/features/checkout/cashfree-sdk";
import { useCart } from "@/lib/cart-context";
import { formatIndianRupees } from "@/lib/currency";
import {
  checkoutPaymentMethodLabel,
  checkoutPaymentStatusLabel,
  isCheckoutFailedPayment,
  isCheckoutSuccessPayment,
  isCheckoutTerminalPayment,
  isCodPayment,
  paymentToken
} from "@/lib/payment-display";

const VERIFY_POLL_INITIAL_MS = 1_000;
const VERIFY_POLL_MULTIPLIER = 1.6;
const VERIFY_POLL_JITTER = 0.2;
const VERIFY_POLL_CAP_MS = 8_000;
const VERIFY_POLL_MAX_ATTEMPTS = 10;

export default function CheckoutStatusPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { clearCart } = useCart();
  const paymentId = params.get("paymentId");
  const orderId = params.get("orderId");
  const provider = params.get("provider");
  const [status, setStatus] = useState<PaymentStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [copiedOrder, setCopiedOrder] = useState(false);
  const terminalRef = useRef(false);
  const pollAttemptRef = useRef(0);
  terminalRef.current = isCheckoutTerminalPayment(status?.payment);

  useEffect(() => {
    markCheckoutPerformance("status_page_ready");
    measureCheckoutPerformance("checkout_route_to_status_ready", "route_change_start", "status_page_ready");
  }, []);

  useEffect(() => {
    if (!paymentId) {
      setError("Payment reference is missing.");
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    pollAttemptRef.current = 0;
    terminalRef.current = false;

    const poll = async () => {
      if (disposed || terminalRef.current) return;
      pollAttemptRef.current += 1;
      try {
        const current = provider === "cod" ? await getPaymentStatus(paymentId) : null;
        const verified =
          current && (isCodPayment(current.payment) || isCheckoutTerminalPayment(current.payment))
            ? current
            : await verifyPayment(paymentId).catch(() => null);
        const next = verified ?? current ?? (await getPaymentStatus(paymentId));
        if (disposed) return;
        setStatus(next);
        if (isCheckoutSuccessPayment(next.payment)) {
          terminalRef.current = true;
          setError(null);
          clearCart();
          return;
        }
        if (isCheckoutTerminalPayment(next.payment)) {
          terminalRef.current = true;
          setError(null);
          return;
        }
        if (pollAttemptRef.current >= VERIFY_POLL_MAX_ATTEMPTS) {
          setError("Payment confirmation is taking longer than expected. You can safely track this order or retry from this page.");
          return;
        }
        if (next.recovery.action === "POLL" && !terminalRef.current) {
          timer = setTimeout(poll, checkoutVerifyPollDelay(pollAttemptRef.current, next.recovery.pollAfterMs));
          return;
        }
        if (next.recovery.action === "WAIT_RECONCILIATION") {
          setError("Payment confirmation is under reconciliation. Track the order while we sync the gateway record.");
        }
      } catch (pollError) {
        if (disposed) return;
        setError(pollError instanceof Error ? pollError.message : "Unable to check payment status.");
        if (!terminalRef.current && pollAttemptRef.current < VERIFY_POLL_MAX_ATTEMPTS) {
          timer = setTimeout(poll, checkoutVerifyPollDelay(pollAttemptRef.current));
        }
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [clearCart, paymentId, provider]);

  const handleRetry = async () => {
    if (!paymentId) return;
    setRetrying(true);
    setError(null);
    try {
      const session = await retryPayment(paymentId, crypto.randomUUID());
      if (session.redirectUrl) {
        window.location.assign(session.redirectUrl);
      } else if (session.paymentSessionId) {
        const cashfree = await loadCashfree();
        await cashfree.checkout({ paymentSessionId: session.paymentSessionId, redirectTarget: "_self" });
      } else {
        router.refresh();
      }
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "Unable to retry payment.");
    } finally {
      setRetrying(false);
    }
  };

  const paymentStatus = paymentToken(status?.payment.status);
  const paid = paymentStatus === "PAID";
  const codConfirmed = status ? isCodPayment(status.payment) && paymentStatus === "AUTHORIZED" : false;
  const authorized = paymentStatus === "AUTHORIZED";
  const successful = status ? isCheckoutSuccessPayment(status.payment) : false;
  const failed = status ? isCheckoutFailedPayment(status.payment) : false;
  const waiting = !successful && !failed;
  const displayError = successful ? null : error;
  const resolvedOrderId = orderId ?? status?.payment.orderId ?? null;
  const orderReference = shortReference(resolvedOrderId);
  const paymentMethodLabel = status ? checkoutPaymentMethodLabel(status.payment) : provider === "cod" ? "Cash on delivery" : "Payment";
  const statusLabel = codConfirmed ? "Confirmed" : status ? checkoutPaymentStatusLabel(status.payment) : "Checking";
  const statusToneClass = successful
    ? "bg-emerald-50 text-emerald-700"
    : failed
      ? "bg-rose-50 text-rose-700"
      : "bg-slate-100 text-slate-700";

  const copyOrderId = async () => {
    if (!resolvedOrderId) return;
    try {
      await navigator.clipboard.writeText(resolvedOrderId);
      setCopiedOrder(true);
      window.setTimeout(() => setCopiedOrder(false), 1600);
    } catch {
      setCopiedOrder(false);
    }
  };

  return (
    <main className="flex min-h-[100svh] items-center justify-center bg-slate-50 px-4 py-6 font-sans sm:px-6 lg:px-8">
      <section className="w-full max-w-[390px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_18px_50px_rgba(15,23,42,0.10)]">
        <div className="px-6 pb-5 pt-6 text-center">
          <span className={`mx-auto flex size-14 shrink-0 items-center justify-center rounded-lg ${
            successful ? "bg-emerald-50 text-emerald-600" : failed ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-700"
          }`}>
            {successful ? <CheckCircle2 size={26} /> : failed ? <XCircle size={26} /> : <Loader2 className="animate-spin" size={24} />}
          </span>
          <p className="mt-5 text-[11px] font-black uppercase tracking-[0.18em] text-slate-400">
            {codConfirmed ? "Cash on delivery" : "Secure payment"}
          </p>
          <h1 className="mt-2 text-2xl font-black text-slate-950">
            {paid
              ? "Payment confirmed"
              : codConfirmed
                ? "Order confirmed"
                : authorized
                  ? "Payment authorized"
                  : failed
                    ? "Payment needs attention"
                    : "Checking payment status"}
          </h1>
          <p className="mx-auto mt-3 max-w-[280px] text-sm font-semibold leading-6 text-slate-500">
            {paid
              ? "Your order is confirmed and inventory is locked for fulfillment."
              : codConfirmed
                ? "We have placed your order. Pay when the order is delivered."
                : authorized
                  ? "Your order is confirmed and the payment authorization is recorded."
                  : failed
                    ? "The payment did not complete. You can retry while the checkout is still active."
                    : "We are verifying gateway and server records before confirming your order."}
          </p>
        </div>

        <div className="border-y border-slate-100 px-6 py-2 text-sm">
          <div className="flex min-h-12 items-center justify-between gap-4">
            <span className="font-semibold text-slate-500">Order ref</span>
            <span className="inline-flex min-w-0 items-center gap-2">
              <span className="truncate font-black text-slate-950">{orderReference}</span>
              {resolvedOrderId ? (
                <button
                  aria-label="Copy order id"
                  className="inline-flex size-7 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-950"
                  onClick={copyOrderId}
                  title="Copy order id"
                  type="button"
                >
                  {copiedOrder ? <Check size={14} /> : <Copy size={14} />}
                </button>
              ) : null}
            </span>
          </div>
          <div className="flex min-h-12 items-center justify-between gap-4 border-t border-slate-100">
            <span className="font-semibold text-slate-500">Payment</span>
            <span className="text-right font-black text-slate-950">{paymentMethodLabel}</span>
          </div>
          {status ? (
            <>
              <div className="flex min-h-12 items-center justify-between gap-4 border-t border-slate-100">
                <span className="font-semibold text-slate-500">Status</span>
                <span className={`rounded-lg px-2.5 py-1 text-xs font-black ${statusToneClass}`}>
                  {statusLabel}
                </span>
              </div>
              <div className="flex min-h-12 items-center justify-between gap-4 border-t border-slate-100">
                <span className="font-semibold text-slate-500">Amount</span>
                <span className="text-lg font-black text-slate-950">{formatIndianRupees(status.payment.amount)}</span>
              </div>
            </>
          ) : null}
        </div>

        {displayError ? (
          <p className="mx-6 mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {displayError}
          </p>
        ) : null}

        <div className="space-y-3 px-6 py-6">
          {status?.recovery.action === "RETRY" && !successful ? (
            <button
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-black px-5 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800 disabled:opacity-50"
              disabled={retrying}
              onClick={handleRetry}
              type="button"
            >
              {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw size={15} />}
              Retry payment
            </button>
          ) : null}
          {successful ? (
            <Link
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-black px-5 text-sm font-black text-white shadow-sm transition hover:bg-neutral-800"
              href="/account/orders"
            >
              <ShieldCheck size={15} />
              Track order
            </Link>
          ) : null}
          <Link
            className="inline-flex h-11 w-full items-center justify-center rounded-lg border border-slate-200 bg-white px-5 text-sm font-black text-slate-900 transition hover:border-slate-300 hover:bg-slate-50"
            href={waiting ? "/cart" : "/"}
          >
            {waiting ? "Back to cart" : "Continue shopping"}
          </Link>
        </div>
      </section>
    </main>
  );
}

function shortReference(value: string | null | undefined) {
  if (!value) return "Pending";
  return `#${value.replace(/-/g, "").slice(0, 8).toUpperCase()}`;
}

function checkoutVerifyPollDelay(attempt: number, backendPollAfterMs?: number | null) {
  const exponential = Math.min(
    VERIFY_POLL_CAP_MS,
    VERIFY_POLL_INITIAL_MS * Math.pow(VERIFY_POLL_MULTIPLIER, Math.max(0, attempt - 1))
  );
  const jitterRange = exponential * VERIFY_POLL_JITTER;
  const jittered = exponential - jitterRange + Math.random() * jitterRange * 2;
  return Math.round(Math.max(backendPollAfterMs ?? 0, jittered));
}

function markCheckoutPerformance(name: string) {
  if (typeof performance !== "undefined" && "mark" in performance) {
    performance.mark(name);
  }
}

function measureCheckoutPerformance(name: string, startMark: string, endMark: string) {
  if (typeof performance !== "undefined" && "measure" in performance) {
    try {
      performance.measure(name, startMark, endMark);
    } catch {
      // Missing marks should never break checkout status rendering.
    }
  }
}
