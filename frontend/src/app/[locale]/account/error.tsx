"use client";

import { RefreshCcw } from "lucide-react";

export default function AccountError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="rounded-lg border border-rose-200 bg-rose-50 p-5 shadow-sm">
      <h1 className="text-base font-semibold text-rose-950">Account page could not load</h1>
      <p className="mt-2 text-sm leading-6 text-rose-700">
        Retrying keeps your session and reloads only this account route.
      </p>
      <button
        className="mt-4 inline-flex h-10 items-center gap-2 rounded-lg bg-rose-700 px-4 text-sm font-semibold text-white transition hover:bg-rose-800"
        onClick={reset}
        type="button"
      >
        <RefreshCcw size={15} />
        Retry
      </button>
    </section>
  );
}
