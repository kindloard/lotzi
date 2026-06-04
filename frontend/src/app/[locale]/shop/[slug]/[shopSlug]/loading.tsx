export default function ShopPageLoading() {
  return (
    <main className="min-h-screen bg-slate-50 text-slate-950" id="main-content">
      {/* Mobile Sticky Header Skeleton */}
      <div className="sticky top-[52px] z-40 md:hidden bg-white border-b border-slate-200 shadow-sm p-4">
        <div className="flex items-center gap-3">
          <div className="size-12 shrink-0 rounded-xl bg-slate-100 animate-pulse" />
          <div className="flex-1 space-y-2">
            <div className="h-5 w-32 rounded bg-slate-100 animate-pulse" />
            <div className="h-3 w-48 rounded bg-slate-100 animate-pulse" />
          </div>
        </div>
      </div>

      {/* Desktop Header Skeleton */}
      <section className="bg-slate-50 border-b border-slate-200 hidden md:block">
        <div className="mx-auto max-w-6xl px-4 py-4 sm:py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1 space-y-3">
              <div className="h-9 w-64 rounded-lg bg-slate-200/60 animate-pulse" />
              <div className="h-4 w-96 rounded bg-slate-200/60 animate-pulse" />
            </div>
          </div>
        </div>
      </section>

      {/* Catalog Skeleton */}
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="h-12 rounded-lg bg-slate-200/60 animate-pulse" />
        <div className="mt-6 grid grid-cols-2 gap-3 md:hidden">
          {Array.from({ length: 2 }).map((_, index) => (
            <div key={index} className="h-72 rounded-lg bg-slate-200/60 animate-pulse" />
          ))}
        </div>
        <div className="mt-6 hidden gap-3 md:grid md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <div key={index} className="h-72 rounded-lg bg-slate-200/60 animate-pulse" />
          ))}
        </div>
      </div>
    </main>
  );
}
