export default function ShopPageLoading() {
  return (
    <main className="min-h-screen bg-white">
      <div className="h-56 w-full bg-slate-100" />
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="flex gap-4">
          <div className="-mt-12 size-24 rounded-lg bg-white shadow-md" />
          <div className="flex-1 space-y-3">
            <div className="h-9 max-w-sm rounded bg-slate-100" />
            <div className="h-4 max-w-2xl rounded bg-slate-100" />
            <div className="h-4 max-w-xl rounded bg-slate-100" />
          </div>
        </div>
        <div className="mt-8 h-12 rounded-lg bg-slate-100" />
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {Array.from({ length: 10 }).map((_, index) => (
            <div key={index} className="h-72 rounded-lg bg-slate-100" />
          ))}
        </div>
      </div>
    </main>
  );
}
