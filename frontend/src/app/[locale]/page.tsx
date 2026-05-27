"use client";

import Image from "next/image";
import { useState } from "react";
import {
  ShoppingBag,
  Star,
  TrendingUp,
  Plus,
  ArrowRight,
  ShieldCheck,
  Clock,
  Sparkles,
  Percent,
  Truck,
  Heart,
  ChevronRight,
  Apple,
  Cake,
  Milk,
  Beef,
  Mail,
  MapPin,
  Headphones,
  CreditCard
} from "lucide-react";
import { Link } from "@/i18n/navigation";
import { useCart } from "@/lib/cart-context";
import { formatIndianRupees } from "@/lib/currency";

// Curated Mock Data for premium visual excellence
const categories = [
  { id: "all", name: "All Shops", count: "25 shops", icon: ShoppingBag, color: "from-slate-500/10 to-slate-600/5 text-slate-800 border-slate-200" },
  { id: "grocery", name: "Grocery", count: "12 shops", icon: ShoppingBag, color: "from-emerald-500/10 to-emerald-600/5 text-emerald-800 border-emerald-100" },
  { id: "vegetables", name: "Vegetables", count: "8 shops", icon: Apple, color: "from-amber-500/10 to-amber-600/5 text-amber-800 border-amber-100" },
  { id: "bakery", name: "Bakery", count: "5 shops", icon: Cake, color: "from-rose-500/10 to-rose-600/5 text-rose-800 border-rose-100" },
  { id: "dairy", name: "Dairy & Eggs", count: "4 shops", icon: Milk, color: "from-blue-500/10 to-blue-600/5 text-blue-800 border-blue-100" },
  { id: "meat", name: "Meat & Fish", count: "3 shops", icon: Beef, color: "from-red-500/10 to-red-600/5 text-red-800 border-red-100" },
];

const mockShops = [
  {
    id: "raja-grocery",
    name: "Raja Grocery",
    distance: "1.2 km away",
    rating: "4.8",
    reviews: "150+ reviews",
    type: "grocery",
    typeName: "Grocery",
    deliveryTime: "15-25 min",
    deliveryFee: "Free",
    imageBg: "from-emerald-500 to-teal-600",
    initials: "RG",
    featuredProduct: "Organic Avocados",
    tags: ["Supermarket", "Organic", "Same-day"]
  },
  {
    id: "fresh-veg-shop",
    name: "Fresh Veg Shop",
    distance: "2.0 km away",
    rating: "4.6",
    reviews: "95 reviews",
    type: "vegetables",
    typeName: "Vegetables",
    deliveryTime: "10-20 min",
    deliveryFee: "₹29",
    imageBg: "from-green-400 to-emerald-500",
    initials: "FV",
    featuredProduct: "Fresh Hass Avocados",
    tags: ["Direct Farm", "Fresh Greens", "Eco-friendly"]
  },
  {
    id: "daily-bakery",
    name: "Daily Bakery",
    distance: "2.5 km away",
    rating: "4.9",
    reviews: "320+ reviews",
    type: "bakery",
    typeName: "Bakery",
    deliveryTime: "20-30 min",
    deliveryFee: "Free",
    imageBg: "from-pink-400 to-rose-500",
    initials: "DB",
    featuredProduct: "Sourdough Bread (Country)",
    tags: ["Artisan", "Freshly Baked", "Desserts"]
  },
  {
    id: "green-dairy",
    name: "Green Meadows Dairy",
    distance: "1.8 km away",
    rating: "4.7",
    reviews: "80 reviews",
    type: "dairy",
    typeName: "Dairy & Eggs",
    deliveryTime: "15-25 min",
    deliveryFee: "₹39",
    imageBg: "from-blue-400 to-indigo-500",
    initials: "GM",
    featuredProduct: "Organic Whole Milk",
    tags: ["Farm Fresh", "Organic", "A2 Milk"]
  },
  {
    id: "premium-butcher",
    name: "The Premium Butcher",
    distance: "3.2 km away",
    rating: "4.9",
    reviews: "180+ reviews",
    type: "meat",
    typeName: "Meat & Fish",
    deliveryTime: "25-35 min",
    deliveryFee: "Free",
    imageBg: "from-red-400 to-rose-600",
    initials: "PB",
    featuredProduct: "A5 Wagyu Ribeye",
    tags: ["Grass-fed", "Premium Cuts", "Imported"]
  }
];

