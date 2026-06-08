import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export interface PosCartItem {
  productId: string;
  variantId: string;
  name: string;
  unitPrice: number;
  quantity: number;
}

interface PosState {
  items: Record<string, PosCartItem>;
  addItem: (item: Omit<PosCartItem, 'quantity'>) => void;
  removeItem: (variantId: string) => void;
  updateQuantity: (variantId: string, quantity: number) => void;
  clearCart: () => void;
  subtotal: number;
}

export const usePosStore = create<PosState>()(
  persist(
    (set, get) => ({
      items: {},
      subtotal: 0,
      
      addItem: (newItem) => {
        set((state) => {
          const existingItem = state.items[newItem.variantId];
          const updatedItems = {
            ...state.items,
            [newItem.variantId]: {
              ...newItem,
              quantity: existingItem ? existingItem.quantity + 1 : 1,
            },
          };
          
          // Recalculate subtotal
          const subtotal = Object.values(updatedItems).reduce(
            (sum, item) => sum + item.unitPrice * item.quantity, 0
          );

          return { items: updatedItems, subtotal };
        });
      },
      
      removeItem: (variantId) => {
        set((state) => {
          const { [variantId]: removed, ...updatedItems } = state.items;
          const subtotal = Object.values(updatedItems).reduce(
            (sum, item) => sum + item.unitPrice * item.quantity, 0
          );
          return { items: updatedItems, subtotal };
        });
      },
      
      updateQuantity: (variantId, quantity) => {
        set((state) => {
          if (quantity <= 0) {
            const { [variantId]: removed, ...updatedItems } = state.items;
            const subtotal = Object.values(updatedItems).reduce(
              (sum, item) => sum + item.unitPrice * item.quantity, 0
            );
            return { items: updatedItems, subtotal };
          }

          const item = state.items[variantId];
          if (!item) return state;

          const updatedItems = {
            ...state.items,
            [variantId]: { ...item, quantity },
          };

          const subtotal = Object.values(updatedItems).reduce(
            (sum, item) => sum + item.unitPrice * item.quantity, 0
          );

          return { items: updatedItems, subtotal };
        });
      },

      clearCart: () => set({ items: {}, subtotal: 0 }),
    }),
    {
      name: 'pos-cart-storage', // unique name for localStorage/IndexedDB
      storage: createJSONStorage(() => localStorage), // Can be swapped to IndexedDB easily using idb-keyval
    }
  )
);
