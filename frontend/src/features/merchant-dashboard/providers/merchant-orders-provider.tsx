"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useReducer,
  type ReactNode
} from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import { initialOrders } from "../data/mock-dashboard-data";
import type { Order } from "../types/dashboard";

interface MerchantOrdersContextValue {
  closeOrder: () => void;
  markOrdersPacked: (ids: string[]) => void;
  moveOrdersToRefundReview: (ids: string[]) => void;
  openOrder: (order: Order) => void;
  orders: Order[];
  selectedOrder: Order | null;
  setOrders: (updater: (current: Order[]) => Order[]) => void;
}

interface OrdersState {
  orders: Order[];
  selectedOrder: Order | null;
}

type OrdersAction =
  | { type: "closeOrder" }
  | { type: "openOrder"; order: Order }
  | { type: "setOrders"; updater: (current: Order[]) => Order[] };

const MerchantOrdersContext = createContext<MerchantOrdersContextValue | null>(null);

function ordersReducer(state: OrdersState, action: OrdersAction): OrdersState {
  if (action.type === "openOrder") {
    return { ...state, selectedOrder: action.order };
  }
  if (action.type === "closeOrder") {
    return { ...state, selectedOrder: null };
  }
  const orders = action.updater(state.orders);
  const selectedOrder = state.selectedOrder
    ? orders.find((order) => order.id === state.selectedOrder?.id) ?? state.selectedOrder
    : null;
  return { orders, selectedOrder };
}

export function MerchantOrdersProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const [state, dispatch] = useReducer(ordersReducer, {
    orders: initialOrders,
    selectedOrder: null
  });

  const setOrders = useCallback((updater: (current: Order[]) => Order[]) => {
    dispatch({ type: "setOrders", updater });
  }, []);

  const markOrdersPacked = useCallback(
    (ids: string[]) => {
      if (!ids.length) {
        toast.warning(t("toasts.selectAtLeastOneOrder"));
        return;
      }
      setOrders((current) =>
        current.map((orderItem) =>
          ids.includes(orderItem.id) && ["New", "Processing"].includes(orderItem.status)
            ? { ...orderItem, status: "Packed" }
            : orderItem
        )
      );
      toast.success(t("toasts.ordersUpdated", { count: ids.length }));
    },
    [setOrders, t, toast]
  );

  const moveOrdersToRefundReview = useCallback(
    (ids: string[]) => {
      if (!ids.length) {
        toast.warning(t("toasts.selectOrdersFirst"));
        return;
      }
      setOrders((current) =>
        current.map((orderItem) =>
          ids.includes(orderItem.id) ? { ...orderItem, status: "Refund review" } : orderItem
        )
      );
      toast.success(t("toasts.ordersMovedToReview", { count: ids.length }));
    },
    [setOrders, t, toast]
  );

  const value = useMemo<MerchantOrdersContextValue>(
    () => ({
      closeOrder: () => dispatch({ type: "closeOrder" }),
      markOrdersPacked,
      moveOrdersToRefundReview,
      openOrder: (order) => dispatch({ type: "openOrder", order }),
      orders: state.orders,
      selectedOrder: state.selectedOrder,
      setOrders
    }),
    [markOrdersPacked, moveOrdersToRefundReview, setOrders, state.orders, state.selectedOrder]
  );

  return <MerchantOrdersContext.Provider value={value}>{children}</MerchantOrdersContext.Provider>;
}

export function useMerchantOrders() {
  const context = useContext(MerchantOrdersContext);
  if (!context) {
    throw new Error("useMerchantOrders must be used within MerchantOrdersProvider.");
  }
  return context;
}
