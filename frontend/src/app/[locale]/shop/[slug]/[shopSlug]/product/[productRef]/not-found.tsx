import { Link } from "@/i18n/navigation";

export default function ProductNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-4 text-center">
      <div className="max-w-md">
        <p className="text-sm font-black uppercase tracking-wide text-slate-400">Product unavailable</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-950">This product is not available</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          The product may be out of stock, unpublished, or removed.
        </p>
        <Link
          href="/"
          className="mt-6 inline-flex h-11 items-center justify-center rounded-lg bg-black px-5 text-sm font-black text-white"
        >
          Browse shops
        </Link>
      </div>
    </main>
  );
}
