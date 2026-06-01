"use client";

import React, { createContext, useContext, useEffect, useState } from "react";

export interface CartItem {
  id: string;
  variantId?: string;
  name: string;
  price: number;
  qty: number;
  shop: string;
  shopId: string;
  imageBg: string;
  imageInitials: string;
  imageUrl?: string;
  unit?: string;
  unitDisplay?: string;
  pricePerBaseUnitDisplay?: string;
}

interface CartContextType {
  cartItems: CartItem[];
  addToCart: (item: Omit<CartItem, "qty">) => void;
  removeFromCart: (id: string) => void;
  updateQty: (id: string, delta: number) => void;
  updateCartLines: (updates: Array<{ variantId: string; name?: string | null; price?: number; imageUrl?: string | null }>) => void;
  clearCart: () => void;
  cartSubtotal: number;
  cartItemCount: number;
  isCartReady: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);
const CART_STORAGE_KEY = "namastore_cart";
const starterCartItems: CartItem[] = [];
const demoCartNames = new Set(["Organic Hass Avocados", "Sourdough Bread (Country)"]);

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>(starterCartItems);
  const [isCartReady, setIsCartReady] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(CART_STORAGE_KEY);
    if (stored) {
      try {
        const parsedCart = JSON.parse(stored) as CartItem[];
        if (Array.isArray(parsedCart)) {
          const sanitized = parsedCart
            .filter(isRealCartItem)
            .map((item) => ({
              ...item,
              price: normalizedCartPrice(item.price),
              qty: Math.max(1, Math.floor(item.qty)),
              unit: item.unit ?? item.unitDisplay,
              unitDisplay: item.unitDisplay ?? item.unit
            }));
          setCartItems(sanitized);
          if (sanitized.length !== parsedCart.length) {
            localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(sanitized));
          }
        }
      } catch (error) {
        console.error("Error parsing cart from localStorage:", error);
        localStorage.removeItem(CART_STORAGE_KEY);
      }
    }
    setIsCartReady(true);
  }, []);

  useEffect(() => {
    if (isCartReady) {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cartItems));
    }
  }, [cartItems, isCartReady]);

  const addToCart = (newItem: Omit<CartItem, "qty">) => {
    if (!isRealCartItem({ ...newItem, qty: 1 })) {
      return;
    }
    setCartItems((prev) => {
      const key = cartLineKey(newItem);
      const existing = prev.find((item) => cartLineKey(item) === key);
      if (existing) {
        return prev.map((item) => (cartLineKey(item) === key ? { ...item, qty: item.qty + 1 } : item));
      }
      return [...prev, { ...newItem, qty: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCartItems((prev) => prev.filter((item) => cartLineKey(item) !== id && item.id !== id));
  };

  const updateQty = (id: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) =>
          cartLineKey(item) === id || item.id === id ? { ...item, qty: Math.max(0, item.qty + delta) } : item
        )
        .filter((item) => item.qty > 0)
    );
  };

  const updateCartLines: CartContextType["updateCartLines"] = (updates) => {
    const byVariant = new Map(updates.map((update) => [update.variantId, update]));
    setCartItems((prev) =>
      prev.map((item) => {
        const update = item.variantId ? byVariant.get(item.variantId) : undefined;
        if (!update) {
          return item;
        }
        return {
          ...item,
          imageUrl: update.imageUrl !== undefined ? update.imageUrl ?? undefined : item.imageUrl,
          name: update.name || item.name,
          price: update.price !== undefined ? normalizedCartPrice(update.price, item.price) : item.price
        };
      })
    );
  };

  const clearCart = () => {
    setCartItems([]);
  };

  const cartItemCount = cartItems.reduce((acc, item) => acc + item.qty, 0);
  const cartSubtotal = cartItems.reduce((acc, item) => acc + item.price * item.qty, 0);

  return (
    <CartContext.Provider
      value={{
        cartItems,
        addToCart,
        removeFromCart,
        updateQty,
        updateCartLines,
        clearCart,
        cartSubtotal,
        cartItemCount,
        isCartReady
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const context = useContext(CartContext);
  if (context === undefined) {
    throw new Error("useCart must be used within a CartProvider");
  }
  return context;
}

export function cartLineKey(item: Pick<CartItem, "id" | "variantId">) {
  return item.variantId ?? item.id;
}

function normalizedCartPrice(price: number, fallback = 0) {
  return Number.isFinite(price) && price >= 0 ? price : fallback;
}

function isRealCartItem(item: Partial<CartItem>): item is CartItem {
  return Boolean(
    item &&
    typeof item.id === "string" &&
    typeof item.variantId === "string" &&
    item.variantId.trim() &&
    typeof item.name === "string" &&
    !demoCartNames.has(item.name) &&
    typeof item.shopId === "string" &&
    item.shopId.trim() &&
    Number.isFinite(item.price) &&
    Number.isFinite(item.qty)
  );
}
