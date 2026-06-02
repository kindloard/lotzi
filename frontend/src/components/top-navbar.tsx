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
  History,
  Store,
  LogOut,
  User as UserIcon,
  HelpCircle,
  ArrowLeft,
  Send
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
import { useDealProducts } from "@/features/shops/hooks/use-deal-products";

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
  const activeTick = ticks.length > 0 ? ticks[activeIndex % ticks.length] : undefined;
  const currentLabel = activeTick?.label ?? "";

  if (ticks.length === 0 || gpsStatus === "idle") {
    return null;
  }

  return (
    <div
      className={`group flex max-w-full min-w-0 items-center gap-1.5 ${
        compact ? "" : ""
      }`}
      title={activeTick?.label}
    >
      {/* Scrolling label rail */}
      <div
        className={`relative overflow-hidden ${
          compact ? "h-[16px]" : "h-[28px]"
        } min-w-0 shrink`}
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
              className={`block max-w-full truncate whitespace-nowrap tracking-tight ${
                compact
                  ? "h-[16px] text-[12px] font-bold leading-[16px] text-slate-700"
                  : "h-[28px] text-base font-black leading-[28px] text-slate-950 [font-weight:950]"
              }`}
            >
              {tick.label.length > 10 ? tick.label.substring(0, 10) + "..." : tick.label}
            </span>
          ))}
          {/* Duplicate first tick for seamless loop */}
          {ticks[0] && (
            <span
              className={`block max-w-full truncate whitespace-nowrap tracking-tight ${
                compact
                  ? "h-[16px] text-[12px] font-bold leading-[16px] text-slate-700"
                  : "h-[28px] text-base font-black leading-[28px] text-slate-950 [font-weight:950]"
              }`}
            >
              {ticks[0].label.length > 10 ? ticks[0].label.substring(0, 10) + "..." : ticks[0].label}
            </span>
          )}
        </div>
      </div>

      {/* Paper plane icon at the end */}
      <Send
        size={compact ? 11 : 15}
        strokeWidth={2.4}
        className={`shrink-0 text-slate-950 transition-all duration-500 ease-in-out ${
          compact ? "w-[11px]" : "w-[15px]"
        } ${currentLabel === brandName ? "opacity-0 scale-50" : "opacity-100 scale-100"}`}
      />
    </div>
  );
}

import { ShopsQueryProvider } from "@/features/shops/providers/shops-query-provider";

export function TopNavbar() {
  const pathname = usePathname();

  if (isAuthPath(pathname)) {
    return null;
  }

  return (
    <ShopsQueryProvider>
      <TopNavbarInner pathname={pathname} />
    </ShopsQueryProvider>
  );
}

