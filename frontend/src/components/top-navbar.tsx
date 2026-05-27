"use client";

import {
  Search,
  ShoppingBag,
  ShoppingCart,
  X,
  ChevronDown,
  Menu,
  Compass,
  Clock,
  Sparkles,
  Trash2,
  Plus,
  Minus,
  Settings,
  History,
  Store,
  LogOut,
  User as UserIcon,
  HelpCircle,
  ArrowLeft,
  Send,
  ChevronUp
} from "lucide-react";
import type { ReactNode } from "react";
import { useState, useEffect, useRef } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Link, usePathname, useRouter } from "@/i18n/navigation";
import { LanguageSwitcher } from "@/components/i18n/language-switcher";
import { useCart } from "@/lib/cart-context";
import { logout } from "@/lib/auth-api";
import { useAuthSession } from "@/components/session-refresh-provider";
import { useLocationTicker } from "@/lib/use-location-ticker";
import { fetchCustomerAddresses } from "@/features/customer-account/customer-account-api";

const mockRecentSearches = [
  "Whole wheat bread",
  "Organic avocados",
  "Raja Grocery specials",
  "Artisan bakery products"
];

const mockCategories = [
  { name: "Grocery", count: "12 shops", icon: ShoppingBag, color: "bg-slate-50/50 text-slate-700 border-slate-100" },
  { name: "Vegetables", count: "8 shops", icon: Compass, color: "bg-slate-50/50 text-slate-700 border-slate-100" },
  { name: "Bakery", count: "5 shops", icon: Sparkles, color: "bg-slate-50/50 text-slate-700 border-slate-100" }
];

const mockStoreSuggestions = [
  { name: "Raja Grocery", distance: "1.2 km away", rating: "4.8", image: "RG" },
  { name: "Daily Bakery", distance: "2.5 km away", rating: "4.9", image: "DB" },
  { name: "Fresh Veg Shop", distance: "2.0 km away", rating: "4.6", image: "FV" }
];

const searchPlaceholderTerms = [
  "products",
  "shops",
  "groceries",
  "bakeries",
  "daily essentials"
];

const authRoutesToPrefetch = ["/auth/login", "/auth/signup", "/auth/merchant/signup", "/auth/otp"];

