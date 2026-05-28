"use client";

export default function ProductPageError({
  error,
  reset
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 text-center">
      <div className="max-w-md">
        <p className="text-sm font-black uppercase tracking-wide text-slate-400">Product could not load</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">Try again in a moment</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          {error.message || "The product page request failed."}
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-black px-5 text-sm font-black text-white"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