function TopNavbarInner({ pathname }: { pathname: string }) {
  const router = useRouter();
  const format = useFormatter();
  const tActions = useTranslations("common.actions");
  const tAria = useTranslations("common.aria");
  const tBrand = useTranslations("common.brand");
  const tCart = useTranslations("cart");
  const tNav = useTranslations("common.navigation");
  const isCartPage = pathname === "/cart";
  const isShopPage = pathname.includes("/shop/");
  const isCheckoutPage = pathname.startsWith("/checkout");
  const { session, clearSession } = useAuthSession();
  const profileUser = session?.user;
  const isLoggedIn = Boolean(profileUser);
  const initials = userInitials(profileUser?.fullName, profileUser?.email);

  // Navigation states
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPlaceholderIndex, setSearchPlaceholderIndex] = useState(0);
  const [isSearchRailResetting, setIsSearchRailResetting] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  
  // Dropdown states
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // App interactions simulated states
  const [isCartBouncing, setIsCartBouncing] = useState(false);

  // Global cart context state
  const { cartItems, cartSubtotal, cartItemCount, updateQty, removeFromCart } = useCart();

  // Fetch real products for live search
  const { data: realProducts = [] } = useDealProducts();

  // References for handling clicks outside dropdowns
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const cartRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSearchInputRef = useRef<HTMLInputElement>(null);

  // ── Location Ticker ──────────────────────────────────────────────────────────
  const [savedAddressLabels, setSavedAddressLabels] = useState<string[]>([]);

  useEffect(() => {
    if (!isLoggedIn || isCheckoutPage) return;
    let cancelled = false;
    fetchCustomerAddresses()
      .then(({ addresses }) => {
        if (cancelled) return;
        const labels = addresses
          .map((a) =>
            [a.label, a.city].filter(Boolean).join(" · ")
          )
          .filter(Boolean)
          .slice(0, 3); // show at most 3 saved addresses
        setSavedAddressLabels(labels);
      })
      .catch(() => undefined); // non-critical — silently ignore
    return () => { cancelled = true; };
  }, [isCheckoutPage, isLoggedIn]);

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
      <header className="sticky top-0 z-50 w-full bg-brand transition-all duration-300 animate-fade-in">
        <nav
          aria-label={tAria("navigation")}
          className="mx-auto flex h-[64px] w-full max-w-[1600px] items-center gap-3 px-3 sm:px-6 lg:px-8"
        >
          <Link
            href="/"
            className="flex size-9 shrink-0 items-center justify-center text-slate-900 focus:outline-none cursor-pointer"
            aria-label="Go back"
          >
            <ArrowLeft className="size-4" strokeWidth={2.4} />
          </Link>
          <h1 className="text-base font-black tracking-tight text-slate-900">Your Basket</h1>
        </nav>
      </header>
    );
  }

  return (
    <>
      <header className={`sticky top-0 z-50 w-full transition-all duration-300 ${isShopPage ? "hidden md:block" : ""}`}>
        {/* Background layers */}
        <div className="absolute inset-0 -z-10 flex flex-col md:hidden">
          <div className="h-[52px] bg-brand" />
          <div className="flex-1 bg-white" />
        </div>
        <div className="absolute inset-0 -z-10 hidden bg-brand md:block" />
      <nav
        aria-label={tAria("navigation")}
        className="mx-auto grid w-full max-w-[1600px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-3 px-3 py-2 sm:gap-x-4 sm:px-6 md:h-[64px] md:grid-cols-[minmax(0,1fr)_minmax(320px,520px)_minmax(0,1fr)] md:py-0 lg:grid-cols-[minmax(0,1fr)_minmax(420px,600px)_minmax(0,1fr)] lg:gap-6 lg:px-8 xl:grid-cols-[minmax(0,1fr)_minmax(460px,640px)_minmax(0,1fr)]"
      >
        {/* Left Side: Logo + Location Ticker */}
        <div className="flex min-w-0 items-center gap-2 justify-self-start sm:gap-4 lg:gap-6 md:w-full">
          <Link
            aria-label={tBrand("name")}
            className="group flex min-w-0 max-w-full items-center gap-3 rounded-xl focus:outline-none md:w-full"
            href="/"
          >
            <span className="relative flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-black text-white transition-all duration-200">
              <ShoppingBag aria-hidden="true" size={16} strokeWidth={2.4} />
            </span>
            {/* Location ticker OR fallback brand name */}
            <span className="flex min-w-0 max-w-full flex-1 flex-col justify-center">
              {ticks.length > 0 && gpsStatus !== "idle" ? (
                <AnimatedLocationTicker
                  ticks={ticks}
                  activeIndex={locationIndex}
                  isResetting={locationResetting}
                  gpsStatus={gpsStatus}
                  brandName={tBrand("name")}
                />
              ) : (
                <span className="block max-w-full truncate text-lg font-black tracking-tight text-slate-950 [font-weight:950]">
                  {tBrand("name")}
                </span>
              )}
            </span>
          </Link>
        </div>

        {/* Middle Side: Premium Search with hotkeys & smart suggestion panel */}
        <div className="relative order-last col-span-full w-full justify-self-center md:order-none md:col-span-1 md:flex max-w-full md:max-w-[520px] lg:max-w-[576px]" ref={searchContainerRef}>
          {!isShopPage && !isCheckoutPage && (
            <>
              {/* Mobile Overlay Backdrop */}
              {isSearchFocused && (
                <div 
                  className="fixed inset-0 z-[90] bg-white md:hidden animate-fade-in" 
                  onClick={() => setIsSearchFocused(false)} 
                />
              )}

              <div 
                className={`transition-all duration-300 w-full ${
                  isSearchFocused 
                    ? "fixed inset-x-0 top-0 z-[100] bg-white p-3 md:static md:z-auto md:bg-transparent md:p-0 md:animate-none" 
                    : ""
                }`}
              >
                <div 
                  onClick={() => searchInputRef.current?.focus()}
                  className={`flex items-center gap-3 w-full rounded-full transition-all duration-200 cursor-text ${
                    isSearchFocused 
                      ? "px-4 py-2 bg-white shadow-none md:border md:border-slate-900 md:shadow-[0_4px_12px_rgba(0,0,0,0.05)] md:py-2 border border-black" 
                      : "px-4 py-2 bg-white border border-black"
                  }`}
                >
                  {isSearchFocused ? (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setIsSearchFocused(false);
                      }}
                      className="md:hidden p-1 -ml-2 text-slate-500"
                      aria-label="Close search"
                    >
                      <ArrowLeft size={20} strokeWidth={2.5} />
                    </button>
                  ) : (
                    <Search className="shrink-0 transition-colors duration-200 text-slate-400" size={18} strokeWidth={2.2} />
                  )}
                  
                  {isSearchFocused && <Search className="hidden md:block shrink-0 transition-colors duration-200 text-slate-900" size={18} strokeWidth={2.2} />}
                  
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
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && searchQuery.trim()) {
                          setRecentSearches(prev => {
                            const newSearches = [searchQuery.trim(), ...prev.filter(s => s !== searchQuery.trim())];
                            return newSearches.slice(0, 2);
                          });
                          setIsSearchFocused(false);
                        }
                      }}
                      onFocus={() => setIsSearchFocused(true)}
                      className="relative z-10 w-full bg-transparent text-[15px] md:text-sm font-medium text-slate-950 caret-slate-950 outline-none placeholder:text-slate-500"
                    />
                  </div>
                  {searchQuery && (
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setSearchQuery("");
                        searchInputRef.current?.focus();
                      }} 
                      className="p-1 rounded-full text-slate-400 cursor-pointer bg-slate-200 md:bg-slate-100 md:bg-transparent"
                    >
                      <X size={14} strokeWidth={2.5} />
                    </button>
                  )}
                </div>

                {/* Premium Search Overlay Dropdown (FAANG Grade) */}
                {isSearchFocused && (
                  <div className="absolute left-0 top-[100%] md:mt-3 w-full bg-white md:bg-white/90 md:backdrop-blur-xl border-t border-slate-100 md:border md:border-slate-200 md:rounded-[24px] shadow-none md:shadow-[0_30px_80px_rgba(0,0,0,0.12),0_4px_20px_rgba(0,0,0,0.04)] animate-scale-up z-50 p-0 md:p-2 overflow-hidden ring-0 md:ring-1 md:ring-slate-950/5 h-[calc(100vh-68px)] md:h-auto">
                    <div className="h-full md:max-h-[460px] overflow-y-auto scrollbar-hide pb-20 md:pb-0">
                      
                      {!searchQuery && (
                        <div className="p-2 mb-2 border-b border-slate-100 md:border-none">
                          <div className="flex items-center gap-2 px-2 mb-3 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                            <History size={14} strokeWidth={2.5} className="text-blue-500" />
                            <span>Recent Searches</span>
                          </div>
                          {recentSearches.length > 0 ? (
                            <div className="flex flex-wrap gap-2 px-2">
                              {recentSearches.slice(0, 2).map((search) => (
                                <button
                                  key={search}
                                  onClick={() => {
                                    setSearchQuery(search);
                                  }}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-700 text-sm font-medium rounded-full"
                                >
                                  {search}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="px-2 py-3 text-[13px] text-slate-500 font-medium">
                              No search history
                            </div>
                          )}
                        </div>
                      )}

                      {/* Search Results (Live) */}
                      {searchQuery && (
                        <div className="p-2 space-y-1">
                        <div className="flex items-center justify-between px-2 mb-3">
                          <div className="flex items-center gap-2 text-[11px] font-semibold tracking-wider text-slate-500 uppercase">
                            <Sparkles size={14} strokeWidth={2.5} className="text-emerald-500" />
                            <span>Top Results</span>
                          </div>
                        </div>
                        {realProducts
                          .filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.shop.toLowerCase().includes(searchQuery.toLowerCase()))
                          .slice(0, 8)
                          .map((product) => (
                          <button
                            key={product.id}
                            onClick={() => {
                              setSearchQuery(product.name);
                              setRecentSearches(prev => {
                                const newSearches = [product.name, ...prev.filter(s => s !== product.name)];
                                return newSearches.slice(0, 2);
                              });
                              setIsSearchFocused(false);
                            }}
                            className="w-full flex items-center justify-between p-3 rounded-[18px] text-left cursor-pointer border border-transparent"
                          >
                            <div className="flex items-center gap-4">
                              <div className="relative flex size-14 shrink-0 overflow-hidden rounded-[14px] bg-slate-100 shadow-sm border border-slate-200/50">
                                {product.imageUrl ? (
                                  <img src={product.imageUrl} alt={product.name} className="h-full w-full object-cover" />
                                ) : (
                                  <div className={`flex h-full w-full items-center justify-center font-bold text-white ${product.imageBg}`}>
                                    {product.imageInitials}
                                  </div>
                                )}
                              </div>
                              <div>
                                <p className="text-[15px] font-semibold text-slate-900 leading-tight tracking-tight">{product.name}</p>
                                <p className="text-[12px] font-medium text-slate-500 mt-0.5">{product.shop}</p>
                              </div>
                            </div>
                            <div className="shrink-0 text-right ml-4">
                              <span className="text-[15px] font-bold text-slate-900 tracking-tight">
                                {money(product.price)}
                              </span>
                            </div>
                          </button>
                        ))}
                        
                        {searchQuery && realProducts.filter((p) => p.name.toLowerCase().includes(searchQuery.toLowerCase()) || p.shop.toLowerCase().includes(searchQuery.toLowerCase())).length === 0 && (
                          <div className="p-12 text-center">
                            <Search className="mx-auto text-slate-300 mb-3" size={36} strokeWidth={1.5} />
                            <p className="text-base font-semibold text-slate-900">No products found</p>
                            <p className="text-sm text-slate-500 mt-1">Try a different search term</p>
                          </div>
                        )}
                      </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        {/* Right Side: Cart, User Profile & Mobile Toggle */}
        <div className="flex min-w-0 shrink-0 items-center justify-self-end gap-1.5 sm:gap-3 md:w-full md:justify-end">
          
          {/* Cart Icon Dropdown */}
          <div className="relative hidden md:block" ref={cartRef}>
            <button
              onClick={() => setIsCartOpen(!isCartOpen)}
              className={`relative flex size-10 items-center justify-center rounded-lg bg-white text-slate-800 cursor-pointer focus:outline-none focus:ring-4 focus:ring-slate-950/5 ${
                isCartBouncing ? "animate-cart-bounce" : ""
              }`}
              aria-expanded={isCartOpen}
              aria-haspopup="true"
            >
              <ShoppingCart size={16} strokeWidth={2.2} />
              {cartItemCount > 0 && (
                <span className="absolute -top-1.5 -right-1.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-black px-1 text-[9px] font-bold text-white shadow-md animate-scale-up">
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
                                className="p-1 text-slate-500 cursor-pointer"
                              >
                                <Minus size={10} strokeWidth={3} />
                              </button>
                              <span className="text-[11px] font-bold px-2 text-slate-700">{item.qty}</span>
                              <button
                                onClick={() => handleUpdateQty(item.id, 1)}
                                className="p-1 text-slate-500 cursor-pointer"
                              >
                                <Plus size={10} strokeWidth={3} />
                              </button>
                            </div>
                            <button
                              onClick={() => handleRemoveItem(item.id)}
                              className="p-1 text-slate-400 cursor-pointer"
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
                        className="flex h-9 w-full items-center justify-center rounded-xl bg-black text-xs font-bold text-white shadow-sm"
                      >
                        {tCart("summary.checkout")}
                      </Link>
                    </div>
                  </>
                ) : (
                  <div className="py-8 text-center">
                    <ShoppingCart className="mx-auto text-slate-300 mb-2.5" size={24} />
                    <p className="text-xs text-slate-400 font-medium">{tCart("emptyTitle")}</p>
                    <Link
                      href="/"
                      onClick={() => setIsCartOpen(false)}
                      className="mt-3 inline-flex px-3 py-1.5 rounded-lg border border-slate-250 text-[10px] font-bold text-slate-650 cursor-pointer"
                    >
                      {tCart("browseProducts")}
                    </Link>
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
                className="flex items-center gap-1.5 rounded-lg bg-white p-1 focus:outline-none focus:ring-4 focus:ring-slate-950/5 cursor-pointer"
                aria-expanded={isProfileOpen}
                aria-haspopup="true"
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-black text-xs font-bold text-white shadow-inner">
                  {initials}
                </span>
                <ChevronDown className="text-slate-400 mr-1 hidden sm:block" size={12} strokeWidth={2.5} />
              </button>
            ) : (
              <div className="hidden sm:flex shrink-0 items-center gap-2.5">
                <LanguageSwitcher compact />
                <AuthNavigationLink
                  href="/auth/login"
                  className="inline-flex h-10 shrink-0 whitespace-nowrap items-center justify-center rounded-lg bg-white px-5 text-sm font-bold text-slate-900 focus:outline-none focus:ring-4 focus:ring-slate-900/5 cursor-pointer"
                >
                  {tNav("login")}
                </AuthNavigationLink>
                <AuthNavigationLink
                  href="/auth/signup"
                  className="inline-flex h-10 shrink-0 whitespace-nowrap items-center justify-center rounded-lg bg-black px-5 text-sm font-bold text-white focus:outline-none focus:ring-4 focus:ring-black/10 cursor-pointer"
                >
                  {tNav("signup")}
                </AuthNavigationLink>
              </div>
            )}

            {isProfileOpen && isLoggedIn && (
              <div className="absolute right-0 mt-2.5 w-56 origin-top-right rounded-2xl border border-slate-100 bg-white p-2.5 shadow-[0_12px_40px_-4px_rgba(15,23,42,0.06),0_4px_20px_-2px_rgba(15,23,42,0.02)] animate-scale-up z-50">
                <div className="px-2.5 py-2 border-b border-slate-100">
                  <p className="text-xs font-bold text-slate-800">
                    {profileUser?.fullName || "Lotzi user"}
                  </p>
                  <p className="text-[11px] text-slate-400 mt-0.5 truncate">{profileUser?.email}</p>
                </div>

                <div className="py-1">
                  <Link
                    href="/account/profile"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 font-medium"
                  >
                    <UserIcon size={13} className="text-slate-450" />
                    My Profile
                  </Link>
                  <Link
                    href="/account/orders"
                    onClick={() => setIsProfileOpen(false)}
                    className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 font-medium"
                  >
                    <History size={13} className="text-slate-450" />
                    Order History
                  </Link>
                  {profileUser?.roleCodes.includes("MERCHANT_OWNER") && (
                    <Link
                      href="/merchant/dashboard"
                      onClick={() => setIsProfileOpen(false)}
                      className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-slate-600 font-medium"
                    >
                      <Store size={13} className="text-slate-450" />
                      Manage Store
                    </Link>
                  )}
                </div>

                <div className="border-t border-slate-100 my-1" />

                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs text-rose-650 font-bold text-left cursor-pointer"
                >
                  <LogOut size={13} />
                  Sign Out
                </button>
              </div>
            )}
          </div>

          <div className="md:hidden flex items-center pr-1">
            <LanguageSwitcher compact />
          </div>
          
          {/* Mobile hamburger menu drawer button */}
            <button
              onClick={() => setIsMobileMenuOpen(true)}
              className="flex size-11 items-center justify-center rounded-2xl bg-transparent text-slate-950 md:hidden cursor-pointer"
              aria-label="Open mobile menu"
            >
              <Menu size={22} strokeWidth={2.25} />
            </button>
          </div>
        </nav>
      </header>



      {/* Mobile Sliding Navigation Drawer */}
      {isMobileMenuOpen && (
        <div className="fixed inset-0 z-[100] flex justify-end md:hidden">
          {/* Backdrop */}
          <div 
            onClick={() => {
              setIsMobileMenuOpen(false);
            }}
            className="fixed inset-0 bg-black/40 backdrop-blur-sm animate-fade-in"
          />

          {/* Drawer Body */}
          <div className="relative z-10 flex h-full w-[84vw] min-w-[300px] max-w-[360px] flex-col overflow-hidden bg-white px-5 py-4 shadow-2xl border-l border-slate-100 animate-slide-in-right">
            <div className="flex items-center justify-between border-b border-slate-100/80 pb-4">
              <span className="flex items-center gap-3 text-lg font-black text-slate-950 [font-weight:950]">
                <span className="flex size-10 items-center justify-center rounded-xl bg-black text-white shadow-sm">
                  <ShoppingBag size={16} strokeWidth={2.4} />
                </span>
                <span>{tBrand("name")}</span>
              </span>
              <button
                onClick={() => {
                  setIsMobileMenuOpen(false);
                }}
                className="flex size-9 items-center justify-center rounded-xl text-slate-400 cursor-pointer"
              >
                <X size={18} strokeWidth={2.4} />
              </button>
            </div>

            {/* Menu Items */}
            <div className="flex min-h-0 flex-1 flex-col overflow-y-auto scrollbar-hide py-4">
              {/* Navigation Section */}
              <div className="space-y-1.5 overflow-visible">
                <div className="space-y-1">
                  <Link
                    href="/"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3.5 rounded-xl px-2.5 py-1.5 text-sm font-bold text-slate-700"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100/50 text-slate-700">
                      <ShoppingBag size={16} strokeWidth={2.2} />
                    </span>
                    <span>{tNav("home")}</span>
                  </Link>

                  <Link
                    href="/cart"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-h-11 w-full items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-sm font-bold text-slate-700"
                  >
                    <span className="flex items-center gap-3.5">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100/50 text-slate-700">
                        <ShoppingCart size={16} strokeWidth={2.2} />
                      </span>
                      <span>{tNav("cart")}</span>
                    </span>
                    {cartItemCount > 0 && (
                      <span className="rounded-full bg-slate-950 px-2.5 py-0.5 text-[11px] font-extrabold text-white shadow-sm">
                        {cartItemCount}
                      </span>
                    )}
                  </Link>

                  {isLoggedIn && profileUser?.roleCodes.includes("MERCHANT_OWNER") && (
                    <Link
                      href="/merchant/dashboard"
                      onClick={() => setIsMobileMenuOpen(false)}
                      className="flex min-h-11 items-center gap-3.5 rounded-xl px-2.5 py-1.5 text-sm font-bold text-slate-700"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100/50 text-slate-700">
                        <Store size={16} strokeWidth={2.2} />
                      </span>
                      Manage Store
                    </Link>
                  )}

                  {isLoggedIn && (
                    <>
                      <Link
                        href="/account"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="flex min-h-11 items-center gap-3.5 rounded-xl px-2.5 py-1.5 text-sm font-bold text-slate-700"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100/50 text-slate-700">
                          <UserIcon size={16} strokeWidth={2.2} />
                        </span>
                        My Profile
                      </Link>
                      <Link
                        href="/account/orders"
                        onClick={() => setIsMobileMenuOpen(false)}
                        className="flex min-h-11 items-center gap-3.5 rounded-xl px-2.5 py-1.5 text-sm font-bold text-slate-700"
                      >
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100/50 text-slate-700">
                          <History size={16} strokeWidth={2.2} />
                        </span>
                        Order History
                      </Link>
                    </>
                  )}

                  <Link
                    href="#support"
                    onClick={() => setIsMobileMenuOpen(false)}
                    className="flex min-h-11 items-center gap-3.5 rounded-xl px-2.5 py-1.5 text-sm font-bold text-slate-700"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-slate-100/50 text-slate-700">
                      <HelpCircle size={16} strokeWidth={2.2} />
                    </span>
                    <span>Help & Support</span>
                  </Link>

                  {isLoggedIn && (
                    <button
                      onClick={handleLogout}
                      className="flex min-h-11 w-full items-center gap-3.5 rounded-xl px-2.5 py-1.5 text-left text-sm font-bold text-rose-600"
                    >
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-rose-50/50 text-rose-600">
                        <LogOut size={16} strokeWidth={2.2} />
                      </span>
                      Sign Out
                    </button>
                  )}
                </div>
              </div>

              {/* Account Section / Bottom Footer */}
              <div className="mt-auto border-t border-slate-100/80 pt-4">
                {isLoggedIn ? (
                  <div className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-3.5 py-3 shadow-[0_4px_12px_rgba(0,0,0,0.02)] my-1">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-slate-950 text-xs font-bold text-white shadow-inner">
                      {initials}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-bold text-slate-950 leading-tight">
                        {profileUser?.fullName || "Lotzi user"}
                      </p>
                      <p className="truncate text-[10px] font-medium text-slate-400 mt-0.5 leading-none">
                        {profileUser?.email}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="flex w-full flex-col gap-2 pt-1">
                    <AuthNavigationLink
                      href="/auth/login"
                      onNavigateStart={() => setIsMobileMenuOpen(false)}
                      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-slate-100 text-sm font-bold text-slate-955"
                    >
                      <UserIcon size={16} strokeWidth={2.2} />
                      {tNav("login")}
                    </AuthNavigationLink>
                    <AuthNavigationLink
                      href="/auth/signup"
                      onNavigateStart={() => setIsMobileMenuOpen(false)}
                      className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg bg-black text-sm font-bold text-white"
                    >
                      <Sparkles size={16} strokeWidth={2.2} />
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
