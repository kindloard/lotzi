"use client";

import React, { useState, useEffect } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import Image from "next/image";
import { Skeleton, SkeletonSurface, SkeletonText } from "@/components/skeleton-engine";
import {
  ShoppingBag,
  Plus,
  Minus,
  Check,
  Tag,
  MapPin,
  Clock,
  CalendarClock,
  ShieldCheck,
  CreditCard,
  X,
  Bike,
  Zap,
  Gift,
  Loader2,
  ArrowRight,
  Percent
} from "lucide-react";
import { useCart, CartItem } from "@/lib/cart-context";
import { formatIndianRupees } from "@/lib/currency";

interface PlacedOrderDetails {
  orderId: string;
  items: CartItem[];
  subtotal: number;
  discount: number;
  tax: number;
  deliveryFee: number;
  grandTotal: number;
  address: string;
  speed: string;
}

function CartPageSkeleton() {
  return (
    <main
      aria-busy="true"
      className="min-h-screen overflow-x-hidden bg-slate-50/50 px-3 pb-12 pt-5 font-sans sm:px-6 sm:pt-6 lg:px-8"
      id="main-content"
    >
      <div className="mx-auto w-full min-w-0 max-w-[1280px]">
        <div className="mb-8">
          <Skeleton height={28} radius="lg" width={160} />
          <SkeletonText className="mt-3 max-w-md" lines={2} widths={["92%", "58%"]} />
        </div>

        <div className="grid min-w-0 grid-cols-1 items-start gap-8 lg:grid-cols-12">
          <div className="w-full max-w-[calc(100vw-24px)] min-w-0 space-y-6 sm:max-w-none lg:col-span-8">
            <SkeletonSurface className="overflow-hidden" padded={false}>
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 px-3 py-3.5 sm:px-5">
                <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                  <Skeleton height={36} radius="xl" width={36} />
                  <SkeletonText lines={2} widths={[150, 112]} />
                </div>
                <Skeleton height={32} radius="xl" width={82} />
              </div>

              <div className="divide-y divide-slate-100">
                {[0, 1].map((item) => (
                  <div
                    className="grid grid-cols-[48px_minmax(0,1fr)_82px] items-start gap-2 px-3 py-4 sm:grid-cols-[60px_minmax(0,1fr)_104px] sm:gap-4 sm:px-5"
                    key={item}
                  >
                    <Skeleton height={48} radius="2xl" width={48} />
                    <SkeletonText
                      className="min-w-0 pt-1"
                      lines={2}
                      widths={item === 0 ? ["88%", "68%"] : ["96%", "60%"]}
                    />
                    <div className="flex min-w-0 flex-col items-end gap-2">
                      <Skeleton height={32} radius="xl" width={82} />
                      <Skeleton height={15} radius="full" width={70} />
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex h-12 items-center justify-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4">
                <Skeleton height={13} radius="full" width={210} />
              </div>
            </SkeletonSurface>

            <SkeletonSurface>
              <div className="mb-4 flex items-center gap-2">
                <Skeleton height={18} radius="full" width={18} />
                <Skeleton height={16} radius="full" width={122} />
              </div>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Skeleton height={96} radius="xl" />
                <Skeleton height={96} radius="xl" tone="soft" />
              </div>
            </SkeletonSurface>

            <SkeletonSurface>
              <div className="mb-4 flex items-center gap-2">
                <Skeleton height={18} radius="full" width={18} />
                <Skeleton height={16} radius="full" width={132} />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <Skeleton height={78} radius="xl" />
                <Skeleton height={78} radius="xl" tone="soft" />
                <Skeleton height={78} radius="xl" tone="soft" />
              </div>
            </SkeletonSurface>
          </div>

          <div className="w-full max-w-[calc(100vw-24px)] min-w-0 space-y-6 sm:max-w-none lg:col-span-4">
            <SkeletonSurface>
              <Skeleton height={16} radius="full" width={120} />
              <div className="mt-4 flex gap-2">
                <Skeleton height={42} radius="xl" />
                <Skeleton height={42} radius="xl" width={72} />
              </div>
              <SkeletonText className="mt-5" lines={3} widths={["100%", "90%", "96%"]} />
            </SkeletonSurface>

            <SkeletonSurface>
              <Skeleton height={16} radius="full" width={116} />
              <div className="mt-5 space-y-3">
                {[0, 1, 2, 3].map((row) => (
                  <div className="flex items-center justify-between gap-4" key={row}>
                    <Skeleton height={12} radius="full" width={row === 3 ? 90 : 128} />
                    <Skeleton height={12} radius="full" width={56} />
                  </div>
                ))}
              </div>
              <Skeleton className="mt-5" height={48} radius="xl" />
            </SkeletonSurface>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function CartPage() {
  const router = useRouter();
  const {
    cartItems,
    cartSubtotal,
    updateQty,
    removeFromCart,
    clearCart,
    isCartReady
  } = useCart();

  // State
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountPercent: number } | null>(null);
  const [deliverySpeed, setDeliverySpeed] = useState<"standard" | "priority">("standard");
  const [selectedAddressId, setSelectedAddressId] = useState<"home" | "work" | "custom">("home");
  const [customAddress, setCustomAddress] = useState("");
  const [customAddressInput, setCustomAddressInput] = useState("");
  const [checkoutStep, setCheckoutStep] = useState<"idle" | "verifying" | "securing" | "processing" | "success">("idle");
  const [placedOrderDetails, setPlacedOrderDetails] = useState<PlacedOrderDetails | null>(null);
  const [addressError, setAddressError] = useState<string | null>(null);

  // Pricing calculations
  const subtotal = cartSubtotal;
  const deliveryFee = deliverySpeed === "priority" ? 49 : 0;
  const discount = appliedPromo ? (subtotal * appliedPromo.discountPercent) / 100 : 0;
  const tax = Math.max(0, (subtotal - discount) * 0.18); // 18% GST/Tax on discounted subtotal
  const grandTotal = Math.max(0, subtotal + deliveryFee + tax - discount);

  // Address lookup helper
  const getAddressText = () => {
    if (selectedAddressId === "home") return "Home - 12 Main St, Primary Address";
    if (selectedAddressId === "work") return "Work - 45 Tech Park, Tower B, Office Address";
    return customAddress || "Click edit to set custom address";
  };

  // Promo code validation
  const handleApplyPromo = (e: React.FormEvent) => {
    e.preventDefault();
    setPromoError(null);

    const codeClean = promoCode.trim().toUpperCase();
    if (!codeClean) {
      setPromoError("Please enter a promo code");
      return;
    }

    if (codeClean === "WELCOME10") {
      setAppliedPromo({ code: "WELCOME10", discountPercent: 10 });
      setPromoCode("");
    } else if (codeClean === "LOCAL5") {
      setAppliedPromo({ code: "LOCAL5", discountPercent: 5 });
      setPromoCode("");
    } else {
      setPromoError("Invalid promo code. Try WELCOME10 or LOCAL5");
    }
  };

  const handleRemovePromo = () => {
    setAppliedPromo(null);
  };

  // Address validation
  useEffect(() => {
    if (selectedAddressId === "custom" && !customAddress.trim()) {
      setAddressError("Please set your custom delivery address");
    } else {
      setAddressError(null);
    }
  }, [selectedAddressId, customAddress]);

  // Checkout handling
  const handlePlaceOrder = () => {
    if (cartItems.length === 0) return;
    if (selectedAddressId === "custom" && !customAddress.trim()) {
      setAddressError("Please enter and save a custom delivery address first");
      return;
    }

    // Begin checkout animation steps
    setCheckoutStep("verifying");

    setTimeout(() => {
      setCheckoutStep("securing");
      
      setTimeout(() => {
        setCheckoutStep("processing");

        setTimeout(() => {
          // Complete payment and generate order details
          const generatedOrderId = `NMA-${Math.floor(10000 + Math.random() * 90000)}-${Math.floor(100 + Math.random() * 900)}`;
          
          setPlacedOrderDetails({
            orderId: generatedOrderId,
            items: [...cartItems],
            subtotal,
            discount,
            tax,
            deliveryFee,
            grandTotal,
            address: getAddressText(),
            speed: deliverySpeed === "priority" ? "Priority Delivery" : "Standard Delivery"
          });

          setCheckoutStep("success");
          clearCart(); // Flush global state
        }, 800);
      }, 700);
    }, 600);
  };

  // Loading text depending on animation stage
  const getLoaderText = () => {
    if (checkoutStep === "verifying") return "Verifying basket items...";
    if (checkoutStep === "securing") return "Establishing secure gateway...";
    if (checkoutStep === "processing") return "Processing payment & booking courier...";
    return "Finalizing order...";
  };

  const handleQuantityChange = (item: CartItem, delta: number) => {
    if (delta < 0 && item.qty <= 1) {
      removeFromCart(item.id);
      return;
    }

    updateQty(item.id, delta);
  };

  if (!isCartReady) {
    return <CartPageSkeleton />;
  }

  return (
    <main className="min-h-screen overflow-x-hidden bg-slate-50/50 px-3 pb-12 pt-5 font-sans sm:px-6 sm:pt-6 lg:px-8" id="main-content">
      <div className="mx-auto w-full min-w-0 max-w-[1280px]">
        
        {/* Navigation & Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Your Basket</h1>
          <p className="text-xs text-slate-450 mt-0.5">
            Review your selections from premium local neighborhood stores
          </p>
        </div>

        {cartItems.length === 0 && checkoutStep !== "success" ? (
          /* Empty Basket State */
          <div className="text-center py-20 bg-white border border-slate-200 rounded-[32px] shadow-sm max-w-xl mx-auto p-8 animate-scale-up">
            <span className="flex size-16 items-center justify-center rounded-full bg-slate-100 mx-auto text-slate-400 mb-5">
              <ShoppingBag size={28} />
            </span>
            <h2 className="text-lg font-bold text-slate-900">Your basket is empty</h2>
            <p className="text-xs text-slate-450 mt-2 max-w-sm mx-auto">
              Explore outstanding local products, fresh vegetables, and organic groceries from nearby stores and add them to your cart.
            </p>
            <Link
              href="/"
              className="mt-6 inline-flex h-11 items-center justify-center px-6 rounded-xl bg-slate-950 text-xs font-bold text-white shadow-md hover:bg-slate-850 hover:-translate-y-0.5 transition-all duration-200"
            >
              Start Shopping
            </Link>
          </div>
        ) : (
          /* Two Column Checkout Interface */
          <div className="grid min-w-0 grid-cols-1 items-start gap-8 lg:grid-cols-12">
            
            {/* Left Column: Items, Delivery, Address */}
            <div className="w-full max-w-[calc(100vw-24px)] min-w-0 space-y-6 sm:max-w-none lg:col-span-8">
              
              {/* Premium Product List */}
              <section className="w-full min-w-0 max-w-full overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.07)] animate-scale-up">
                <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 border-b border-slate-100 px-3 py-3.5 sm:gap-4 sm:px-5">
                  <div className="flex min-w-0 items-center gap-2 sm:gap-3">
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm">
                      <Clock size={17} strokeWidth={2.4} />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-[13px] font-black leading-tight text-slate-950 sm:text-sm">
                        Delivering in {deliverySpeed === "priority" ? "12" : "16"} mins
                      </h2>
                      <p className="mt-0.5 text-xs font-semibold text-slate-400">
                        {cartItems.length} {cartItems.length === 1 ? "product" : "products"} | {cartItems.reduce((count, item) => count + item.qty, 0)} items
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-xl border border-amber-200 bg-amber-50 px-2 text-[11px] font-black text-amber-800 transition-all hover:-translate-y-0.5 hover:border-amber-300 hover:bg-amber-100 focus:outline-none focus:ring-4 focus:ring-amber-200/50 sm:h-9 sm:gap-2 sm:px-3 sm:text-xs"
                  >
                    <CalendarClock size={13} strokeWidth={2.4} />
                    <span>Schedule</span>
                  </button>
                </div>

                <div className="divide-y divide-slate-100">
                  {cartItems.map((item) => {
                    const originalPrice = item.price * item.qty * 1.12;
                    const lineTotal = item.price * item.qty;

                    return (
                      <article
                        key={item.id}
                        className="grid grid-cols-[48px_minmax(0,1fr)_82px] items-start gap-2 px-3 py-4 transition-colors hover:bg-slate-50/55 sm:grid-cols-[60px_minmax(0,1fr)_104px] sm:gap-4 sm:px-5"
                      >
                        <span className={`relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl font-black text-sm shadow-sm ring-1 ring-slate-950/[0.04] sm:size-14 ${item.imageBg}`}>
                          {item.imageUrl ? (
                            <Image
                              alt=""
                              className="absolute inset-0 size-full object-cover"
                              fill
                              loading="lazy"
                              sizes="56px"
                              src={item.imageUrl}
                            />
                          ) : (
                            item.imageInitials
                          )}
                        </span>

                        <div className="min-w-0 flex-1">
                          <h3 className="line-clamp-2 text-sm font-black leading-snug text-slate-950">
                            {item.name}
                          </h3>
                          <p className="mt-1 text-xs font-semibold text-slate-400">
                            {item.unitDisplay ?? item.unit ?? "1 pc"} | {item.pricePerBaseUnitDisplay ?? `${formatIndianRupees(item.price)} each`}
                          </p>
                        </div>

                        <div className="flex min-w-0 flex-col items-end gap-2">
                          <div className="flex h-8 items-center overflow-hidden rounded-xl border border-rose-100 bg-rose-50/80 text-rose-600">
                            <button
                              onClick={() => handleQuantityChange(item, -1)}
                              className="flex size-8 items-center justify-center transition-all hover:bg-rose-100"
                              aria-label={
                                item.qty <= 1 ? "Remove product" : "Decrease quantity"
                              }
                            >
                              <Minus size={12} strokeWidth={3} />
                            </button>
                            <span className="w-6 select-none text-center text-sm font-black text-rose-600">
                              {item.qty}
                            </span>
                            <button
                              onClick={() => handleQuantityChange(item, 1)}
                              className="flex size-8 items-center justify-center transition-all hover:bg-rose-100"
                              aria-label="Increase quantity"
                            >
                              <Plus size={12} strokeWidth={3} />
                            </button>
                          </div>

                          <div className="flex flex-wrap items-baseline justify-end gap-x-1.5 gap-y-0.5 leading-tight">
                            <p className="text-[13px] font-black text-emerald-600 sm:text-sm">
                              {formatIndianRupees(lineTotal)}
                            </p>
                            <p className="text-[11px] font-bold text-slate-400 line-through">
                              {formatIndianRupees(originalPrice)}
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="flex h-12 w-full items-center justify-center gap-2 border-t border-slate-100 bg-slate-50/70 px-4 text-sm font-black text-slate-950 transition-all hover:bg-white"
                >
                  Forgot something?
                  <span className="text-rose-600">Add More Items</span>
                </button>
              </section>

              {/* Delivery Speed Selection */}
              <div className="bg-white border border-slate-200 rounded-[24px] shadow-sm p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
                  <Clock size={16} className="text-slate-800" />
                  Delivery Speed
                </h3>
                <p className="text-[11px] text-slate-450 mb-4">Choose how fast you want your items to arrive</p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Standard Delivery Card */}
                  <button
                    type="button"
                    onClick={() => setDeliverySpeed("standard")}
                    className={`flex items-start gap-4 p-4 rounded-2xl border text-left transition-all hover:bg-slate-50 cursor-pointer ${
                      deliverySpeed === "standard"
                        ? "border-black bg-slate-50/40 ring-1 ring-black shadow-sm"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className={`p-2.5 rounded-xl ${deliverySpeed === "standard" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                      <Bike size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900">Standard Delivery</p>
                      <p className="text-[11px] text-slate-400 mt-1">20 - 30 min arrival estimate</p>
                      <p className="text-xs font-bold text-slate-900 mt-2">FREE</p>
                    </div>
                  </button>

                  {/* Priority Delivery Card */}
                  <button
                    type="button"
                    onClick={() => setDeliverySpeed("priority")}
                    className={`flex items-start gap-4 p-4 rounded-2xl border text-left transition-all hover:bg-slate-50 cursor-pointer ${
                      deliverySpeed === "priority"
                        ? "border-black bg-slate-50/40 ring-1 ring-black shadow-sm"
                        : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className={`p-2.5 rounded-xl ${deliverySpeed === "priority" ? "bg-slate-900 text-white" : "bg-slate-100 text-slate-500"}`}>
                      <Zap size={18} />
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                        Priority Delivery
                        <span className="bg-amber-100 text-amber-800 text-[9px] font-black px-1.5 py-0.5 rounded-md">FAST</span>
                      </p>
                      <p className="text-[11px] text-slate-400 mt-1">10 - 15 min lightning speed</p>
                      <p className="text-xs font-bold text-slate-900 mt-2">{formatIndianRupees(49)} delivery fee</p>
                    </div>
                  </button>
                </div>
              </div>

              {/* Delivery Address Selector */}
              <div className="bg-white border border-slate-200 rounded-[24px] shadow-sm p-6">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                    <MapPin size={16} className="text-slate-800" />
                    Delivery Address
                  </h3>
                  {addressError && (
                    <span className="text-[10px] text-rose-600 font-bold animate-pulse">
                      {addressError}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-450 mb-4">Select your delivery destination</p>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Home Option */}
                  <button
                    type="button"
                    onClick={() => setSelectedAddressId("home")}
                    className={`flex flex-col p-4 rounded-xl border text-left transition-all hover:bg-slate-50 cursor-pointer ${
                      selectedAddressId === "home" ? "border-black bg-slate-50/30 ring-1 ring-black" : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Home</span>
                    <span className="text-xs font-bold text-slate-900 mt-1 truncate">12 Main St</span>
                    <span className="text-[10px] text-slate-400 mt-0.5 truncate">Primary Address</span>
                  </button>

                  {/* Work Option */}
                  <button
                    type="button"
                    onClick={() => setSelectedAddressId("work")}
                    className={`flex flex-col p-4 rounded-xl border text-left transition-all hover:bg-slate-50 cursor-pointer ${
                      selectedAddressId === "work" ? "border-black bg-slate-50/30 ring-1 ring-black" : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className="text-[10px] font-bold text-slate-400 uppercase">Work</span>
                    <span className="text-xs font-bold text-slate-900 mt-1 truncate">45 Tech Park</span>
                    <span className="text-[10px] text-slate-400 mt-0.5 truncate">Tower B, Office Address</span>
                  </button>

                  {/* Custom Option */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAddressId("custom");
                      if (!customAddress) {
                        setCustomAddressInput("");
                      }
                    }}
                    className={`flex flex-col p-4 rounded-xl border text-left transition-all hover:bg-slate-50 cursor-pointer ${
                      selectedAddressId === "custom" ? "border-black bg-slate-50/30 ring-1 ring-black" : "border-slate-200 bg-white"
                    }`}
                  >
                    <span className="text-[10px] font-bold text-slate-400 uppercase flex items-center justify-between">
                      Custom
                      {customAddress && <Check size={10} className="text-slate-800" />}
                    </span>
                    <span className="text-xs font-bold text-slate-900 mt-1 truncate">
                      {customAddress || "Set Address"}
                    </span>
                    <span className="text-[10px] text-slate-400 mt-0.5 truncate">
                      {customAddress ? "Click edit below" : "Enter a new address"}
                    </span>
                  </button>
                </div>

                {/* Inline Editing for Custom Address */}
                {selectedAddressId === "custom" && (
                  <div className="mt-4 p-4 bg-slate-50 rounded-2xl border border-slate-250/70 animate-scale-up">
                    <label className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                      Enter Delivery Address Details
                    </label>
                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={customAddressInput}
                        onChange={(e) => setCustomAddressInput(e.target.value)}
                        placeholder="e.g. Apartment 4B, Green Meadows Road"
                        className="flex-1 text-xs font-semibold px-3 py-2.5 bg-white border border-slate-300 rounded-xl outline-none focus:border-black transition-all"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (customAddressInput.trim()) {
                            setCustomAddress(customAddressInput.trim());
                            setAddressError(null);
                          }
                        }}
                        className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-xs font-bold transition-all"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>

            </div>

            {/* Right Column: Checkout Billing & Promo */}
            <div className="w-full max-w-[calc(100vw-24px)] min-w-0 space-y-6 sm:max-w-none lg:col-span-4">
              
              {/* Promo Code Form */}
              <div className="bg-white border border-slate-200 rounded-[24px] shadow-sm p-6">
                <h3 className="text-sm font-bold text-slate-900 mb-1 flex items-center gap-2">
                  <Gift size={16} className="text-slate-800" />
                  Promo Code
                </h3>
                <p className="text-[11px] text-slate-450 mb-3">Apply coupons to unlock major discounts</p>

                <form onSubmit={handleApplyPromo} className="flex gap-2">
                  <input
                    type="text"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value)}
                    placeholder="Enter LOCAL5 or WELCOME10"
                    disabled={appliedPromo !== null}
                    className="flex-1 text-xs font-semibold px-3 py-2.5 bg-white border border-slate-350 rounded-xl outline-none focus:border-black transition-all disabled:opacity-50 disabled:bg-slate-50 uppercase placeholder:normal-case"
                  />
                  <button
                    type="submit"
                    disabled={appliedPromo !== null || !promoCode}
                    className="px-4 py-2.5 bg-slate-900 text-white rounded-xl text-xs font-bold hover:bg-slate-850 transition-all disabled:opacity-40 disabled:hover:bg-slate-900 cursor-pointer"
                  >
                    Apply
                  </button>
                </form>

                {promoError && (
                  <p className="text-[10px] text-rose-600 font-bold mt-2 flex items-center gap-1">
                    <X size={10} strokeWidth={2.5} />
                    {promoError}
                  </p>
                )}

                {appliedPromo && (
                  <div className="mt-3 flex items-center justify-between p-2 px-3 bg-emerald-50 text-emerald-800 border border-emerald-200 rounded-xl text-xs font-bold animate-scale-up">
                    <span className="flex items-center gap-1.5">
                      <Tag size={13} className="text-emerald-600" />
                      Code applied: {appliedPromo.code} ({appliedPromo.discountPercent}% OFF)
                    </span>
                    <button
                      type="button"
                      onClick={handleRemovePromo}
                      className="p-1 hover:bg-emerald-100 rounded-full text-emerald-800 transition-all"
                      title="Remove promo"
                    >
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  </div>
                )}

                <div className="mt-4 pt-3 border-t border-slate-100 space-y-1">
                  <p className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Available Coupons</p>
                  <div className="flex flex-col gap-1.5 mt-1.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-650 bg-slate-50 border border-slate-150 rounded-lg p-1.5 px-2">
                      <span className="font-bold flex items-center gap-1">
                        <Percent size={11} className="text-slate-500" /> WELCOME10
                      </span>
                      <span className="text-[10px] font-bold">10% discount</span>
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-650 bg-slate-50 border border-slate-150 rounded-lg p-1.5 px-2">
                      <span className="font-bold flex items-center gap-1">
                        <Percent size={11} className="text-slate-500" /> LOCAL5
                      </span>
                      <span className="text-[10px] font-bold">5% discount</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Order Summary & Billing */}
              <div className="bg-white border border-slate-200 rounded-[24px] shadow-sm p-6 space-y-4">
                <h3 className="text-sm font-bold text-slate-900 border-b border-slate-100 pb-3 flex items-center gap-2">
                  <CreditCard size={16} className="text-slate-800" />
                  Bill Details
                </h3>

                <div className="space-y-2 text-xs">
                  {/* Subtotal */}
                  <div className="flex items-center justify-between text-slate-550">
                    <span>Basket Subtotal</span>
                    <span className="text-slate-900 font-bold">{formatIndianRupees(subtotal)}</span>
                  </div>

                  {/* Promo Discount */}
                  {appliedPromo && (
                    <div className="flex items-center justify-between text-emerald-600 font-semibold">
                      <span>Promo Discount ({appliedPromo.code})</span>
                      <span>-{formatIndianRupees(discount)}</span>
                    </div>
                  )}

                  {/* Delivery Speed Fee */}
                  <div className="flex items-center justify-between text-slate-550">
                    <span>Delivery Option Fee</span>
                    <span className="text-slate-900 font-semibold">
                      {deliveryFee === 0 ? "FREE" : formatIndianRupees(deliveryFee)}
                    </span>
                  </div>

                  {/* Taxes */}
                  <div className="flex items-center justify-between text-slate-550">
                    <span>Est. Taxes (GST 18%)</span>
                    <span className="text-slate-900 font-bold">{formatIndianRupees(tax)}</span>
                  </div>

                  {/* Divider */}
                  <div className="border-t border-slate-100 my-3" />

                  {/* Grand Total */}
                  <div className="flex items-center justify-between text-sm font-bold">
                    <span className="text-slate-900 font-black">To Pay</span>
                    <span className="text-slate-950 font-black text-base">{formatIndianRupees(grandTotal)}</span>
                  </div>
                </div>

                {/* Place Order Button */}
                <button
                  onClick={handlePlaceOrder}
                  disabled={checkoutStep !== "idle" || cartItems.length === 0 || addressError !== null}
                  className="w-full flex h-12 items-center justify-center rounded-xl bg-slate-950 text-xs font-bold text-white shadow-md hover:bg-slate-850 hover:-translate-y-0.5 transition-all duration-200 disabled:opacity-40 disabled:hover:translate-y-0 disabled:bg-slate-950 cursor-pointer"
                >
                  {checkoutStep === "idle" ? (
                    <span className="flex items-center gap-1.5 justify-center">
                      Place Order • {formatIndianRupees(grandTotal)}
                      <ArrowRight size={13} strokeWidth={2.5} />
                    </span>
                  ) : (
                    <span className="flex items-center gap-2 justify-center">
                      <Loader2 className="size-4 animate-spin text-white" />
                      {getLoaderText()}
                    </span>
                  )}
                </button>

                {/* Additional Trust Indicators */}
                <div className="pt-3 border-t border-slate-100 flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase">
                    <ShieldCheck size={13} className="text-slate-400" />
                    <span>SSL Secure Checkout Guarantee</span>
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-slate-400 font-bold uppercase">
                    <Clock size={13} className="text-slate-400" />
                    <span>On-time delivery or cash back promise</span>
                  </div>
                </div>
              </div>

            </div>
          </div>
        )}

      </div>

      {/* Celebratory Checkout Success Modal */}
      {checkoutStep === "success" && placedOrderDetails && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
          
          {/* Backdrop Blur */}
          <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md animate-fade-in" />
          
          {/* Modal Container */}
          <div className="relative z-10 w-full max-w-lg bg-white rounded-[32px] border border-slate-100 p-8 shadow-2xl overflow-hidden animate-scale-up max-h-[90vh] overflow-y-auto scrollbar-hide">
            
            {/* Celebration Visuals */}
            <div className="text-center pb-6">
              <span className="relative flex size-14 items-center justify-center rounded-full bg-emerald-50 text-emerald-600 mx-auto mb-4 border border-emerald-100">
                <Check size={26} strokeWidth={3} className="animate-scale-up" />
                <span className="absolute -inset-1 rounded-full border border-emerald-400/30 animate-ping" />
              </span>
              <h2 className="text-xl font-black text-slate-900 tracking-tight">Order Placed Successfully!</h2>
              <p className="text-xs text-slate-450 mt-1">Thank you for ordering on Namastore</p>
              
              <div className="mt-3.5 inline-flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-full px-3.5 py-1 text-[11px] font-bold text-slate-650">
                ID: <span className="text-slate-900">{placedOrderDetails.orderId}</span>
              </div>
            </div>

            {/* Logistics Tracking Simulation */}
            <div className="border-y border-slate-100 py-6 my-2 space-y-4">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest mb-4">Live Tracking</p>
              
              <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-[2px] before:bg-slate-100">
                
                {/* Stepper item 1: Order Confirmed */}
                <div className="relative flex gap-3.5 items-start">
                  <span className="absolute -left-[22px] flex size-4 items-center justify-center rounded-full bg-emerald-500 text-white ring-4 ring-white">
                    <Check size={9} strokeWidth={3.5} />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-slate-900">Order Confirmed</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">Booking allocated and sent to sellers</p>
                  </div>
                </div>

                {/* Stepper item 2: Preparing */}
                <div className="relative flex gap-3.5 items-start">
                  <span className="absolute -left-[22px] flex size-4 items-center justify-center rounded-full bg-slate-950 text-white ring-4 ring-white">
                    <Loader2 size={9} className="animate-spin" />
                  </span>
                  <div>
                    <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      Preparing Basket
                      <span className="bg-amber-100 text-amber-800 text-[8px] font-bold px-1 py-0.2 rounded-md">LIVE</span>
                    </p>
                    <p className="text-[10px] text-slate-450 mt-0.5">Sellers are wrapping items at store</p>
                  </div>
                </div>

                {/* Stepper item 3: Out for Delivery */}
                <div className="relative flex gap-3.5 items-start">
                  <span className="absolute -left-[22px] flex size-4 items-center justify-center rounded-full bg-slate-100 text-slate-300 ring-4 ring-white border border-slate-200">
                    •
                  </span>
                  <div>
                    <p className="text-xs font-bold text-slate-400">Out for Delivery</p>
                    <p className="text-[10px] text-slate-350 mt-0.5">Courier delivery agent picks up cargo</p>
                  </div>
                </div>

              </div>

              {/* Delivery Details Details */}
              <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 mt-6 space-y-2.5">
                <div className="flex justify-between items-start gap-4">
                  <div className="min-w-0">
                    <p className="text-[9px] font-bold text-slate-400 uppercase">Delivery Location</p>
                    <p className="text-xs font-semibold text-slate-800 mt-0.5 truncate">{placedOrderDetails.address}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-[9px] font-bold text-slate-400 uppercase">Logistics Speed</p>
                    <p className="text-xs font-bold text-slate-850 mt-0.5">{placedOrderDetails.speed}</p>
                  </div>
                </div>

                <div className="border-t border-slate-200/60 pt-2.5 flex justify-between items-center text-xs font-bold text-slate-700">
                  <span className="flex items-center gap-1">
                    <Clock size={13} className="text-slate-400" />
                    Est. Delivery Time:
                  </span>
                  <span className="text-slate-950 font-black">
                    {placedOrderDetails.speed.includes("Priority") ? "10 - 15 minutes" : "20 - 30 minutes"}
                  </span>
                </div>
              </div>
            </div>

            {/* Order Items & Receipt Summary */}
            <div className="py-4 space-y-3">
              <p className="text-[9px] font-black text-slate-400 uppercase tracking-widest">Receipt Summary</p>
              
              <div className="max-h-28 overflow-y-auto scrollbar-hide divide-y divide-slate-100 pr-1">
                {placedOrderDetails.items.map((item) => (
                  <div key={item.id} className="py-2 flex items-center justify-between text-xs font-semibold">
                    <span className="text-slate-650 truncate max-w-[280px]">
                      {item.qty}x {item.name}{item.unitDisplay ? ` ${item.unitDisplay}` : ""}
                    </span>
                    <span className="text-slate-900">{formatIndianRupees(item.price * item.qty)}</span>
                  </div>
                ))}
              </div>

              <div className="border-t border-slate-100 pt-3 flex justify-between items-center font-bold text-xs">
                <span className="text-slate-900 font-extrabold">Amount Paid</span>
                <span className="text-slate-950 font-black text-sm">{formatIndianRupees(placedOrderDetails.grandTotal)}</span>
              </div>
            </div>

            {/* Checkout Action Button */}
            <button
              onClick={() => {
                setCheckoutStep("idle");
                router.push("/");
              }}
              className="w-full flex h-11 items-center justify-center rounded-xl bg-slate-950 hover:bg-slate-850 text-xs font-bold text-white transition-all shadow-md hover:-translate-y-0.5 mt-4 cursor-pointer"
            >
              Continue Shopping
            </button>

          </div>
        </div>
      )}

    </main>
  );
}