function userInitials(name: string | null | undefined, email: string | undefined) {
  const source = name?.trim() || email || "User";
  return source
    .split(/\s+|@/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("") || "U";
}

function isAuthPath(pathname: string) {
  return (
    pathname.startsWith("/auth") ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/otp"
  );
}

function AuthNavigationLink({
  children,
  className,
  href,
  onNavigateStart
}: {
  children: ReactNode;
  className: string;
  href: string;
  onNavigateStart?: () => void;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  const warmRoute = () => {
    router.prefetch(href);
  };

  return (
    <Link
      aria-busy={pending}
      className={`${className} ${pending ? "pointer-events-none opacity-75" : ""}`}
      href={href}
      onClick={(event) => {
        if (pending) {
          event.preventDefault();
          return;
        }
        setPending(true);
        warmRoute();
        onNavigateStart?.();
      }}
      onFocus={warmRoute}
      onPointerEnter={warmRoute}
      prefetch
    >
      {pending ? (
        <span className="inline-flex items-center gap-2">
          <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
          Opening
        </span>
      ) : (
        children
      )}
    </Link>
  );
}

function AnimatedSearchPlaceholder({
  activeIndex,
  compact = false,
  disableTransition = false,
  visible
}: {
  activeIndex: number;
  compact?: boolean;
  disableTransition?: boolean;
  visible: boolean;
}) {
  const lineHeight = 18;
  const textClassName = compact ? "text-[14px] leading-[18px]" : "text-sm leading-[18px]";
  const railTerms = [...searchPlaceholderTerms, searchPlaceholderTerms[0]];

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-y-0 left-0 flex min-w-0 items-center overflow-hidden transition-opacity duration-150 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <span className={`flex min-w-0 items-center font-black text-slate-950 ${textClassName}`}>
        <span className="shrink-0 whitespace-nowrap">Search for&nbsp;</span>
        <span className="relative inline-block h-[18px] min-w-[128px] overflow-hidden align-bottom">
          <span
            className={`absolute left-0 top-0 flex flex-col will-change-transform motion-reduce:transition-none ${
              disableTransition
                ? "transition-none"
                : "transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
            }`}
            style={{ transform: `translate3d(0, -${activeIndex * lineHeight}px, 0)` }}
          >
            {railTerms.map((placeholderTerm, index) => (
              <span
                className={`block h-[18px] whitespace-nowrap text-slate-950 ${textClassName}`}
                key={`${placeholderTerm}-${index}`}
              >
                {placeholderTerm}
              </span>
            ))}
          </span>
        </span>
      </span>
    </div>
  );
}

// ─── Animated Location Ticker ────────────────────────────────────────────────
function AnimatedLocationTicker({
  ticks,
  activeIndex,
  isResetting,
  gpsStatus,
  compact = false,
  brandName,
}: {
  ticks: { label: string; sublabel?: string; isGps?: boolean }[];
  activeIndex: number;
  isResetting: boolean;
  gpsStatus: "idle" | "loading" | "resolved" | "denied" | "error";
  compact?: boolean;
  brandName?: string;
}) {
  const lineHeight = compact ? 16 : 28;
  const currentLabel = ticks.length > 0 ? ticks[activeIndex % ticks.length]?.label : "";

  if (ticks.length === 0 || gpsStatus === "idle") {
    return null;
  }

  return (
    <div
      className={`group flex min-w-0 items-center gap-1.5 ${
        compact ? "" : ""
      }`}
      title={ticks[activeIndex]?.label}
    >
      {/* Scrolling label rail */}
      <div
        className={`relative overflow-hidden ${
          compact ? "h-[16px]" : "h-[28px]"
        } min-w-0`}
      >
        <div
          className={`flex flex-col will-change-transform ${
            isResetting
              ? "transition-none"
              : "transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
          }`}
          style={{ transform: `translate3d(0, -${activeIndex * lineHeight}px, 0)` }}
        >
          {ticks.map((tick, i) => (
            <span
              key={`${tick.label}-${i}`}
              className={`block whitespace-nowrap tracking-tight ${
                compact
                  ? "h-[16px] text-[12px] font-bold leading-[16px] text-slate-700"
                  : "h-[28px] text-lg font-black leading-[28px] text-slate-950 [font-weight:950]"
              }`}
            >
              {tick.label}
            </span>
          ))}
          {/* Duplicate first tick for seamless loop */}
          {ticks[0] && (
            <span
              className={`block whitespace-nowrap tracking-tight ${
                compact
                  ? "h-[16px] text-[12px] font-bold leading-[16px] text-slate-700"
                  : "h-[28px] text-lg font-black leading-[28px] text-slate-950 [font-weight:950]"
              }`}
            >
              {ticks[0].label}
            </span>
          )}
        </div>
      </div>

      {/* Paper plane icon at the end */}
      <Send
        size={compact ? 11 : 15}
        strokeWidth={2.4}
        className={`shrink-0 text-slate-950 transition-all duration-500 ease-in-out ${
          currentLabel === brandName ? "w-0 opacity-0 scale-50" : "w-[15px] opacity-100 scale-100"
        }`}
      />
    </div>
  );
}

export function TopNavbar() {
  const pathname = usePathname();

  if (isAuthPath(pathname)) {
    return null;
  }

  return <TopNavbarInner pathname={pathname} />;
}

function TopNavbarInner({ pathname }: { pathname: string }) {
  const router = useRouter();
  const format = useFormatter();
  const tActions = useTranslations("common.actions");
  const tAria = useTranslations("common.aria");
  const tBrand = useTranslations("common.brand");
  const tCart = useTranslations("cart");
  const tMarketplace = useTranslations("marketplace.home");
  const tNav = useTranslations("common.navigation");
  const isCartPage = pathname === "/cart";
  const { session, clearSession } = useAuthSession();
  const profileUser = session?.user;
  const isLoggedIn = Boolean(profileUser);
  const initials = userInitials(profileUser?.fullName, profileUser?.email);

  // Navigation states
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPlaceholderIndex, setSearchPlaceholderIndex] = useState(0);
  const [isSearchRailResetting, setIsSearchRailResetting] = useState(false);
  
  // Dropdown states
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // App interactions simulated states
  const [isCartBouncing, setIsCartBouncing] = useState(false);

  // Global cart context state
  const { cartItems, cartSubtotal, cartItemCount, updateQty, removeFromCart } = useCart();

  // References for handling clicks outside dropdowns
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const cartRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  // ── Location Ticker ──────────────────────────────────────────────────────────
  const [savedAddressLabels, setSavedAddressLabels] = useState<string[]>([]);

  useEffect(() => {
    if (!isLoggedIn) return;
    let cancelled = false;
    fetchCustomerAddresses()
      .then(({ addresses }) => {
        if (cancelled) return;
        const labels = addresses
          .map((a) =>
            [a.label, a.line1, a.city].filter(Boolean).join(" · ")
          )
          .filter(Boolean)
          .slice(0, 3); // show at most 3 saved addresses
        setSavedAddressLabels(labels);
      })
      .catch(() => undefined); // non-critical — silently ignore
    return () => { cancelled = true; };
  }, [isLoggedIn]);

  const { ticks, activeIndex: locationIndex, isResetting: locationResetting, gpsStatus } =
    useLocationTicker({ brandName: tBrand("name"), savedAddresses: savedAddressLabels });

  useEffect(() => {
    const warmRoutes = () => authRoutesToPrefetch.forEach((route) => router.prefetch(route));
    const timer = window.setTimeout(warmRoutes, 250);
    return () => window.clearTimeout(timer);
  }, [router]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSearchPlaceholderIndex((currentIndex) => currentIndex + 1);
    }, 2600);

    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (searchPlaceholderIndex < searchPlaceholderTerms.length) {
      return;
    }

    let resumeTimer: number | undefined;

    const resetTimer = window.setTimeout(() => {
      setIsSearchRailResetting(true);
      setSearchPlaceholderIndex(0);

      resumeTimer = window.setTimeout(() => {
        setIsSearchRailResetting(false);
      }, 40);
    }, 720);

    return () => {
      window.clearTimeout(resetTimer);
      if (resumeTimer) {
        window.clearTimeout(resumeTimer);
      }
    };
  }, [searchPlaceholderIndex]);

  // Keyboard shortcut listener (Ctrl + K or Cmd + K)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
        setIsSearchFocused(true);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Lock body scroll when mobile menu is open
  useEffect(() => {
    if (isMobileMenuOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [isMobileMenuOpen]);

  // Handle outside clicks to close dropdowns
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;

      if (searchContainerRef.current && !searchContainerRef.current.contains(target)) {
        setIsSearchFocused(false);
      }
      if (cartRef.current && !cartRef.current.contains(target)) {
        setIsCartOpen(false);
      }
      if (profileRef.current && !profileRef.current.contains(target)) {
        setIsProfileOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  // Cart operations with animation triggers
  const handleUpdateQty = (id: string, delta: number) => {
    setIsCartBouncing(true);
    setTimeout(() => setIsCartBouncing(false), 300);
    updateQty(id, delta);
  };

  const handleRemoveItem = (id: string) => {
    setIsCartBouncing(true);
    setTimeout(() => setIsCartBouncing(false), 300);
    removeFromCart(id);
  };

  const handleLogout = () => {
    setIsProfileOpen(false);
    setIsMobileMenuOpen(false);
    clearSession();
    void logout()
      .catch(() => undefined)
      .finally(() => router.replace("/auth/login"));
  };

  const normalizedSearchPlaceholderIndex = searchPlaceholderIndex % searchPlaceholderTerms.length;
  const searchRailIndex = Math.min(searchPlaceholderIndex, searchPlaceholderTerms.length);
  const animatedSearchTerm = searchPlaceholderTerms[normalizedSearchPlaceholderIndex];
  const money = (amount: number) =>
    format.number(amount, {
      currency: "INR",
      maximumFractionDigits: 0,
      style: "currency"
    });

  if (isCartPage) {
    return (
      <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white transition-all duration-300 animate-fade-in">
        <a
          className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-slate-950 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
          href="#main-content"
        >
          {tActions("skipToContent")}
        </a>

        <nav
          aria-label={tAria("navigation")}
          className="mx-auto flex h-[64px] w-full max-w-[1600px] items-center px-3 sm:px-6 lg:px-8"
        >
          <Link
            href="/"
            className="group inline-flex items-center gap-2 rounded-xl py-2 px-3.5 text-sm font-black text-slate-700 hover:text-slate-955 hover:bg-slate-50 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-slate-950/5 cursor-pointer sm:text-[15px]"
          >
            <ArrowLeft className="size-4 transition-transform duration-250 group-hover:-translate-x-1" strokeWidth={2.4} />
            <span>{tCart("continueShopping")}</span>
          </Link>
        </nav>
      </header>
    );
  }

  return (
    <>
      <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white transition-all duration-300">
      <a
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-slate-950 focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-white"
        href="#main-content"
      >
        {tActions("skipToContent")}
      </a>

      <nav
        aria-label={tAria("navigation")}
        className="mx-auto grid h-[64px] w-full max-w-[1600px] grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 px-3 sm:gap-6 sm:px-6 lg:px-8"
      >
        {/* Left Side: Logo + Location Ticker */}
        <div className="flex items-center gap-2 sm:gap-4 lg:gap-6">
          <Link
            aria-label={tBrand("name")}
            className="group flex shrink-0 items-center gap-3 rounded-xl focus:outline-none"
            href="/"
          >
            <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-slate-900 text-white transition-all duration-200">
              <ShoppingBag aria-hidden="true" size={16} strokeWidth={2.4} />
            </span>
            {/* Location ticker OR fallback brand name */}
            <span className="flex flex-col justify-center min-w-0">
              {ticks.length > 0 && gpsStatus !== "idle" ? (
                <AnimatedLocationTicker
                  ticks={ticks}
                  activeIndex={locationIndex}
                  isResetting={locationResetting}
                  gpsStatus={gpsStatus}
                  brandName={tBrand("name")}
                />
              ) : (
                <span className="block text-lg font-black tracking-tight text-slate-950 [font-weight:950]">
                  {tBrand("name")}
                </span>
              )}
            </span>
          </Link>
        </div>

        {/* Middle Side: Premium Search with hotkeys & smart suggestion panel */}
        <div className="hidden md:flex justify-center w-full max-w-[460px] mx-auto relative" ref={searchContainerRef}>
          <div 
            onClick={() => searchInputRef.current?.focus()}
            className={`flex items-center gap-3 px-5 py-2.5 w-full rounded-full border border-black transition-all duration-200 bg-white cursor-text ${
              isSearchFocused ? "shadow-[0_4px_12px_rgba(0,0,0,0.05)]" : "hover:shadow-[0_2px_8px_rgba(0,0,0,0.02)]"
            }`}
          >
            <Search className={`shrink-0 transition-colors duration-200 ${isSearchFocused ? "text-slate-900" : "text-slate-400"}`} size={18} strokeWidth={2.2} />
            <div className="relative min-w-0 flex-1">
              <AnimatedSearchPlaceholder
                activeIndex={searchRailIndex}
                disableTransition={isSearchRailResetting}
                visible={!searchQuery}
              />
              <input
                aria-label={`${tActions("search")} ${animatedSearchTerm}`}
                ref={searchInputRef}
                type="text"
                placeholder=""
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onFocus={() => setIsSearchFocused(true)}
                className="relative z-10 w-full bg-transparent text-sm font-black text-slate-950 caret-slate-950 outline-none placeholder:text-slate-950"
              />
            </div>
            {searchQuery && (
              <button 
                onClick={() => setSearchQuery("")} 
                className="p-0.5 rounded-full hover:bg-slate-200/80 text-slate-450 hover:text-slate-600 transition-all cursor-pointer"
              >
                <X size={12} strokeWidth={2.2} />
              </button>
            )}
          </div>

          {/* Premium Search Overlay Dropdown */}
          {isSearchFocused && (
            <div className="absolute top-full mt-3 w-full left-0 bg-white border border-black rounded-[24px] shadow-[0_20px_50px_rgba(0,0,0,0.12)] animate-scale-up z-50 p-6">
              <div className="max-h-[460px] overflow-y-auto scrollbar-hide space-y-6">
                {/* Recent Searches */}
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase mb-3">
                    <Clock size={14} strokeWidth={2.5} className="text-slate-400" />
                    <span>Recent Searches</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {mockRecentSearches.map((term) => (
                      <button
                        key={term}
                        onClick={() => {
                          setSearchQuery(term);
                          setIsSearchFocused(false);
                        }}
                        className="px-4 py-2 text-xs font-semibold text-slate-700 bg-white hover:bg-slate-50 border border-slate-200 hover:border-slate-350 rounded-full transition-all duration-150 cursor-pointer"
                      >
                        {term}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Popular Categories */}
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase mb-3">
                    <Sparkles size={14} strokeWidth={2.5} className="text-slate-400" />
                    <span>Popular Categories</span>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    {mockCategories.map((cat) => {
                      const IconComp = cat.icon;
                      return (
                        <button
                          key={cat.name}
                          onClick={() => {
                            setSearchQuery(cat.name);
                            setIsSearchFocused(false);
                          }}
                          className="flex flex-col items-center justify-center p-4 bg-white border border-black rounded-2xl transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm cursor-pointer"
                        >
                          <IconComp size={20} strokeWidth={2} className="text-slate-800 mb-2" />
                          <span className="text-xs font-bold text-slate-900">{cat.name}</span>
                          <span className="text-[10px] text-slate-400 mt-1">{cat.count}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Nearby Stores suggestions */}
                <div>
                  <div className="flex items-center gap-2 text-[11px] font-bold tracking-wider text-slate-400 uppercase mb-3">
                    <Store size={14} strokeWidth={2.5} className="text-slate-400" />
                    <span>Recommended Local Shops</span>
                  </div>
                  <div className="space-y-2">
                    {mockStoreSuggestions.map((store) => (
                      <button
                        key={store.name}
                        onClick={() => {
                          setSearchQuery(store.name);
                          setIsSearchFocused(false);
                        }}
                        className="w-full flex items-center justify-between p-2.5 rounded-2xl hover:bg-slate-50 transition-all text-left cursor-pointer"
                      >
                        <div className="flex items-center gap-3.5">
                          <span className="flex size-11 items-center justify-center rounded-xl bg-[#0f172a] text-xs font-bold text-white tracking-wide">
                            {store.image}
                          </span>
                          <div>
                            <p className="text-sm font-bold text-slate-900">{store.name}</p>
                            <p className="text-xs text-slate-400 mt-0.5">{store.distance}</p>
                          </div>
                        </div>
                        <span className="flex items-center gap-1 text-[11px] font-bold text-slate-800 bg-white border border-slate-200 rounded-lg px-2.5 py-1">
                          ★ {store.rating}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right Side: Cart, User Profile & Mobile Toggle */}
        <div className="flex items-center justify-self-end gap-1.5 sm:gap-3 shrink-0">
          
          {/* Cart Icon Dropdown */}
          <div className="relative hidden md:block" ref={cartRef}>
            <button
              onClick={() => setIsCartOpen(!isCartOpen)}
              className={`relative flex size-9 items-center justify-center rounded-xl bg-slate-50/50 border border-slate-250/60 text-slate-700 transition-all duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-sm cursor-pointer focus:outline-none focus:ring-4 focus:ring-slate-950/5 ${
                isCartBouncing ? "animate-cart-bounce" : ""
              }`}
              aria-expanded={isCartOpen}
              aria-haspopup="true"
            >
              <ShoppingCart size={16} strokeWidth={2.2} />
              {cartItemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-slate-900 px-1 text-[9px] font-bold text-white shadow-md animate-scale-up">
                  {cartItemCount}
                </span>
              )}
            </button>

            {isCartOpen && (
              <div className="absolute right-0 mt-2.5 w-80 origin-top-right rounded-2xl border border-slate-100 bg-white p-4 shadow-[0_12px_40px_-4px_rgba(15,23,42,0.06),0_4px_20px_-2px_rgba(15,23,42,0.02)] animate-scale-up z-50">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <h3 className="text-xs font-bold text-slate-900">Your Basket</h3>
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[10.5px] font-semibold text-slate-550">
                    {cartItemCount} items
                  </span>
                </div>

                {cartItems.length > 0 ? (
                  <>
                    <div className="max-h-60 overflow-y-auto scrollbar-hide divide-y divide-slate-100 my-2">
                      {cartItems.map((item) => (
                        <div key={item.id} className="py-2.5 flex items-start justify-between gap-3 group">
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-slate-800 truncate">{item.name}</p>
                            <p className="text-[11px] text-slate-400 mt-0.5">from {item.shop}</p>
                            <p className="text-[11px] font-bold text-slate-900 mt-1">{money(item.price)}</p>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <div className="flex items-center border border-slate-200 rounded-lg overflow-hidden bg-slate-50">
                              <button
                                onClick={() => handleUpdateQty(item.id, -1)}
                                className="p-1 hover:bg-slate-200 text-slate-500 transition-all cursor-pointer"
                              >
                                <Minus size={10} strokeWidth={3} />
                              </button>
                              <span className="text-[11px] font-bold px-2 text-slate-700">{item.qty}</span>
                              <button
                                onClick={() => handleUpdateQty(item.id, 1)}
                                className="p-1 hover:bg-slate-200 text-slate-500 transition-all cursor-pointer"
                              >
                                <Plus size={10} strokeWidth={3} />
                              </button>
                            </div>
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              className="p-1 text-slate-400 hover:text-rose-650 transition-all cursor-pointer"
                              title="Delete item"
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>

                    <div className="border-t border-slate-100 pt-3 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-500 font-medium">{tCart("summary.subtotal")}</span>
                        <span className="text-slate-900 font-bold">{money(cartSubtotal)}</span>
                      </div>
                      <Link
                        href="/cart"
                        onClick={() => setIsCartOpen(false)}
                        className="flex h-9 w-full items-center justify-center rounded-xl bg-slate-900 text-xs font-bold text-white shadow-sm hover:bg-slate-800 transition-all duration-200 hover:-translate-y-0.5"
                      >
                        {tCart("summary.checkout")}
                      </Link>
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center">
                    <ShoppingCart className="mx-auto text-slate-300 mb-2.5" size={24} />
                    <p className="text-xs text-slate-400 font-medium">{tCart("emptyTitle")}</p>
                    <button
                      onClick={() => setIsCartOpen(false)}
                      className="mt-3 inline-flex px-3 py-1.5 rounded-lg border border-slate-250 hover:border-slate-300 text-[10px] font-bold text-slate-650 transition-all cursor-pointer"
                    >
                      {tMarketplace("nearYou")}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* User Profile / Login (Pill Login or Dropdown) */}
          <div className="relative hidden md:block" ref={profileRef}>
            {isLoggedIn ? (
              <button
                aria-label={profileUser?.fullName || profileUser?.email || "User menu"}
                onClick={() => setIsProfileOpen(!isProfileOpen)}
                className="flex items-center gap-1.5 rounded-full p-0.5 border border-slate-200 bg-slate-50 hover:bg-slate-100 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-slate-950/5 cursor-pointer"
                aria-expanded={isProfileOpen}
                aria-haspopup="true"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white shadow-inner">
                  {initials}
                </span>
                <ChevronDown className="text-slate-400 mr-1 hidden sm:block" size={12} strokeWidth={2.5} />
              </button>
            ) : (
              <div className="hidden sm:flex items-center gap-2.5">
                <LanguageSwitcher compact />
                <AuthNavigationLink
                  href="/auth/login"
                  className="inline-flex h-10 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-bold text-slate-800 shadow-sm hover:bg-slate-50 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-slate-900/5 cursor-pointer"
                >
                  {tNav("login")}
                </AuthNavigationLink>
                <AuthNavigationLink
                  href="/auth/signup"
                  className="inline-flex h-10 items-center justify-center rounded-xl bg-slate-950 px-5 text-sm font-bold text-white shadow-sm hover:bg-slate-850 hover:-translate-y-0.5 transition-all duration-200 focus:outline-none focus:ring-4 focus:ring-slate-900/10 cursor-pointer"
                >
                  {tNav("signup")}
                </AuthNavigationLink>
              </div>
            )}

            {isProfileOpen && isLoggedIn && (
              <div className="absolute right-0 mt-2.5 w-56 origin-top-right rounded-2xl border border-slate-100 bg-white p-2.5 shadow-[0_12px_40px_-4px_rgba(15,23,42,0.06),0_4px_20px_-2px_rgba(15,23,42,0.02)] animate-scale-up z-50">
                <div className="px-2.5 py-2 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-800">
                    {profileUser?.fullName || "Namastore user"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">{profileUser?.email}</p>
                </div>

                <div className="py-1">
                  <Link
                    href="/account/profile"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-600 hover:text-slate-900 transition-all font-medium"
                  >
                    <UserIcon size={13} className="text-slate-450" />
                    My Profile
                  </Link>
                  <Link
                    href="/account/orders"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-600 hover:text-slate-900 transition-all font-medium"
                  >
                    <History size={13} className="text-slate-450" />
                    Order History
                  </Link>
                  <Link
                    href={profileUser?.roleCodes.includes("MERCHANT_OWNER") ? "/merchant/dashboard" : "/auth/merchant/signup"}
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-600 hover:text-slate-900 transition-all font-medium"
                  >
                    <Store size={13} className="text-slate-450" />
                    Manage Store
                  </Link>
                  <Link
                    href="/account/settings"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg hover:bg-slate-50 text-xs text-slate-600 hover:text-slate-900 transition-all font-medium"
                  >
                    <Settings size={13} className="text-slate-450" />
                    Settings
                  </Link>
                </div>

                <div className="border-t border-slate-100 my-1" />

                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg hover:bg-rose-50 text-xs text-rose-650 transition-all font-bold text-left cursor-pointer"
                >
                  <LogOut size={13} />
                  Sign Out
                </button>
              </div>
            )}
          </div>            {/* Mobile hamburger menu drawer button */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="flex size-11 items-center justify-center rounded-2xl bg-transparent text-slate-950 transition-all duration-200 hover:bg-slate-50 md:hidden cursor-pointer"
              aria-label="Open mobile menu"
            >
              <Menu size={22} strokeWidth={2.25} />
            </button>
          </div>
        </nav>
      </header>

      {/* Mobile Search Below Navbar */}
      <div className="bg-white px-3 pb-2.5 pt-2.5 md:hidden">
        <div className="mx-auto w-full max-w-[1600px]">
          <div className="flex h-[46px] items-center gap-3 rounded-2xl border border-slate-300 bg-white px-3.5 shadow-[0_10px_22px_rgba(15,23,42,0.055),inset_0_1px_0_rgba(255,255,255,0.95)] transition-all focus-within:border-slate-900 focus-within:shadow-[0_14px_30px_rgba(15,23,42,0.09),0_0_0_3px_rgba(15,23,42,0.04)]">
              <span className="flex size-7 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500">
                <Search size={15} strokeWidth={2.3} />
              </span>
              <div className="relative min-w-0 flex-1">
                <AnimatedSearchPlaceholder
                  compact
                  activeIndex={searchRailIndex}
                  disableTransition={isSearchRailResetting}
                  visible={!searchQuery}
                />
                <input
                  aria-label={`Search for ${animatedSearchTerm}`}
                  ref={mobileSearchInputRef}
                  type="text"
                  placeholder=""
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="relative z-10 w-full bg-transparent text-[14px] font-black text-slate-950 caret-slate-950 outline-none placeholder:text-slate-950"
                />
              </div>
              {searchQuery && (
                <button
                  aria-label="Clear search"
                  className="rounded-full p-1 text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-900"
                  onClick={() => setSearchQuery("")}
                  type="button"
                >
                  <X size={13} strokeWidth={2.3} />
                </button>
              )}
          </div>
        </div>
      </div>


      {/* Mobile Sliding Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end md:hidden">
          {/* Backdrop */}
          <div 
            onClick={() => {
              setIsMobileMenuOpen(false);
            }}
            className="fixed inset-0 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
          />

          {/* Drawer Body */}
          <div className="relative z-10 flex h-full w-[84vw] min-w-[300px] max-w-[360px] flex-col overflow-hidden bg-white px-5 py-4 shadow-2xl animate-slide-in-right">
            <div className="flex items-center justify-between border-b border-slate-150 pb-4">
              <span className="flex items-center gap-3 text-lg font-black text-slate-950 [font-weight:950]">
                <span className="flex size-11 items-center justify-center rounded-2xl bg-slate-950 text-white shadow-sm">
                  <ShoppingBag size={18} strokeWidth={2.4} />
                </span>
              <span>{tBrand("name")}</span>
              </span>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                }}
                className="flex size-10 items-center justify-center rounded-2xl text-slate-500 hover:bg-slate-50 hover:text-slate-900 transition-all cursor-pointer"
              >
                <X size={21} strokeWidth={2.4} />
              </button>
            </div>

            {/* Menu Items */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden py-4">
              {/* Navigation Section */}
              <div className="space-y-1.5 overflow-visible">
                <p className="px-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400">{tAria("navigation")}</p>
                <div className="space-y-1.5">
                  <Link
                    href="/"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-[18px] px-3 py-2 text-[15px] font-extrabold text-slate-900 transition-all hover:bg-slate-50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-950">
                      <ShoppingBag size={18} strokeWidth={2.45} />
                    </span>
                    <span>{tNav("home")}</span>
                  </Link>
                  <Link
                    href="#shops"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-[18px] px-3 py-2 text-[15px] font-extrabold text-slate-900 transition-all hover:bg-slate-50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-950">
                      <Store size={18} strokeWidth={2.45} />
                    </span>
                    <span>Nearby Shops</span>
                  </Link>
                  <Link
                    href="#deals"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-[18px] px-3 py-2 text-[15px] font-extrabold text-slate-900 transition-all hover:bg-slate-50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-950">
                      <Sparkles size={18} strokeWidth={2.45} />
                    </span>
                    <span>Offers & Deals</span>
                  </Link>
                  <Link
                    href="/cart"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-h-12 w-full items-center justify-between rounded-[18px] px-3 py-2 text-left text-[15px] font-extrabold text-slate-900 transition-all hover:bg-slate-50"
                  >
                    <span className="flex items-center gap-3">
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-950">
                        <ShoppingCart size={18} strokeWidth={2.45} />
                      </span>
                      <span>{tNav("cart")}</span>
                    </span>
                    {cartItemCount > 0 && (
                      <span className="rounded-full bg-slate-950 px-2.5 py-1 text-xs font-extrabold text-white">
                        {cartItemCount}
                      </span>
                    )}
                  </Link>
                  <Link
                    href="#support"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-h-12 items-center gap-3 rounded-[18px] px-3 py-2 text-[15px] font-extrabold text-slate-900 transition-all hover:bg-slate-50"
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-950">
                      <HelpCircle size={18} strokeWidth={2.45} />
                    </span>
                    <span>Help & Support</span>
                  </Link>
                </div>
              </div>

              {/* Account Section */}
              <div className="mt-auto border-t border-slate-100 pt-4">
                <p className="mb-2.5 px-2 text-[11px] font-extrabold uppercase tracking-[0.18em] text-slate-400">{tNav("account")}</p>
                {isLoggedIn ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3 rounded-[20px] border border-slate-200 bg-slate-50 px-3.5 py-3.5">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-extrabold text-white">
                        {initials}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-[15px] font-extrabold text-slate-950">
                          {profileUser?.fullName || "Namastore user"}
                        </p>
                        <p className="truncate text-[11px] font-semibold text-slate-400">
                          {profileUser?.email}
                        </p>
                      </div>
                    </div>
                    <Link
                      href="/account/profile"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex min-h-12 items-center gap-3 rounded-[18px] px-3 py-2 text-[15px] font-extrabold text-slate-800 hover:bg-slate-50"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-950">
                        <UserIcon size={18} strokeWidth={2.45} />
                      </span>
                      My Profile
                    </Link>
                    <Link
                      href="/account/orders"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex min-h-12 items-center gap-3 rounded-[18px] px-3 py-2 text-[15px] font-extrabold text-slate-800 hover:bg-slate-50"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-slate-950">
                        <History size={18} strokeWidth={2.45} />
                      </span>
                      Order History
                    </Link>
                    <button
                      onClick={handleLogout}
                      className="flex min-h-12 w-full items-center gap-3 rounded-[18px] px-3 py-2 text-left text-[15px] font-extrabold text-rose-650 hover:bg-rose-50"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl border border-rose-100 bg-rose-50 text-rose-650">
                        <LogOut size={18} strokeWidth={2.45} />
                      </span>
                      Sign Out
                    </button>
                  </div>
                ) : (
                  <div className="flex w-full flex-col gap-2.5">
                    <AuthNavigationLink
                      href="/auth/login"
                      onNavigateStart={() => setIsMobileMenuOpen(false)}
                      className="flex h-12 w-full items-center justify-center gap-3 rounded-[18px] border border-slate-200 bg-white text-[15px] font-extrabold text-slate-950 shadow-sm hover:bg-slate-50"
                    >
                      <UserIcon size={18} strokeWidth={2.45} />
                      {tNav("login")}
                    </AuthNavigationLink>
                    <AuthNavigationLink
                      href="/auth/signup"
                      onNavigateStart={() => setIsMobileMenuOpen(false)}
                      className="flex h-12 w-full items-center justify-center gap-3 rounded-[18px] bg-slate-950 text-[15px] font-extrabold text-white shadow-sm"
                    >
                      <Sparkles size={18} strokeWidth={2.45} />
                      {tNav("signup")}
                    </AuthNavigationLink>
                  </div>
                )}
              </div>
            </div>
            
          </div>
        </div>
      )}
    </>
  );
}
