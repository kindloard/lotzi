export default function ProductPageLoading() {
  return (
    <main className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <div className="h-4 w-56 rounded bg-slate-200" />
        <div className="mt-4 grid gap-6 md:grid-cols-[1.05fr_0.95fr]">
          <div className="aspect-square rounded-xl bg-slate-200" />
          <div className="space-y-3">
            <div className="h-8 w-3/4 rounded bg-slate-200" />
            <div className="h-5 w-1/3 rounded bg-slate-200" />
            <div className="h-28 rounded-xl bg-slate-200" />
            <div className="h-20 rounded-xl bg-slate-200" />
          </div>
        </div>
      </div>
    </main>
  );
}
