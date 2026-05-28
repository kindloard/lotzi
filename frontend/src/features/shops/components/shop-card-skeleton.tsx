export function ShopCardSkeleton() {
  return (
    <div className="flex min-h-[380px] animate-pulse flex-col overflow-hidden rounded-3xl border border-slate-200/80 bg-white shadow-sm">
      <div className="h-36 w-full bg-slate-200" />
      <div className="flex flex-1 flex-col justify-between space-y-4 p-5">
        <div className="flex items-center gap-3">
          <div className="size-12 rounded-xl bg-slate-200" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-2/3 rounded bg-slate-200" />
            <div className="h-3 w-1/3 rounded bg-slate-200" />
          </div>
        </div>
        <div className="flex gap-2">
          <div className="h-5 w-16 rounded-md bg-slate-200" />
          <div className="h-5 w-20 rounded-md bg-slate-200" />
          <div className="h-5 w-14 rounded-md bg-slate-200" />
        </div>
        <div className="h-16 rounded-2xl bg-slate-100" />
        <div className="flex items-center justify-between">
          <div className="h-4 w-28 rounded bg-slate-200" />
          <div className="h-9 w-24 rounded-xl bg-slate-200" />
        </div>
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
