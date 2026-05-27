import { AlertTriangle } from "lucide-react";
import { Link } from "@/i18n/navigation";

export default function AccountNotFound() {
  return (
    <section className="rounded-lg border border-zinc-200 bg-white p-6 text-center shadow-sm">
      <AlertTriangle className="mx-auto text-zinc-400" size={32} />
      <h1 className="mt-4 text-lg font-semibold text-zinc-950">Account page not found</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">
        That account section is not available. Return to the account hub to choose an available page.
      </p>
      <Link
        className="mt-5 inline-flex min-h-10 items-center justify-center rounded-lg bg-zinc-950 px-4 text-sm font-semibold text-white"
        href="/account"
      >
        Back to account
      </Link>
    </section>
  );
}
