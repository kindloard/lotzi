"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePosStore } from "@/features/pos/pos-store";
import { isAbortError } from "@/lib/abort";
import { apiFetch } from "@/lib/api";
import { fetchMerchantDashboardBootstrap } from "@/lib/merchant-dashboard-api";

interface PosCatalogItem {
  id: string;
  productId: string;
  variantId: string;
  name: string;
  variantName: string;
  sku: string | null;
  productSku: string | null;
  price: number;
  mrp: number | null;
  availableStock: number;
  unitDisplay: string;
  categoryId: string | null;
  categoryName: string | null;
  imageUrl: string | null;
  product: {
    id: string;
    name: string;
    sku: string | null;
    status: string;
    categoryId: string | null;
    imageUrl: string | null;
  };
}

interface PosCatalogResponse {
  apiVersion: "v1";
  source: "database";
  query: string;
  count: number;
  results: PosCatalogItem[];
}

export default function PosTerminalPage() {
  const [barcodeInput, setBarcodeInput] = useState("");
  const [storeId, setStoreId] = useState<string | null>(null);
  const [products, setProducts] = useState<PosCatalogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState("All");
  
  const { items, subtotal, addItem, updateQuantity, removeItem, clearCart } = usePosStore();
  const searchInputRef = useRef<HTMLInputElement>(null);

  const cartItems = Object.values(items);
  const taxRate = 0.08; // 8% tax
  const taxAmount = subtotal * taxRate;
  const grandTotal = subtotal + taxAmount;

  // Fetch Store ID on mount
  useEffect(() => {
    fetchMerchantDashboardBootstrap()
      .then((data) => {
        setStoreId(data.store.id);
      })
      .catch((err) => {
        console.error("Failed to fetch store:", err);
        setIsLoading(false);
      });
  }, []);

  // Fetch Catalog based on Store ID and Search Query
  useEffect(() => {
    if (!storeId) return;
    setIsLoading(true);
    const controller = new AbortController();
    
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ limit: "80" });
      const query = barcodeInput.trim();
      if (query) {
        params.set("q", query);
      }

      apiFetch<PosCatalogResponse>(
        `/v1/stores/${encodeURIComponent(storeId)}/pos/catalog?${params.toString()}`,
        { signal: controller.signal }
      )
        .then((data) => {
          setProducts(data.results);
          setIsLoading(false);
        })
        .catch((err) => {
          if (isAbortError(err)) {
            return;
          }
          console.error("Catalog search failed:", err);
          setIsLoading(false);
        });
    }, 300);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [storeId, barcodeInput]);

  const handleProductClick = (product: PosCatalogItem) => {
    addItem({
      productId: product.productId,
      variantId: product.variantId,
      name: product.name || "Unknown Product",
      unitPrice: product.price,
    });
    searchInputRef.current?.focus();
  };

  const handlePay = () => {
    if (cartItems.length === 0) return;
    window.print();
  };

  const categories = useMemo(
    () => ["All", ...Array.from(new Set(products.map((product) => product.categoryName).filter((category): category is string => Boolean(category))))],
    [products]
  );
  const visibleProducts = activeCategory === "All"
    ? products
    : products.filter((product) => product.categoryName === activeCategory);

  useEffect(() => {
    if (activeCategory !== "All" && !categories.includes(activeCategory)) {
      setActiveCategory("All");
    }
  }, [activeCategory, categories]);

  return (
    <>
      {/* --- PRODUCTION-GRADE BLACK & WHITE POS UI --- */}
      <div className="flex h-screen bg-white text-black overflow-hidden print:hidden font-sans selection:bg-neutral-200">
        
        {/* Left side: Catalog & Search */}
        <div className="flex flex-col flex-1 bg-neutral-50/50 relative border-r border-neutral-200">
          
          {/* Header */}
          <div className="px-10 py-8 bg-white flex items-center justify-between z-10 border-b border-neutral-200">
            <div>
              <h1 className="text-3xl font-bold text-black tracking-tight">Point of Sale</h1>
              <p className="text-sm text-neutral-500 mt-1 uppercase tracking-widest font-semibold">Store: {storeId?.substring(0, 8) || "..."}</p>
            </div>
            <div className="flex-1 max-w-lg mx-10 relative">
              <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                <svg className="h-5 w-5 text-neutral-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
              </div>
              <input 
                ref={searchInputRef}
                type="text" 
                placeholder="Scan barcode or search items..." 
                className="w-full pl-12 pr-4 py-4 bg-neutral-100 border border-transparent rounded-xl focus:outline-none focus:ring-1 focus:ring-black focus:border-black focus:bg-white transition-all text-black placeholder-neutral-400 font-medium"
                value={barcodeInput}
                onChange={e => setBarcodeInput(e.target.value)}
                autoFocus
              />
            </div>
            <div className="w-12 h-12 rounded-full bg-black flex items-center justify-center text-white font-bold tracking-wider text-sm shadow-sm">
              {storeId ? "ST" : "..."}
            </div>
          </div>

          {/* Categories Pill Menu */}
          <div className="px-10 py-5 flex gap-3 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {categories.map(cat => (
              <button 
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-6 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-all border ${
                  activeCategory === cat 
                    ? "bg-black text-white border-black" 
                    : "bg-white text-neutral-600 hover:bg-neutral-100 hover:text-black border-neutral-200 shadow-sm"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>

          {/* Product Grid */}
          <div className="flex-1 p-10 pt-6 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-6 overflow-y-auto pb-24 [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {visibleProducts.length === 0 && !isLoading ? (
              <div className="col-span-full h-full flex flex-col items-center justify-center text-neutral-400 mt-20">
                <div className="w-24 h-24 bg-neutral-100 rounded-full flex items-center justify-center mb-6">
                  <svg className="w-10 h-10 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                  </svg>
                </div>
                <p className="text-xl font-medium text-black">No products found</p>
                <p className="text-sm mt-2 text-neutral-500">Try scanning a different barcode or checking spelling.</p>
              </div>
            ) : (
              visibleProducts.map((p) => (
                <div 
                  key={p.id} 
                  onClick={() => handleProductClick(p)}
                  className="group bg-white rounded-2xl p-4 flex flex-col cursor-pointer border border-neutral-200 hover:border-black transition-all duration-200 shadow-sm hover:shadow-md"
                >
                  <div className="w-full aspect-square bg-neutral-100 rounded-xl mb-4 flex items-center justify-center overflow-hidden">
                    {p.imageUrl ? (
                      <img src={p.imageUrl} alt={p.name} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500 ease-out" />
                    ) : (
                      <svg className="w-12 h-12 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                      </svg>
                    )}
                  </div>
                  <div className="w-full text-left mt-auto">
                    <div className="text-sm font-medium text-black line-clamp-2 leading-snug">
                      {p.name}
                    </div>
                    <div className="mt-1.5 text-xs font-medium text-neutral-500 uppercase tracking-wide">{p.unitDisplay}</div>
                    <div className="flex justify-between items-center mt-4">
                      <div className="text-black font-bold text-lg tracking-tight">
                        ₹{p.price.toFixed(2)}
                      </div>
                      <div className="w-8 h-8 rounded-full border border-neutral-200 text-black flex items-center justify-center group-hover:bg-black group-hover:text-white group-hover:border-black transition-colors">
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right side: Cart & Checkout */}
        <div className="flex flex-col w-[420px] bg-white z-20">
          <div className="p-8 pb-6 flex justify-between items-end border-b border-neutral-200">
            <h2 className="text-2xl font-bold text-black tracking-tight">Order</h2>
            {cartItems.length > 0 && (
              <button 
                onClick={clearCart}
                className="text-xs font-bold text-black uppercase tracking-widest hover:text-neutral-500 transition-colors pb-1"
              >
                Clear
              </button>
            )}
          </div>
          
          <div className="flex-1 overflow-y-auto p-8 space-y-6 bg-white [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
            {cartItems.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-neutral-400">
                <div className="w-24 h-24 border border-neutral-200 rounded-full flex items-center justify-center mb-6">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-neutral-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M3 3h2l.4 2M7 13h10l4-8H5.4M7 13L5.4 5M7 13l-2.293 2.293c-.63.63-.184 1.707.707 1.707H17m0 0a2 2 0 100 4 2 2 0 000-4zm-8 2a2 2 0 11-4 0 2 2 0 014 0z" />
                  </svg>
                </div>
                <p className="font-medium text-black text-lg">Cart is empty</p>
                <p className="text-sm text-center px-4 mt-2 text-neutral-500">Scan items to add them to the current order.</p>
              </div>
            ) : (
              cartItems.map((item) => (
                <div key={item.variantId} className="flex flex-col">
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-medium text-sm text-black leading-snug pr-4">{item.name}</div>
                    <div className="font-bold text-black text-base tracking-tight">
                      ₹{(item.unitPrice * item.quantity).toFixed(2)}
                    </div>
                  </div>
                  <div className="flex justify-between items-center mt-2">
                    <div className="text-neutral-500 text-sm">₹{item.unitPrice.toFixed(2)}</div>
                    <div className="flex items-center border border-neutral-200 rounded-lg p-0.5 shadow-sm">
                      <button 
                        onClick={() => updateQuantity(item.variantId, item.quantity - 1)}
                        className="w-8 h-8 flex items-center justify-center rounded-md text-black hover:bg-neutral-100 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" /></svg>
                      </button>
                      <span className="w-10 text-center text-sm font-bold text-black">{item.quantity}</span>
                      <button 
                        onClick={() => updateQuantity(item.variantId, item.quantity + 1)}
                        className="w-8 h-8 flex items-center justify-center rounded-md text-black hover:bg-neutral-100 transition-colors"
                      >
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
                      </button>
                    </div>
                  </div>
                  <div className="w-full h-px bg-neutral-100 mt-6"></div>
                </div>
              ))
            )}
          </div>

          {/* Totals & Pay Button */}
          <div className="p-8 bg-neutral-50 border-t border-neutral-200">
            <div className="space-y-4 mb-8">
              <div className="flex justify-between text-neutral-600 text-sm">
                <span>Subtotal</span>
                <span className="font-medium text-black">₹{subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-neutral-600 text-sm">
                <span>Tax (8%)</span>
                <span className="font-medium text-black">₹{taxAmount.toFixed(2)}</span>
              </div>
              <div className="border-t border-neutral-200 my-4"></div>
              <div className="flex justify-between items-end">
                <span className="text-base font-medium text-black uppercase tracking-widest">Total</span>
                <span className="text-4xl font-black text-black tracking-tighter">
                  ₹{grandTotal.toFixed(2)}
                </span>
              </div>
            </div>
            
            <button 
              onClick={handlePay}
              disabled={cartItems.length === 0}
              className={`w-full py-5 rounded-xl font-bold text-lg tracking-wide transition-all duration-200 flex items-center justify-center gap-3 ${
                cartItems.length > 0 
                  ? 'bg-black text-white hover:bg-neutral-800 shadow-md' 
                  : 'bg-neutral-200 text-neutral-400 cursor-not-allowed'
              }`}
            >
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              Charge ₹{grandTotal.toFixed(2)}
            </button>
          </div>
        </div>
      </div>

      {/* --- PRINTABLE RECEIPT (Hidden on screen) --- */}
      <div className="hidden print:block text-black bg-white p-4 w-[80mm] mx-auto text-sm font-mono leading-tight">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold mb-1 uppercase">NAMASTORE</h1>
          <p className="text-xs text-neutral-500">STORE: {storeId?.substring(0, 8) || "GUEST"}</p>
          <p className="text-xs text-neutral-500">{new Date().toLocaleString()}</p>
        </div>

        <div className="border-t border-black border-dashed pt-4 mb-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-black border-dashed">
                <th className="text-left font-normal pb-2">ITEM</th>
                <th className="text-center font-normal pb-2">QTY</th>
                <th className="text-right font-normal pb-2">AMT</th>
              </tr>
            </thead>
            <tbody>
              {cartItems.map(item => (
                <tr key={item.variantId}>
                  <td className="py-2 pr-2">
                    <div className="truncate max-w-[40mm] font-semibold">{item.name}</div>
                    <div className="text-xs text-neutral-500">₹{item.unitPrice.toFixed(2)}</div>
                  </td>
                  <td className="py-2 text-center">{item.quantity}</td>
                  <td className="py-2 text-right">₹{(item.unitPrice * item.quantity).toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="border-t border-black border-dashed pt-4 space-y-2 mb-6">
          <div className="flex justify-between">
            <span>SUBTOTAL</span>
            <span>₹{subtotal.toFixed(2)}</span>
          </div>
          <div className="flex justify-between">
            <span>TAX (8%)</span>
            <span>₹{taxAmount.toFixed(2)}</span>
          </div>
          <div className="flex justify-between font-bold text-lg pt-2 border-t border-black">
            <span>TOTAL</span>
            <span>₹{grandTotal.toFixed(2)}</span>
          </div>
        </div>

        <div className="text-center text-xs text-neutral-500 space-y-1">
          <p>Thank you for shopping with us!</p>
          <p>Please come again</p>
          <div className="mt-4 pt-4 border-t border-neutral-300">
            <svg className="w-full h-12" preserveAspectRatio="none" viewBox="0 0 100 20">
               {Array.from({length: 40}).map((_, i) => (
                 <rect key={i} x={i * 2.5} y="0" width={Math.random() > 0.5 ? 1 : 1.5} height="20" fill="black" />
               ))}
            </svg>
            <p className="mt-1 tracking-widest">{Date.now().toString().slice(-10)}</p>
          </div>
        </div>
      </div>
    </>
  );
}
