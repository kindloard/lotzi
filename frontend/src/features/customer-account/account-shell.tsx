"use client";

import { ArrowLeft, LogOut } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link, usePathname } from "@/i18n/navigation";
import { AccountQueryProvider } from "./account-query-provider";
import { CartProvider } from "@/lib/cart-context";
import {
  accountSectionFromPath,
  accountSections,
  getAccountSection,
  type AccountSectionId
} from "./config/account-sections";
import { AccountIdentityProvider, useAccountIdentity } from "./providers/account-identity-provider";
import { AccountShellSkeleton, Avatar, SectionError } from "./components/account-ui";
import { initialsFor } from "./lib/account-utils";

export function AccountShell({ children }: { children: ReactNode }) {
  return (
    <AccountQueryProvider>
      <AccountIdentityProvider>
        <CartProvider>
          <AccountShellFrame>{children}</AccountShellFrame>
        </CartProvider>
      </AccountIdentityProvider>
    </AccountQueryProvider>
  );
}

function AccountShellFrame({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const activeSection = accountSectionFromPath(pathname);
  const identity = useAccountIdentity();
  const initials = initialsFor(identity.account.fullName, identity.account.email);

  if (identity.isBootstrapping || identity.status === "idle") {
    return <AccountShellSkeleton />;
  }

  if (identity.status === "error") {
    return (
      <main className="min-h-screen bg-zinc-50 px-4 py-6 text-zinc-950 sm:px-6 lg:px-8">
        <div className="mx-auto flex min-h-[70vh] max-w-3xl items-center justify-center">
          <SectionError
            title="Account could not load"
            body={identity.errorMessage ?? "Your account details could not be reached. Retry in a moment."}
            onRetry={identity.refetchIdentity}
          />
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-zinc-50/50 text-zinc-950 pb-10 lg:bg-white" id="main-content">
      <MobileAccountHeader activeSection={activeSection} />

      <div className="mx-auto flex w-full max-w-[1100px] flex-col gap-8 px-4 py-6 md:px-8 lg:flex-row lg:gap-12 lg:py-12">
        {/* Desktop Sidebar */}
        <div className="hidden lg:block lg:w-[260px] lg:shrink-0">
          <DesktopAccountSidebar
            activeSection={activeSection}
            avatarUrl={identity.account.avatarUrl}
            email={identity.account.email ?? "Account"}
            initials={initials}
            isLoggingOut={identity.isLoggingOut}
            name={identity.account.fullName ?? "Namastore user"}
            onLogout={identity.logout}
          />
        </div>

        {/* Main Content Area */}
        <section className="min-w-0 flex-1">
          <div className="hidden lg:block">
            <DesktopAccountHeader
              activeSection={activeSection}
              name={identity.account.fullName ?? "Namastore user"}
            />
          </div>
          <div key={pathname}>
            <div className="animate-in fade-in duration-500">
              {children}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function DesktopAccountSidebar({
  activeSection,
  avatarUrl,
  email,
  initials,
  isLoggingOut,
  name,
  onLogout
}: {
  activeSection: AccountSectionId | null;
  avatarUrl: string | null;
  email: string;
  initials: string;
  isLoggingOut: boolean;
  name: string;
  onLogout: () => void;
}) {
  return (
    <aside className="sticky top-12 flex flex-col gap-8">
      {/* Back to Store */}
      <div className="-mt-2 mb-2">
        <Link 
          href="/" 
          className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-500 hover:text-zinc-900 transition-colors"
        >
          <ArrowLeft size={16} strokeWidth={2.5} />
          Back to store
        </Link>
      </div>

      {/* Identity block */}
      <div className="flex items-center gap-3">
        <Avatar avatarUrl={avatarUrl} initials={initials} size="md" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-zinc-950">{name}</p>
          <p className="truncate text-xs font-medium text-zinc-500">{email}</p>
        </div>
      </div>

      {/* Navigation */}
      <nav aria-label="Account sections" className="flex flex-col gap-1">
        {accountSections.map((item) => (
          <SidebarNavLink
            active={activeSection === item.id}
            href={item.href}
            icon={item.icon}
            key={item.id}
            label={item.label}
          />
        ))}
      </nav>

      {/* Logout */}
      <div className="pt-2">
        <button
          className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-rose-600 transition hover:bg-rose-50 active:bg-rose-100 disabled:pointer-events-none disabled:opacity-60"
          disabled={isLoggingOut}
          onClick={onLogout}
          type="button"
        >
          <LogOut size={18} strokeWidth={2} />
          {isLoggingOut ? "Signing out..." : "Sign out"}
        </button>
      </div>
    </aside>
  );
}

function DesktopAccountHeader({
  activeSection,
  name
}: {
  activeSection: AccountSectionId | null;
  name: string;
}) {
  const activeMeta = getAccountSection(activeSection);
  const firstName = name.split(" ")[0] || "User";

  return (
    <header className="mb-8">
      <h1 className="text-3xl font-bold tracking-tight text-zinc-950">
        {activeMeta?.label ?? `Welcome, ${firstName}`}
      </h1>
      <p className="mt-2 text-base text-zinc-500">
        {activeMeta?.description ?? "Manage your account settings, orders, and preferences."}
      </p>
    </header>
  );
}

function MobileAccountHeader({ activeSection }: { activeSection: AccountSectionId | null }) {
  const activeMeta = getAccountSection(activeSection);
  const title = activeMeta?.label ?? "Account Center";
  const backHref = activeSection ? "/account" : "/";
  const backLabel = activeSection ? "Back to account" : "Back to store";

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/95 shadow-sm backdrop-blur lg:hidden">
      <div className="flex h-14 items-center gap-3 px-4">
        <Link
          aria-label={backLabel}
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-zinc-700 transition hover:bg-zinc-200 active:scale-95"
          href={backHref}
        >
          <ArrowLeft size={18} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold tracking-tight text-zinc-950">{title}</h1>
        </div>
      </div>
    </header>
  );
}

function SidebarNavLink({
  active,
  href,
  icon: Icon,
  label
}: {
  active: boolean;
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link
      aria-current={active ? "page" : undefined}
      className={`group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition ${
        active 
          ? "bg-zinc-100/80 text-zinc-950 font-semibold" 
          : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 active:bg-zinc-100"
      }`}
      href={href}
      prefetch
    >
      <Icon 
        className={`shrink-0 transition-colors ${active ? "text-zinc-950" : "text-zinc-400 group-hover:text-zinc-600"}`} 
        size={18} 
        strokeWidth={active ? 2.5 : 2}
      />
      <span className="truncate">{label}</span>
    </Link>
  );
}