const mockProducts = [
  {
    id: "p1",
    name: "Organic Hass Avocados",
    price: 199,
    originalPrice: 239,
    shop: "Fresh Veg Shop",
    shopId: "fresh-veg-shop",
    discount: "17% OFF",
    rating: "4.8",
    imageBg: "bg-emerald-50 text-emerald-800",
    imageInitials: "AV"
  },
  {
    id: "p2",
    name: "Sourdough Bread (Country)",
    price: 120,
    originalPrice: 149,
    shop: "Daily Bakery",
    shopId: "daily-bakery",
    discount: "13% OFF",
    rating: "4.9",
    imageBg: "bg-amber-50 text-amber-800",
    imageInitials: "SD"
  },
  {
    id: "p3",
    name: "Organic Whole A2 Milk",
    price: 75,
    shop: "Green Meadows Dairy",
    shopId: "green-dairy",
    rating: "4.7",
    imageBg: "bg-blue-50 text-blue-800",
    imageInitials: "MK"
  },
  {
    id: "p4",
    name: "Artisan Chocolate Croissant",
    price: 90,
    originalPrice: 110,
    shop: "Daily Bakery",
    shopId: "daily-bakery",
    discount: "12% OFF",
    rating: "4.8",
    imageBg: "bg-rose-50 text-rose-800",
    imageInitials: "CR"
  }
];

const heroCarouselItems = [
  {
    name: "Organic Hass Avocados",
    detail: "Fresh Veg Shop - 10 min",
    price: formatIndianRupees(199),
    imageUrl: "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=320&q=80"
  },
  {
    name: "Sourdough Bread (Country)",
    detail: "Daily Bakery - 18 min",
    price: formatIndianRupees(120),
    imageUrl: "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=320&q=80"
  },
  {
    name: "Organic Whole A2 Milk",
    detail: "Green Meadows - 14 min",
    price: formatIndianRupees(75),
    imageUrl: "https://images.unsplash.com/photo-1563636619-e9143da7973b?auto=format&fit=crop&w=320&q=80"
  },
  {
    name: "Artisan Chocolate Croissant",
    detail: "Daily Bakery - 20 min",
    price: formatIndianRupees(90),
    imageUrl: "https://images.unsplash.com/photo-1555507036-ab1f4038808a?auto=format&fit=crop&w=320&q=80"
  }
];

const footerLinks = [
  {
    title: "Marketplace",
    links: ["Fresh groceries", "Local bakeries", "Organic produce", "Daily essentials"]
  },
  {
    title: "Customer Care",
    links: ["Help center", "Track an order", "Refund policy", "Delivery support"]
  },
  {
    title: "Company",
    links: ["About Namastore", "Trust & safety", "Local partners", "Careers"]
  }
];

