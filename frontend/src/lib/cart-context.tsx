"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

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
  clearCart: () => void;
  cartSubtotal: number;
  cartItemCount: number;
  isCartReady: boolean;
}

const CartContext = createContext<CartContextType | undefined>(undefined);

const catalogPricesInRupees: Record<string, number> = {
  p1: 199,
  p2: 120,
  p3: 75,
  p4: 90
};

const starterCartItems: CartItem[] = [
  {
    id: "p1",
    name: "Organic Hass Avocados",
    price: catalogPricesInRupees.p1,
    qty: 2,
    shop: "Fresh Veg Shop",
    shopId: "fresh-veg-shop",
    imageBg: "bg-emerald-50 text-emerald-800",
    imageInitials: "AV",
    imageUrl:
      "https://images.unsplash.com/photo-1523049673857-eb18f1d7b578?auto=format&fit=crop&w=160&q=80",
    unit: "Pack of 2",
    unitDisplay: "2 pcs Pack",
    pricePerBaseUnitDisplay: "₹99.50/pc"
  },
  {
    id: "p2",
    name: "Sourdough Bread (Country)",
    price: catalogPricesInRupees.p2,
    qty: 1,
    shop: "Daily Bakery",
    shopId: "daily-bakery",
    imageBg: "bg-amber-50 text-amber-800",
    imageInitials: "SD",
    imageUrl:
      "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=160&q=80",
    unit: "1 loaf",
    unitDisplay: "1 pc Unit",
    pricePerBaseUnitDisplay: "₹120/pc"
  }
];

export function CartProvider({ children }: { children: React.ReactNode }) {
  const [cartItems, setCartItems] = useState<CartItem[]>(starterCartItems);

  const [isCartReady, setIsCartReady] = useState(false);

  // Sync with localStorage on client-side
  useEffect(() => {
    const stored = localStorage.getItem("namastore_cart");
    if (stored) {
      try {
        const parsedCart = JSON.parse(stored) as CartItem[];

        if (Array.isArray(parsedCart)) {
          setCartItems(
            parsedCart.map((item) => {
              const starterItem = starterCartItems.find(
                (defaultItem) => defaultItem.id === item.id
              );

              return {
                ...item,
                price:
                  catalogPricesInRupees[item.id] ??
                  (item.price < 50 ? Math.round(item.price * 83) : item.price),
                imageUrl: item.imageUrl ?? starterItem?.imageUrl,
                unit: item.unit ?? item.unitDisplay ?? starterItem?.unit,
                unitDisplay: item.unitDisplay ?? item.unit ?? starterItem?.unitDisplay,
                pricePerBaseUnitDisplay: item.pricePerBaseUnitDisplay ?? starterItem?.pricePerBaseUnitDisplay
              };
            })
          );
        }
      } catch (e) {
        console.error("Error parsing cart from localStorage:", e);
      }
    }
    setIsCartReady(true);
  }, []);

  useEffect(() => {
    if (isCartReady) {
      localStorage.setItem("namastore_cart", JSON.stringify(cartItems));
    }
  }, [cartItems, isCartReady]);

  const addToCart = (newItem: Omit<CartItem, "qty">) => {
    setCartItems((prev) => {
      const existing = prev.find((item) => (item.variantId ?? item.id) === (newItem.variantId ?? newItem.id));
      if (existing) {
        return prev.map((item) =>
          (item.variantId ?? item.id) === (newItem.variantId ?? newItem.id) ? { ...item, qty: item.qty + 1 } : item
        );
      }
      return [...prev, { ...newItem, qty: 1 }];
    });
  };

  const removeFromCart = (id: string) => {
    setCartItems((prev) => prev.filter((item) => item.id !== id));
  };

  const updateQty = (id: string, delta: number) => {
    setCartItems((prev) =>
      prev
        .map((item) =>
          item.id === id ? { ...item, qty: Math.max(0, item.qty + delta) } : item
        )
        .filter((item) => item.qty > 0)
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
