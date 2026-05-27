export function DashboardSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
        {[0, 1, 2, 3, 4, 5].map((item) => (
          <div className="h-40 animate-pulse rounded-2xl border border-zinc-200 bg-white" key={item} />
        ))}
      </div>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_380px]">
        <div className="h-96 animate-pulse rounded-2xl border border-zinc-200 bg-white" />
        <div className="h-96 animate-pulse rounded-2xl border border-zinc-200 bg-white" />
      </div>
    </div>
  );
}