export default function HomePage() {
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [addedProducts, setAddedProducts] = useState<Record<string, boolean>>({});
  const { addToCart } = useCart();

  const toggleFavorite = (shopId: string) => {
    setFavorites(prev => 
      prev.includes(shopId) ? prev.filter(id => id !== shopId) : [...prev, shopId]
    );
  };

  const handleAddProduct = (prodId: string) => {
    const product = mockProducts.find(p => p.id === prodId);
    if (product) {
      addToCart({
        id: product.id,
        name: product.name,
        price: product.price,
        shop: product.shop,
        shopId: product.shopId,
        imageBg: product.imageBg,
        imageInitials: product.imageInitials
      });
    }

    setAddedProducts(prev => ({ ...prev, [prodId]: true }));
    setTimeout(() => {
      setAddedProducts(prev => ({ ...prev, [prodId]: false }));
    }, 1200);
  };

  const filteredShops = selectedCategory === "all" 
    ? mockShops 
    : mockShops.filter(shop => shop.type === selectedCategory);
  const heroLoopItems = [...heroCarouselItems, ...heroCarouselItems];

  return (
    <main className="min-h-screen overflow-x-hidden bg-white text-slate-950 font-sans md:bg-slate-50/50" id="main-content">

      {/* Premium Desktop Hero Section */}
      <section className="hidden overflow-hidden px-3 py-6 sm:px-6 md:block lg:px-8">
        <div className="mx-auto w-full max-w-[1540px] rounded-[2rem] border border-slate-200 bg-white p-2 shadow-[0_28px_90px_rgb(15_23_42_/_0.14)]">
          <div className="relative w-full overflow-hidden rounded-[1.65rem] bg-slate-950 text-white md:min-h-[720px] lg:min-h-[650px]">
            <Image
              src="https://images.unsplash.com/photo-1542838132-92c53300491e?auto=format&fit=crop&w=2400&q=85"
              alt="Fresh produce at a neighborhood market"
              fill
              priority
              sizes="100vw"
              className="object-cover saturate-[0.52] contrast-110"
            />
            <div className="absolute inset-0 bg-zinc-950/68" />
            <div className="absolute inset-0 bg-[linear-gradient(100deg,rgb(9_9_11_/_0.96)_0%,rgb(24_24_27_/_0.88)_48%,rgb(24_24_27_/_0.48)_100%)]" />
            <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-zinc-950/95 to-transparent" />

            <div className="relative z-10 grid w-full min-w-0 gap-10 px-5 pb-4 pt-10 md:min-h-[720px] md:px-8 md:py-14 lg:min-h-[650px] lg:grid-cols-12 lg:items-center lg:px-14 xl:px-16">
              <div className="min-w-0 max-w-full space-y-7 lg:col-span-7">
                <div className="inline-flex max-w-full min-w-0 items-center gap-2 rounded-full border border-stone-200/20 bg-zinc-950/55 px-4 py-2 text-[9px] font-black tracking-[0.04em] text-stone-200 shadow-sm backdrop-blur-md sm:text-xs sm:tracking-wide">
                  <Sparkles size={14} className="shrink-0 text-amber-200" />
                  <span className="truncate">FASTER DELIVERY - NEIGHBORHOOD MARKETPLACE</span>
                </div>

                <div className="space-y-5">
                  <h1 className="max-w-4xl break-words text-4xl font-extrabold leading-[1.04] tracking-tight sm:text-6xl lg:text-7xl">
                    Your neighborhood,
                    <span className="block text-stone-100">
                      delivered in minutes<span className="text-amber-200">.</span>
                    </span>
                  </h1>

                  <p className="max-w-2xl text-base leading-8 text-slate-100 sm:text-lg">
                    Order fresh groceries, organic vegetables, warm artisanal bakes, and daily essentials from local shops you love. Directly supported, super fast, and completely hassle-free.
                  </p>
                </div>

                <div className="flex flex-wrap gap-3 pt-1">
                  <Link
                    href="#shops-section"
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl bg-stone-100 px-6 text-sm font-black text-zinc-950 shadow-[0_18px_44px_rgb(250_250_249_/_0.16)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-white sm:w-auto"
                  >
                    Explore Local Shops
                    <ArrowRight size={16} className="ml-2" />
                  </Link>
                  <Link
                    href="#how-it-works"
                    className="inline-flex h-12 w-full items-center justify-center rounded-xl border border-stone-200/22 bg-zinc-950/35 px-6 text-sm font-black text-stone-100 shadow-sm backdrop-blur-md transition-all duration-200 hover:-translate-y-0.5 hover:bg-zinc-900/55 sm:w-auto"
                  >
                    How it works
                  </Link>
                </div>

                <div className="hidden max-w-3xl gap-3 border-t border-stone-200/14 pt-7 md:grid md:grid-cols-3">
                  <div className="rounded-2xl border border-stone-200/14 bg-zinc-950/42 p-3 backdrop-blur-md sm:p-4">
                    <p className="text-2xl font-extrabold text-white sm:text-3xl">25+</p>
                    <p className="mt-1 text-[11px] font-semibold text-stone-300 sm:text-xs">Trusted Local Shops</p>
                  </div>
                  <div className="rounded-2xl border border-stone-200/14 bg-zinc-950/42 p-3 backdrop-blur-md sm:p-4">
                    <p className="text-2xl font-extrabold text-white sm:text-3xl">15 Min</p>
                    <p className="mt-1 text-[11px] font-semibold text-stone-300 sm:text-xs">Average Delivery Time</p>
                  </div>
                  <div className="rounded-2xl border border-stone-200/14 bg-zinc-950/42 p-3 backdrop-blur-md sm:p-4">
                    <p className="flex items-center gap-1 text-2xl font-extrabold text-white sm:text-3xl">
                      4.8
                      <Star size={22} className="text-amber-300" fill="#fde68a" />
                    </p>
                    <p className="mt-1 text-[11px] font-semibold text-stone-300 sm:text-xs">Customer Satisfaction</p>
                  </div>
                </div>
              </div>

              <div className="hidden min-w-0 md:block lg:col-span-5">
                <div className="animate-hero-float relative mx-auto w-full max-w-[560px] overflow-hidden rounded-[1.75rem] border border-stone-200/16 bg-zinc-950/58 p-4 shadow-[0_28px_80px_rgb(9_9_11_/_0.42)] backdrop-blur-2xl sm:p-5">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-black uppercase tracking-[0.22em] text-amber-200">Local picks near you</p>
                      <h2 className="mt-1 text-lg font-black tracking-tight text-white sm:text-xl">Fresh deals moving now</h2>
                    </div>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-100/18 bg-zinc-950/70 px-3 py-1.5 text-[11px] font-black text-stone-100">
                      <TrendingUp size={13} className="text-amber-200" />
                      Live
                    </span>
                  </div>

                  <div className="hero-carousel-mask space-y-3 overflow-hidden">
                    <div className="flex w-max gap-3 animate-hero-carousel">
                      {heroLoopItems.map((item, index) => (
                        <article
                          key={`${item.name}-top-${index}`}
                          className="flex w-[240px] shrink-0 items-center gap-3 rounded-2xl border border-stone-200/70 bg-stone-50/96 p-3 text-zinc-950 shadow-xl sm:w-[280px]"
                        >
                          <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-stone-200">
                            <Image
                              src={item.imageUrl}
                              alt={item.name}
                              fill
                              sizes="64px"
                              className="object-cover"
                            />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-black">{item.name}</p>
                            <p className="mt-1 truncate text-xs font-bold text-zinc-500">{item.detail}</p>
                          </div>
                          <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-xs font-black text-amber-200">
                            {item.price}
                          </span>
                        </article>
                      ))}
                    </div>

                    <div className="flex w-max gap-3 animate-hero-carousel-reverse">
                      {heroLoopItems.map((item, index) => (
                        <article
                          key={`${item.name}-bottom-${index}`}
                          className="flex w-[220px] shrink-0 items-center justify-between gap-3 rounded-2xl border border-stone-200/12 bg-zinc-950/78 p-3 text-white shadow-lg sm:w-[250px]"
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-stone-100/10 text-amber-200">
                              <ShoppingBag size={17} />
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-black">{item.name}</p>
                              <p className="mt-0.5 truncate text-[11px] font-semibold text-stone-300">{item.detail}</p>
                            </div>
                          </div>
                          <span className="shrink-0 text-xs font-black text-amber-200">{item.price}</span>
                        </article>
                      ))}
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-2 gap-3 border-t border-stone-200/12 pt-4">
                    <div className="rounded-2xl border border-stone-200/12 bg-stone-100/8 p-3">
                      <div className="flex items-center gap-2 text-xs font-black text-stone-50">
                        <Clock size={14} className="text-amber-200" />
                        15 minute average
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-stone-300">Fast dispatch from neighborhood stores.</p>
                    </div>
                    <div className="rounded-2xl border border-stone-200/12 bg-stone-100/8 p-3">
                      <div className="flex items-center gap-2 text-xs font-black text-stone-50">
                        <Percent size={14} className="text-amber-200" />
                        Local offers
                      </div>
                      <p className="mt-1 text-[11px] font-semibold text-stone-300">Fresh prices update with nearby inventory.</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Categories & Layout Content */}
      <section className="mx-auto w-full max-w-[1400px] space-y-5 px-4 pb-8 pt-2 sm:px-6 md:space-y-16 md:py-16 lg:px-8">
        
        {/* Categories Tab Selector */}
        <div className="space-y-4 md:space-y-6">
          <div className="flex flex-col md:flex-row md:items-end justify-between gap-3 md:gap-4">
            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl text-slate-900">
                Explore by Category
              </h2>
              <p className="hidden text-sm text-slate-500 md:block">
                Find specifically what you need from neighborhood specialty stores
              </p>
            </div>
            <div className="flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 transition-all cursor-pointer">
              <span>View All Categories</span>
              <ChevronRight size={14} />
            </div>
          </div>

          <div className="flex overflow-x-auto gap-3 pb-1 scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0 md:pb-3">
            {categories.map((cat) => {
              const IconComp = cat.icon;
              const isSelected = selectedCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`flex items-center gap-2.5 px-4.5 py-3 rounded-2xl border transition-all duration-300 shrink-0 cursor-pointer ${
                    isSelected
                      ? "bg-slate-900 border-slate-900 text-white shadow-md -translate-y-0.5"
                      : `bg-gradient-to-r ${cat.color} hover:shadow-sm hover:-translate-y-0.5`
                  }`}
                >
                  <IconComp size={15} strokeWidth={2.4} />
                  <div>
                    <p className="text-xs font-bold leading-none">{cat.name}</p>
                    <p className={`text-[9px] mt-0.5 leading-none ${isSelected ? "text-slate-300" : "text-slate-450"}`}>
                      {cat.count}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Local Shops Grid */}
        <div id="shops-section" className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl text-slate-900">
                Featured Nearby Shops
              </h2>
              <p className="text-sm text-slate-500">
                Directly ordering keeps 100% of profit with local merchants
              </p>
            </div>
            <span className="rounded-full bg-slate-900 text-white font-bold text-xs px-3 py-1.5 shadow-sm">
              {filteredShops.length} Stores Available
            </span>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {filteredShops.map((shop) => (
              <article
                key={shop.id}
                className="group relative flex flex-col rounded-3xl border border-slate-200/80 bg-white p-5 shadow-sm hover:shadow-xl hover:border-slate-350 hover:-translate-y-1 transition-all duration-300"
              >
                {/* Shop Cover Color Gradient Panel */}
                <div className={`relative h-32 w-full rounded-2xl bg-gradient-to-br ${shop.imageBg} p-4 flex flex-col justify-between overflow-hidden shadow-inner`}>
                  <div className="absolute inset-0 bg-black/10 mix-blend-multiply" />
                  
                  {/* Top Bar on Image */}
                  <div className="relative z-10 flex items-center justify-between w-full">
                    <span className="rounded-full bg-white/95 px-2.5 py-0.5 text-[9px] font-bold text-slate-900 shadow-sm backdrop-blur-sm uppercase tracking-wide">
                      {shop.typeName}
                    </span>
                    <button
                      onClick={() => toggleFavorite(shop.id)}
                      className="flex size-7.5 items-center justify-center rounded-full bg-white/90 hover:bg-white text-slate-700 hover:text-rose-600 transition-all cursor-pointer shadow-sm"
                      title="Add to Favorites"
                    >
                      <Heart size={13} fill={favorites.includes(shop.id) ? "#e11d48" : "none"} className={favorites.includes(shop.id) ? "text-rose-600 scale-110" : "transition-transform group-hover:scale-105"} />
                    </button>
                  </div>

                  {/* Initials badge overlay */}
                  <div className="relative z-10 flex items-center gap-2">
                    <span className="flex size-9 items-center justify-center rounded-xl bg-white font-black text-sm text-slate-900 shadow-md">
                      {shop.initials}
                    </span>
                    <div className="text-white">
                      <h4 className="text-xs font-bold leading-tight drop-shadow-sm">{shop.name}</h4>
                      <p className="text-[10px] text-white/80 mt-0.5 leading-none drop-shadow-sm">{shop.distance}</p>
                    </div>
                  </div>
                </div>

                {/* Shop Details Content */}
                <div className="pt-4 flex-1 flex flex-col justify-between space-y-4">
                  
                  {/* Info Tags */}
                  <div className="flex flex-wrap gap-1.5">
                    {shop.tags.map((tag) => (
                      <span key={tag} className="text-[10px] font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                        {tag}
                      </span>
                    ))}
                  </div>

                  {/* Middle stats bar */}
                  <div className="grid grid-cols-3 gap-2 border-y border-slate-100 py-3 text-center bg-slate-50/50 rounded-2xl">
                    <div>
                      <p className="text-xs font-bold text-slate-900 flex items-center justify-center gap-0.5">
                        <Star size={12} className="text-amber-500" fill="#f59e0b" />
                        {shop.rating}
                      </p>
                      <p className="text-[9px] text-slate-400 mt-0.5">{shop.reviews}</p>
                    </div>
                    <div className="border-x border-slate-200/60">
                      <p className="text-xs font-bold text-slate-900 flex items-center justify-center gap-0.5">
                        <Clock size={12} className="text-slate-500" />
                        {shop.deliveryTime}
                      </p>
                      <p className="text-[9px] text-slate-400 mt-0.5">Delivery</p>
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 flex items-center justify-center gap-0.5">
                        <Truck size={12} className="text-slate-500" />
                        {shop.deliveryFee}
                      </p>
                      <p className="text-[9px] text-slate-400 mt-0.5">Fee</p>
                    </div>
                  </div>

                  {/* Actions footer of shop */}
                  <div className="flex items-center justify-between pt-1">
                    <span className="text-[10px] text-slate-500 font-medium truncate max-w-[130px]">
                      Featured: <strong className="text-slate-800 font-bold">{shop.featuredProduct}</strong>
                    </span>
                    <Link
                      href={`#shop-${shop.id}`}
                      className="inline-flex h-8.5 items-center justify-center rounded-xl bg-slate-900 group-hover:bg-emerald-600 text-white font-bold px-3 text-[11px] hover:shadow-md transition-all cursor-pointer"
                    >
                      Shop Store
                      <ChevronRight size={13} className="ml-0.5 transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </div>

                </div>
              </article>
            ))}
          </div>
        </div>

        {/* Hot Deals & Trending Products section */}
        <div className="space-y-6">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
            <div className="space-y-2">
              <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl text-slate-900 flex items-center gap-2">
                <TrendingUp className="text-rose-600 animate-bounce" size={24} />
                Hot Deals Nearby
              </h2>
              <p className="text-sm text-slate-500">
                High-quality products on discount from recommended local merchants
              </p>
            </div>
            <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800 hover:text-slate-900 transition-all cursor-pointer">
              <span>View All Deals</span>
              <ChevronRight size={14} />
            </div>
          </div>

          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {mockProducts.map((prod) => (
              <div
                key={prod.id}
                className="group relative flex flex-col rounded-3xl border border-slate-200/80 bg-white p-4.5 shadow-sm hover:shadow-lg hover:border-slate-300 transition-all duration-200"
              >
                {/* Discount Badge */}
                {prod.discount && (
                  <span className="absolute top-3.5 left-3.5 z-10 rounded-lg bg-rose-650 px-2 py-0.5 text-[9px] font-black text-white uppercase tracking-wider flex items-center gap-0.5 shadow-sm">
                    <Percent size={8} />
                    {prod.discount}
                  </span>
                )}

                {/* Product placeholder representation */}
                <div className={`h-36 w-full rounded-2xl ${prod.imageBg} flex items-center justify-center font-black text-2xl relative shadow-inner`}>
                  {prod.imageInitials}
                </div>

                {/* Product details */}
                <div className="pt-3 flex-1 flex flex-col justify-between space-y-3.5">
                  <div className="space-y-1">
                    <span className="text-[9px] font-bold text-slate-400 hover:text-slate-650 uppercase tracking-wider block">
                      {prod.shop}
                    </span>
                    <h4 className="text-xs font-bold text-slate-800 line-clamp-1 group-hover:text-slate-950 transition-colors">
                      {prod.name}
                    </h4>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-100">
                    <div className="flex items-baseline gap-1.5">
                      <span className="text-sm font-black text-slate-900">{formatIndianRupees(prod.price)}</span>
                      {prod.originalPrice && (
                        <span className="text-[10px] text-slate-400 line-through">{formatIndianRupees(prod.originalPrice)}</span>
                      )}
                    </div>

                    <button
                      onClick={() => handleAddProduct(prod.id)}
                      className={`inline-flex size-7.5 items-center justify-center rounded-lg border transition-all cursor-pointer ${
                        addedProducts[prod.id]
                          ? "bg-emerald-500 border-emerald-500 text-white scale-95"
                          : "border-slate-200 hover:border-slate-900 bg-slate-50 hover:bg-white text-slate-700 hover:text-slate-950 hover:-translate-y-0.5 shadow-sm"
                      }`}
                      title="Add to Basket"
                    >
                      {addedProducts[prod.id] ? (
                        <span className="text-[9px] font-black uppercase">Added</span>
                      ) : (
                        <Plus size={14} strokeWidth={2.5} />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Why Choose Us Value propositions */}
        <div id="how-it-works" className="rounded-3xl border border-slate-200/80 bg-white p-8 md:p-12 shadow-sm relative overflow-hidden">
          <div className="absolute -top-12 -right-12 h-48 w-48 rounded-full bg-emerald-50/40 -z-10 blur-xl" />
          <div className="absolute -bottom-12 -left-12 h-48 w-48 rounded-full bg-amber-50/40 -z-10 blur-xl" />
          
          <div className="max-w-3xl mx-auto text-center space-y-4 mb-12">
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl text-slate-900">
              The Namastore Promise
            </h2>
            <p className="text-slate-500 text-sm max-w-xl mx-auto">
              Connecting you directly with local shops to keep neighborhood commerce thriving, fast, and fresh.
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-3">
            <div className="space-y-3.5 text-center p-4">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700 border border-emerald-100 shadow-inner">
                <ShieldCheck size={20} strokeWidth={2.2} />
              </span>
              <h3 className="font-bold text-sm text-slate-900">100% Local Profit</h3>
              <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                No massive corporate cut. All profit margins go directly to the neighborhood vendors you purchase from.
              </p>
            </div>

            <div className="space-y-3.5 text-center p-4 border-y md:border-y-0 md:border-x border-slate-100">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700 border border-amber-100 shadow-inner">
                <Clock size={20} strokeWidth={2.2} />
              </span>
              <h3 className="font-bold text-sm text-slate-900">Under 30 Min Delivery</h3>
              <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                Orders are picked immediately and delivered by local partners who live right in your neighborhood.
              </p>
            </div>

            <div className="space-y-3.5 text-center p-4">
              <span className="inline-flex size-11 items-center justify-center rounded-2xl bg-rose-50 text-rose-700 border border-rose-100 shadow-inner">
                <Heart size={20} strokeWidth={2.2} />
              </span>
              <h3 className="font-bold text-sm text-slate-900">Guaranteed Freshness</h3>
              <p className="text-xs text-slate-500 leading-relaxed max-w-xs mx-auto">
                Handpicked items selected directly from local store shelves, ensuring peak freshness and quality.
              </p>
            </div>
          </div>
        </div>

      </section>

      {/* Footer */}
      <footer className="bg-slate-50 px-3 pb-6 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-[1540px] overflow-hidden rounded-[2rem] border border-slate-200 bg-zinc-950 text-stone-100 shadow-[0_28px_90px_rgb(15_23_42_/_0.14)]">
          <div className="grid gap-10 border-b border-stone-200/10 px-6 py-10 sm:px-8 lg:grid-cols-[1.15fr_1.85fr] lg:px-12 lg:py-14">
            <div className="max-w-xl space-y-6">
              <Link href="/" className="inline-flex items-center gap-3" aria-label="Namastore home">
                <span className="flex size-12 items-center justify-center rounded-2xl border border-stone-200/12 bg-stone-100 text-zinc-950 shadow-sm">
                  <ShoppingBag size={22} strokeWidth={2.4} />
                </span>
                <div>
                  <p className="text-xl font-black tracking-tight text-white">Namastore</p>
                  <p className="text-xs font-bold uppercase tracking-[0.18em] text-amber-200">Local commerce, elevated</p>
                </div>
              </Link>

              <p className="text-sm leading-7 text-stone-300">
                Premium neighborhood shopping for fresh groceries, warm bakery goods, daily essentials, and trusted local delivery across nearby Indian communities.
              </p>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-stone-200/10 bg-stone-100/[0.04] p-4">
                  <Clock size={17} className="text-amber-200" />
                  <p className="mt-3 text-sm font-black text-white">15 min</p>
                  <p className="mt-1 text-[11px] font-semibold text-stone-400">Average delivery</p>
                </div>
                <div className="rounded-2xl border border-stone-200/10 bg-stone-100/[0.04] p-4">
                  <ShieldCheck size={17} className="text-amber-200" />
                  <p className="mt-3 text-sm font-black text-white">Secure</p>
                  <p className="mt-1 text-[11px] font-semibold text-stone-400">Protected checkout</p>
                </div>
                <div className="rounded-2xl border border-stone-200/10 bg-stone-100/[0.04] p-4">
                  <CreditCard size={17} className="text-amber-200" />
                  <p className="mt-3 text-sm font-black text-white">INR</p>
                  <p className="mt-1 text-[11px] font-semibold text-stone-400">Rupee billing</p>
                </div>
              </div>
            </div>

            <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {footerLinks.map((section) => (
                <div key={section.title}>
                  <h3 className="text-xs font-black uppercase tracking-[0.18em] text-stone-400">
                    {section.title}
                  </h3>
                  <ul className="mt-4 space-y-3">
                    {section.links.map((item) => (
                      <li key={item}>
                        <Link
                          href="#"
                          className="text-sm font-semibold text-stone-200 transition-colors hover:text-amber-200"
                        >
                          {item}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}

              <div>
                <h3 className="text-xs font-black uppercase tracking-[0.18em] text-stone-400">
                  Contact
                </h3>
                <div className="mt-4 space-y-3 text-sm font-semibold text-stone-200">
                  <Link href="mailto:support@namastore.in" className="flex items-center gap-2 transition-colors hover:text-amber-200">
                    <Mail size={15} className="text-amber-200" />
                    support@namastore.in
                  </Link>
                  <Link href="#support" className="flex items-center gap-2 transition-colors hover:text-amber-200">
                    <Headphones size={15} className="text-amber-200" />
                    24/7 support
                  </Link>
                  <div className="flex items-center gap-2 text-stone-300">
                    <MapPin size={15} className="text-amber-200" />
                    Bengaluru, India
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-5 px-6 py-6 text-xs font-semibold text-stone-400 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-12">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              <span>© 2026 Namastore Technologies</span>
              <span className="hidden h-1 w-1 rounded-full bg-stone-600 sm:block" />
              <span>Built for fast, local, rupee-first commerce.</span>
            </div>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Link href="#terms" className="transition-colors hover:text-stone-100">Terms</Link>
              <Link href="#privacy" className="transition-colors hover:text-stone-100">Privacy</Link>
              <Link href="#security" className="transition-colors hover:text-stone-100">Security</Link>
              <Link href="#accessibility" className="transition-colors hover:text-stone-100">Accessibility</Link>
            </div>
          </div>
        </div>
      </footer>

    </main>
  );
}
