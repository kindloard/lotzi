"use client";

import { useEffect, useRef, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import { CheckCircle2, Loader2, RefreshCw, ShieldCheck, XCircle } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { getPaymentStatus, retryPayment, verifyPayment, type PaymentStatusResponse } from "@/features/checkout/checkout-api";
import { loadCashfree } from "@/features/checkout/cashfree-sdk";
import { useCart } from "@/lib/cart-context";
import { formatIndianRupees } from "@/lib/currency";

const TERMINAL_PAYMENT_STATUSES = new Set(["PAID", "FAILED", "EXPIRED", "REFUNDED"]);

function isTerminalPaymentStatus(status: string | undefined) {
  return status !== undefined && TERMINAL_PAYMENT_STATUSES.has(status);
}

export default function CheckoutStatusPage() {
  const params = useSearchParams();
  const router = useRouter();
  const { clearCart } = useCart();
  const paymentId = params.get("paymentId");
  const orderId = params.get("orderId");
  const [status, setStatus] = useState<PaymentStatusResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const terminalRef = useRef(false);
  terminalRef.current = isTerminalPaymentStatus(status?.payment.status);

  useEffect(() => {
    if (!paymentId) {
      setError("Payment reference is missing.");
      return;
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const poll = async () => {
      try {
        const verified = await verifyPayment(paymentId).catch(() => null);
        const next = verified ?? (await getPaymentStatus(paymentId));
        if (disposed) return;
        setStatus(next);
        setError(null);
        if (next.payment.status === "PAID") {
          clearCart();
          return;
        }
        if (isTerminalPaymentStatus(next.payment.status)) {
          return;
        }
        const pollAfter = next.recovery.pollAfterMs;
        if (pollAfter && !terminalRef.current) {
          timer = setTimeout(poll, pollAfter);
        }
      } catch (pollError) {
        if (disposed) return;
        setError(pollError instanceof Error ? pollError.message : "Unable to check payment status.");
        if (!terminalRef.current) {
          timer = setTimeout(poll, 5_000);
        }
      }
    };

    void poll();
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
    };
  }, [clearCart, paymentId]);

  const handleRetry = async () => {
    if (!paymentId) return;
    setRetrying(true);
    setError(null);
    try {
      const session = await retryPayment(paymentId, crypto.randomUUID());
      if (session.paymentSessionId) {
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

  const paid = status?.payment.status === "PAID";
  const failed = status?.payment.status === "FAILED" || status?.payment.status === "EXPIRED";
  const waiting = !paid && !failed;

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-8 font-sans sm:px-6 lg:px-8">
      <section className="mx-auto w-full max-w-xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${
            paid ? "bg-emerald-50 text-emerald-600" : failed ? "bg-rose-50 text-rose-600" : "bg-slate-100 text-slate-700"
          }`}>
            {paid ? <CheckCircle2 size={26} /> : failed ? <XCircle size={26} /> : <Loader2 className="animate-spin" size={24} />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-black uppercase tracking-wider text-slate-400">Secure payment</p>
            <h1 className="mt-1 text-xl font-black text-slate-950">
              {paid ? "Payment confirmed" : failed ? "Payment needs attention" : "Checking payment status"}
            </h1>
            <p className="mt-2 text-sm font-semibold leading-6 text-slate-500">
              {paid
                ? "Your order is confirmed and inventory is locked for fulfillment."
                : failed
                  ? "The payment did not complete. You can retry while the checkout is still active."
                  : "We are verifying Cashfree and server records before confirming your order."}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-3 rounded-xl border border-slate-100 bg-slate-50 p-4 text-sm">
          <div className="flex justify-between gap-4">
            <span className="font-semibold text-slate-500">Order</span>
            <span className="truncate font-black text-slate-900">{orderId ?? status?.payment.orderId ?? "Pending"}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="font-semibold text-slate-500">Payment</span>
            <span className="truncate font-black text-slate-900">{paymentId ?? "Pending"}</span>
          </div>
          {status ? (
            <>
              <div className="flex justify-between gap-4">
                <span className="font-semibold text-slate-500">Status</span>
                <span className="font-black text-slate-900">{status.payment.status}</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="font-semibold text-slate-500">Amount</span>
                <span className="font-black text-slate-900">{formatIndianRupees(status.payment.amount)}</span>
              </div>
            </>
          ) : null}
        </div>

        {error ? (
          <p className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          {status?.recovery.action === "RETRY" ? (
            <button
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-black px-5 text-xs font-black text-white disabled:opacity-50"
              disabled={retrying}
              onClick={handleRetry}
              type="button"
            >
              {retrying ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw size={15} />}
              Retry payment
            </button>
          ) : null}
          {paid ? (
            <Link
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-black px-5 text-xs font-black text-white"
              href="/account/orders"
            >
              <ShieldCheck size={15} />
              Track order
            </Link>
          ) : null}
          <Link
            className="inline-flex h-11 flex-1 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-xs font-black text-slate-900"
            href={waiting ? "/cart" : "/"}
          >
            {waiting ? "Back to cart" : "Continue shopping"}
          </Link>
        </div>
      </section>
    </main>
  );
}
