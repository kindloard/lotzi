"use client";

import React, { useEffect, useState } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useAuthSession } from "@/components/session-refresh-provider";
import { Skeleton, SkeletonSurface, SkeletonText } from "@/components/skeleton-engine";
import {
  ShoppingBag,
  Plus,
  Minus,
  Tag,
  Clock,
  CreditCard,
  X,
  Bike,
  Zap,
  Gift,
  Loader2,
  ArrowRight,
  Percent
} from "lucide-react";
import { createCheckoutSession } from "@/features/checkout/checkout-api";
import { loadCashfree } from "@/features/checkout/cashfree-sdk";
import {
  checkoutAddressRetryDelay,
  fetchCheckoutAddress
} from "@/features/customer-account/customer-account-api";
import { ApiError } from "@/lib/api";
import { useCart, CartItem, cartLineKey } from "@/lib/cart-context";
import { formatIndianRupees } from "@/lib/currency";

const SHOW_PROMO_CODE_SECTION = false;
const SHOW_BASKET_TIMING = false;
const SHOW_DELIVERY_SPEED_SECTION = false;
const CHECKOUT_SELECTED_ADDRESS_KEY = "ns:checkout:selected-address-id";
type AddressLookupState = "idle" | "loading" | "ready" | "error";

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
                    className="grid grid-cols-[48px_minmax(0,1fr)_auto] items-start gap-3 px-3 py-4 sm:grid-cols-[60px_minmax(0,1fr)_auto] sm:gap-4 sm:px-5"
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
  const tCart = useTranslations("cart");
  const { isSessionReady, session } = useAuthSession();
  const {
    cartItems,
    cartSubtotal,
    updateQty,
    removeFromCart,
    isCartReady
  } = useCart();

  // State
  const [promoCode, setPromoCode] = useState("");
  const [promoError, setPromoError] = useState<string | null>(null);
  const [appliedPromo, setAppliedPromo] = useState<{ code: string; discountPercent: number } | null>(null);
  const [deliverySpeed, setDeliverySpeed] = useState<"standard" | "priority">("standard");
  const [checkoutStep, setCheckoutStep] = useState<"idle" | "verifying" | "securing" | "processing">("idle");
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(null);
  const [isSelectedAddressLoaded, setIsSelectedAddressLoaded] = useState(false);
  const [checkoutAddress, setCheckoutAddress] = useState<{ id: string } | null>(null);
  const [addressLookupState, setAddressLookupState] = useState<AddressLookupState>("idle");
  const currentSessionId = session?.sessionId ?? null;

  // Pricing calculations
  const subtotal = cartSubtotal;
  const deliveryFee = deliverySpeed === "priority" ? 49 : 0;
  const discount = SHOW_PROMO_CODE_SECTION && appliedPromo ? (subtotal * appliedPromo.discountPercent) / 100 : 0;
  const grandTotal = Math.max(0, subtotal + deliveryFee - discount);
  const effectiveAddressId = checkoutAddress?.id ?? selectedAddressId;
  const isCheckingAddress = isSessionReady && Boolean(session) && (
    !isSelectedAddressLoaded || (!effectiveAddressId && (addressLookupState === "idle" || addressLookupState === "loading"))
  );
  const shouldSelectAddress = isSessionReady && (
    !session || addressLookupState === "error" || (addressLookupState === "ready" && !effectiveAddressId)
  );

  useEffect(() => {
    try {
      setSelectedAddressId(sessionStorage.getItem(CHECKOUT_SELECTED_ADDRESS_KEY));
    } catch {
      setSelectedAddressId(null);
    } finally {
      setIsSelectedAddressLoaded(true);
    }
  }, []);

  useEffect(() => {
    if (!isSessionReady || !isSelectedAddressLoaded) {
      return;
    }

    if (!currentSessionId) {
      setCheckoutAddress(null);
      setAddressLookupState("idle");
      return;
    }

    let isCurrent = true;
    let retryTimer: number | undefined;
    let retryCount = 0;
    setAddressLookupState("loading");

    const loadAddress = () => {
      void fetchCheckoutAddress({ selectedAddressId })
        .then((response) => {
          if (!isCurrent) {
            return;
          }
          setCheckoutAddress(response.address);
          setAddressLookupState("ready");

          if (response.cacheStatus && response.cacheStatus !== "HIT" && response.revalidateAfterMs !== null && retryCount < 6) {
            retryCount += 1;
            retryTimer = window.setTimeout(loadAddress, checkoutAddressRetryDelay(response));
          }

          try {
            if (response.address) {
              sessionStorage.setItem(CHECKOUT_SELECTED_ADDRESS_KEY, response.address.id);
            } else if (response.cacheStatus === "HIT") {
              sessionStorage.removeItem(CHECKOUT_SELECTED_ADDRESS_KEY);
              setSelectedAddressId(null);
            }
          } catch {
            if (!response.address && response.cacheStatus === "HIT") {
              setSelectedAddressId(null);
            }
          }
        })
        .catch(() => {
          if (!isCurrent) {
            return;
          }
          setCheckoutAddress(null);
          setAddressLookupState("error");
        });
    };

    loadAddress();

    return () => {
      isCurrent = false;
      window.clearTimeout(retryTimer);
    };
  }, [currentSessionId, isSelectedAddressLoaded, isSessionReady, selectedAddressId]);

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

  // Checkout handling
  const handlePlaceOrder = async () => {
    if (cartItems.length === 0) return;
    setCheckoutError(null);

    if (!isSessionReady) {
      setCheckoutError("Checking your session. Please try again in a moment.");
      return;
    }

    if (!session) {
      router.push(`/checkout/address?next=${encodeURIComponent("/cart")}`);
      return;
    }

    if (isCheckingAddress) {
      setCheckoutError("Checking your delivery address. Please try again in a moment.");
      return;
    }

    if (!effectiveAddressId) {
      router.push(`/checkout/address?next=${encodeURIComponent("/cart")}`);
      return;
    }

    const invalidItem = cartItems.find((item) => !item.variantId);
    if (invalidItem) {
      setCheckoutError("Refresh this product from the store page before checkout.");
      return;
    }

    setCheckoutStep("verifying");
    try {
      const session = await createCheckoutSession({
        items: cartItems.map((item) => ({
          productId: item.id,
          variantId: item.variantId!,
          quantity: item.qty
        })),
        shippingOption: deliverySpeed,
        couponCode: appliedPromo?.code,
        addressId: effectiveAddressId,
        idempotencyKey: crypto.randomUUID()
      });

      if (session.status === "UNKNOWN_GATEWAY" || !session.paymentSessionId) {
        router.push(`/checkout/status?orderId=${session.orderId}&paymentId=${session.paymentId}`);
        return;
      }

      setCheckoutStep("securing");
      const cashfree = await loadCashfree();
      setCheckoutStep("processing");
      await cashfree.checkout({
        paymentSessionId: session.paymentSessionId,
        redirectTarget: "_self"
      });
    } catch (error) {
      setCheckoutStep("idle");
      if (isApiErrorCode(error, "CHECKOUT_ADDRESS_REQUIRED")) {
        router.push(`/checkout/address?next=${encodeURIComponent("/cart")}`);
        return;
      }
      setCheckoutError(checkoutErrorMessage(error));
    }
  };

  // Loading text depending on animation stage
  const getLoaderText = () => {
    if (checkoutStep === "verifying") return "Validating server-side totals...";
    if (checkoutStep === "securing") return "Opening secure Cashfree checkout...";
    if (checkoutStep === "processing") return "Waiting for payment authorization...";
    return "Finalizing order...";
  };

  const handleQuantityChange = (item: CartItem, delta: number) => {
    if (delta < 0 && item.qty <= 1) {
      removeFromCart(cartLineKey(item));
      return;
    }

    updateQty(cartLineKey(item), delta);
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

        {cartItems.length === 0 ? (
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
              className="mt-6 inline-flex h-11 items-center justify-center px-6 rounded-xl bg-black text-xs font-bold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:opacity-90"
            >
              {tCart("browseProducts")}
            </Link>
          </div>
        ) : (
          /* Two Column Checkout Interface */
          <div className="grid min-w-0 grid-cols-1 items-start gap-8 lg:grid-cols-12">
            
            {/* Left Column: Items, Delivery, Address */}
            <div className="w-full max-w-[calc(100vw-24px)] min-w-0 space-y-6 sm:max-w-none lg:col-span-8">
              
              {/* Premium Product List */}
              <section className="w-full min-w-0 max-w-full overflow-hidden rounded-[24px] border border-slate-200 bg-white px-3 py-3 shadow-[0_18px_45px_rgba(15,23,42,0.07)] animate-scale-up sm:px-5 sm:py-5">
                {SHOW_BASKET_TIMING ? (
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

                </div>
                ) : null}

                <div className="divide-y divide-slate-100">
                  {cartItems.map((item) => {
                    const lineTotal = item.price * item.qty;

                    return (
                      <article
                        key={cartLineKey(item)}
                        className="grid grid-cols-[64px_minmax(0,1fr)_84px] items-start gap-4 px-1 py-5 transition-colors hover:bg-slate-50/55 sm:grid-cols-[72px_minmax(0,1fr)_92px] sm:gap-5 sm:px-2"
                      >
                        <span
                          className="relative flex size-16 shrink-0 select-none items-center justify-center overflow-hidden font-black text-sm sm:size-[72px]"
                          draggable={false}
                          onDragStart={(event) => event.preventDefault()}
                        >
                          {item.imageUrl ? (
                            <Image
                              alt=""
                              className="absolute inset-0 size-full object-contain"
                              draggable={false}
                              fill
                              loading="lazy"
                              onDragStart={(event) => event.preventDefault()}
                              sizes="72px"
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
                            {item.unitDisplay ?? item.unit ?? "1 pc"}
                          </p>

                          <p className="mt-3 text-sm font-black text-slate-950 sm:text-base">
                            {formatIndianRupees(lineTotal)}
                          </p>
                        </div>

                        <div className="flex min-w-0 justify-end">
                          <div className="flex h-8 items-center overflow-hidden rounded-xl border border-black bg-black text-white">
                            <button
                              onClick={() => handleQuantityChange(item, -1)}
                              className="flex size-8 items-center justify-center transition-all hover:bg-white/15"
                              aria-label={
                                item.qty <= 1 ? "Remove product" : "Decrease quantity"
                              }
                            >
                              <Minus size={12} strokeWidth={3} />
                            </button>
                            <span className="w-6 select-none text-center text-sm font-black text-white">
                              {item.qty}
                            </span>
                            <button
                              onClick={() => handleQuantityChange(item, 1)}
                              className="flex size-8 items-center justify-center transition-all hover:bg-white/15"
                              aria-label="Increase quantity"
                            >
                              <Plus size={12} strokeWidth={3} />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>

              </section>

              <button
                type="button"
                className="-mt-3 flex w-full items-center justify-center gap-2 px-4 text-sm font-medium text-slate-900 transition-colors hover:text-black"
              >
                Forgot something?
                <span className="text-black">Add More Items</span>
              </button>

              {/* Delivery Speed Selection */}
              {SHOW_DELIVERY_SPEED_SECTION ? (
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
                    <span className={`p-2.5 rounded-xl ${deliverySpeed === "standard" ? "bg-black text-white" : "bg-slate-100 text-slate-500"}`}>
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
                    <span className={`p-2.5 rounded-xl ${deliverySpeed === "priority" ? "bg-black text-white" : "bg-slate-100 text-slate-500"}`}>
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
              ) : null}

            </div>

            {/* Right Column: Checkout Billing & Promo */}
            <div className="w-full max-w-[calc(100vw-24px)] min-w-0 space-y-6 sm:max-w-none lg:col-span-4">
              {SHOW_PROMO_CODE_SECTION ? (
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
                    className="px-4 py-2.5 bg-black text-white rounded-xl text-xs font-bold transition-all hover:opacity-90 disabled:opacity-40 disabled:hover:opacity-40 cursor-pointer"
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
              ) : null}

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
                  {SHOW_PROMO_CODE_SECTION && appliedPromo && (
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

                  {/* Divider */}
                  <div className="my-4 border-t border-slate-200" />

                  {/* Grand Total */}
                  <div className="flex items-center justify-between text-sm font-bold">
                    <span className="text-slate-900 font-black">To Pay</span>
                    <span className="text-slate-950 font-black text-base">{formatIndianRupees(grandTotal)}</span>
                  </div>
                </div>

              </div>

              {/* Place Order Button */}
              <button
                onClick={handlePlaceOrder}
                disabled={checkoutStep !== "idle" || cartItems.length === 0 || !isSessionReady || isCheckingAddress}
                className="w-full flex h-12 items-center justify-center rounded-xl bg-black text-xs font-bold text-white shadow-md transition-all duration-200 hover:-translate-y-0.5 hover:opacity-90 disabled:opacity-40 disabled:hover:translate-y-0 disabled:hover:opacity-40 disabled:bg-black cursor-pointer"
              >
                {checkoutStep === "idle" ? (
                  <span className="flex items-center gap-1.5 justify-center">
                    {!isSessionReady ? "Checking account" : isCheckingAddress ? "Checking address" : shouldSelectAddress ? "Select address" : (
                      <>
                        Place Order &bull; {formatIndianRupees(grandTotal)}
                      </>
                    )}
                    <ArrowRight size={13} strokeWidth={2.5} />
                  </span>
                ) : (
                  <span className="flex items-center gap-2 justify-center">
                    <Loader2 className="size-4 animate-spin text-white" />
                    {getLoaderText()}
                  </span>
                )}
              </button>
              {checkoutError ? (
                <p className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700">
                  {checkoutError}
                </p>
              ) : null}

            </div>
          </div>
        )}

      </div>

    </main>
  );
}

function checkoutErrorMessage(error: unknown) {
  if (error instanceof ApiError) {
    const body = error.body as { code?: string; message?: string; retryAfterSeconds?: number } | undefined;
    if (body?.code === "CHECKOUT_ADDRESS_REQUIRED") {
      return "Select a delivery address before payment.";
    }
    if (body?.code === "CHECKOUT_OUT_OF_STOCK" || body?.code === "CHECKOUT_PRODUCT_UNAVAILABLE") {
      return "One or more items changed. Refresh the store page and try again.";
    }
    if (body?.code === "CASHFREE_NOT_CONFIGURED") {
      return "Payments are temporarily unavailable. Please try again later.";
    }
    return body?.message ?? error.message;
  }
  return error instanceof Error ? error.message : "Checkout failed. Please try again.";
}

function isApiErrorCode(error: unknown, code: string) {
  if (!(error instanceof ApiError)) {
    return false;
  }
  const body = error.body as { code?: unknown } | undefined;
  return body?.code === code;
}
