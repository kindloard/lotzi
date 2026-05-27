export default function AuthLoading() {
  return (
    <main
      className="auth-system-sans flex min-h-[100dvh] items-stretch justify-center bg-white sm:items-center sm:px-4 sm:py-8"
      id="main-content"
    >
      <section className="flex min-h-[100dvh] w-full max-w-[390px] flex-col px-7 py-8 sm:min-h-[680px]">
        <div className="h-11 w-11 rounded-[14px] bg-slate-100" />
        <div className="flex flex-1 flex-col justify-center">
          <div className="mx-auto h-6 w-44 rounded-full bg-slate-100" />
          <div className="mx-auto mt-3 h-4 w-56 rounded-full bg-slate-100" />
          <div className="mt-8 space-y-3.5">
            <div className="h-11 rounded-[14px] bg-slate-100" />
            <div className="h-11 rounded-[14px] bg-slate-100" />
            <div className="h-12 rounded-full bg-slate-950/90" />
          </div>
        </div>
      </section>
    </main>
  );
}
