"use client";

import { useEffect } from "react";
import { ChevronRight, LogOut } from "lucide-react";
import { Link, useRouter } from "@/i18n/navigation";
import { Avatar } from "../components/account-ui";
import { accountSections } from "../config/account-sections";
import { useAccountIdentity } from "../providers/account-identity-provider";
import { initialsFor } from "../lib/account-utils";

export function AccountHomeScreen() {
  const identity = useAccountIdentity();
  const initials = initialsFor(identity.account.fullName, identity.account.email);
  const { logout, isLoggingOut } = identity;
  const router = useRouter();

  useEffect(() => {
    // If the user is on desktop (>= 1024px), they shouldn't see this menu because 
    // they already have the sidebar. We redirect them directly to the Profile section.
    const handleResize = () => {
      if (window.innerWidth >= 1024) {
        router.replace("/account/profile");
      }
    };
    
    // Check immediately on mount
    handleResize();
    
    // Check on resize (in case they maximize a small window)
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, [router]);

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 lg:hidden">
      {/* Mobile only: User Profile Block */}
      <div className="flex items-center gap-4 rounded-2xl bg-white p-4 shadow-[0_2px_8px_rgba(0,0,0,0.04)] ring-1 ring-zinc-200/50 sm:p-6">
        <Avatar avatarUrl={identity.account.avatarUrl} initials={initials} size="lg" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-bold tracking-tight text-zinc-950">
            {identity.account.fullName ?? "Lotzi user"}
          </h2>
          <p className="truncate text-[13px] font-medium text-zinc-500">{identity.account.email}</p>
        </div>
      </div>

      {/* Sections List - Column wise list for Mobile */}
      <div className="overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-zinc-200">
        <ul className="divide-y divide-zinc-100">
          {accountSections.map((item) => (
            <li key={item.id}>
              <Link
                href={item.href}
                className="group flex items-center gap-4 p-4 transition hover:bg-zinc-50 active:bg-zinc-100 sm:p-5"
                prefetch
              >
                <div className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700 transition group-hover:bg-zinc-950 group-hover:text-white">
                  <item.icon size={20} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-base font-semibold text-zinc-950">{item.label}</p>
                  <p className="mt-0.5 truncate text-sm text-zinc-500">{item.description}</p>
                </div>
                <ChevronRight className="shrink-0 text-zinc-300 transition group-hover:translate-x-0.5 group-hover:text-zinc-950" size={20} />
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* Mobile only: Logout button */}
      <div>
        <button
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-white p-4 text-sm font-semibold text-rose-600 shadow-sm ring-1 ring-zinc-200 transition hover:bg-rose-50 active:bg-rose-100 disabled:opacity-60"
          onClick={logout}
          disabled={isLoggingOut}
          type="button"
        >
          <LogOut size={18} />
          {isLoggingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </div>
  );
}
