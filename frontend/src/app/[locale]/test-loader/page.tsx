import { LoaderEngine } from "@/components/loader-engine";

export default function TestLoaderPage() {
  return (
    <div className="flex min-h-[100dvh] w-full flex-col p-10 bg-white gap-8">
      <h1 className="text-2xl font-black text-slate-900">Loader Showcase</h1>
      
      <div className="grid md:grid-cols-2 gap-8">
        <div className="border border-slate-200 bg-slate-50 rounded-2xl p-6 shadow-sm overflow-hidden relative">
          <h2 className="text-sm font-bold text-slate-500 mb-4 uppercase tracking-wider">In-Box Loader (Account Pages)</h2>
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm relative">
            <LoaderEngine fullScreen={false} />
          </div>
        </div>

        <div className="border border-slate-200 bg-slate-50 rounded-2xl p-6 shadow-sm overflow-hidden relative flex flex-col items-center justify-center min-h-[400px]">
          <h2 className="text-sm font-bold text-slate-500 absolute top-6 left-6 uppercase tracking-wider">Full Screen Overlay</h2>
          <p className="text-slate-500 text-sm max-w-sm text-center">To see the full-screen overlay, go to any page and hard-refresh on a slow connection, or use Chrome DevTools network throttling.</p>
        </div>
      </div>
    </div>
  );
}
