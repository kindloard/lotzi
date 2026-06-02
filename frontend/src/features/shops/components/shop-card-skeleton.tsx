export function ShopCardSkeleton() {
  return (
    <div className="flex min-h-[360px] animate-pulse flex-col overflow-hidden rounded-[20px] border border-slate-200 bg-white shadow-sm">
      <div className="relative w-full rounded-t-[20px] bg-slate-200 aspect-[21/9] sm:aspect-[2.5/1]" />
      <div className="flex flex-1 flex-col justify-between gap-3 p-4 pt-0">
        <div className="flex items-start gap-3">
          <div className="z-10 -mt-6 rounded-full bg-white p-1">
            <div className="size-14 rounded-full bg-slate-200" />
          </div>
          <div className="min-w-0 flex-1 pt-2">
            <div className="h-5 w-2/3 rounded bg-slate-200" />
          </div>
        </div>
        <div className="space-y-2 mt-2">
          <div className="h-4 w-full rounded bg-slate-200" />
          <div className="h-4 w-4/5 rounded bg-slate-200" />
        </div>
        <div className="mt-2 h-11 w-full rounded-xl bg-slate-200" />
      </div>
    </div>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex min-h-[265px] animate-pulse flex-col rounded-3xl border border-slate-200/80 bg-white p-4 shadow-sm">
      <div className="h-36 w-full rounded-2xl bg-slate-200" />
      <div className="flex flex-1 flex-col justify-between space-y-3 pt-3">
        <div className="space-y-2">
          <div className="h-3 w-1/4 rounded bg-slate-200" />
          <div className="h-4 w-3/4 rounded bg-slate-200" />
        </div>
        <div className="flex items-center justify-between border-t border-slate-100 pt-3">
          <div className="h-5 w-20 rounded bg-slate-200" />
          <div className="size-8 rounded-lg bg-slate-200" />
        </div>
      </div>
    </div>
  );
}
