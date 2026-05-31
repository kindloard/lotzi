"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import { fetchMerchantOrders, updateMerchantOrderStatuses } from "@/lib/merchant-dashboard-api";
import type { Order } from "../types/dashboard";
import { toDashboardOrder } from "../lib/order-mappers";
import { useMerchantIdentity } from "./merchant-identity-provider";

interface MerchantOrdersContextValue {
  closeOrder: () => void;
  markOrdersPacked: (ids: string[]) => void;
  moveOrdersToRefundReview: (ids: string[]) => void;
  openOrder: (order: Order) => void;
  orders: Order[];
  errorMessage: string | null;
  isLoading: boolean;
  isRefreshing: boolean;
  isUpdating: boolean;
  retry: () => void;
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
  const identity = useMerchantIdentity();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [state, dispatch] = useReducer(ordersReducer, {
    orders: [],
    selectedOrder: null
  });

  const query = useQuery({
    enabled: identity.isReady,
    queryKey: ["merchant", "orders", identity.storeId],
    queryFn: async ({ signal }) => {
      const response = await fetchMerchantOrders({ signal });
      return response.orders.map(toDashboardOrder);
    }
  });

  const mutation = useMutation({
    mutationFn: updateMerchantOrderStatuses,
    onSuccess: async (response) => {
      if (response.updated.length) {
        setOrders((current) => mergeOrders(current, response.updated.map(toDashboardOrder)));
      }
      await queryClient.invalidateQueries({ queryKey: ["merchant", "orders", identity.storeId] });
    }
  });

  useEffect(() => {
    if (!query.data) {
      return;
    }
    dispatch({ type: "setOrders", updater: () => query.data });
  }, [query.data]);

  const setOrders = useCallback((updater: (current: Order[]) => Order[]) => {
    dispatch({ type: "setOrders", updater });
  }, []);

  const markOrdersPacked = useCallback(
    (ids: string[]) => {
      if (!ids.length) {
        toast.warning(t("toasts.selectAtLeastOneOrder"));
        return;
      }
      void mutation.mutateAsync({ orderIds: ids, action: "MARK_PACKED" })
        .then((response) => {
          if (response.updatedCount > 0) {
            toast.success(t("toasts.ordersUpdated", { count: response.updatedCount }));
          }
          if (response.skipped.length > 0) {
            toast.warning(t("toasts.ordersSkipped", { count: response.skipped.length }));
          }
        })
        .catch((error) => {
          toast.error(errorMessage(error, t("toasts.ordersUpdateFailed")));
        });
    },
    [mutation, t, toast]
  );

  const moveOrdersToRefundReview = useCallback(
    (ids: string[]) => {
      if (!ids.length) {
        toast.warning(t("toasts.selectOrdersFirst"));
        return;
      }
      void mutation.mutateAsync({ orderIds: ids, action: "MOVE_TO_REFUND_REVIEW" })
        .then((response) => {
          if (response.updatedCount > 0) {
            toast.success(t("toasts.ordersMovedToReview", { count: response.updatedCount }));
          }
          if (response.skipped.length > 0) {
            toast.warning(t("toasts.ordersSkipped", { count: response.skipped.length }));
          }
        })
        .catch((error) => {
          toast.error(errorMessage(error, t("toasts.ordersUpdateFailed")));
        });
    },
    [mutation, t, toast]
  );

  const error = query.error ? errorMessage(query.error, t("toasts.ordersLoadFailed")) : null;
  const value = useMemo<MerchantOrdersContextValue>(
    () => ({
      closeOrder: () => dispatch({ type: "closeOrder" }),
      errorMessage: error,
      isLoading: identity.isReady && query.isLoading,
      isRefreshing: query.isFetching && !query.isLoading,
      isUpdating: mutation.isPending,
      markOrdersPacked,
      moveOrdersToRefundReview,
      openOrder: (order) => dispatch({ type: "openOrder", order }),
      orders: state.orders,
      retry: () => {
        void query.refetch();
      },
      selectedOrder: state.selectedOrder,
      setOrders
    }),
    [
      error,
      identity.isReady,
      markOrdersPacked,
      moveOrdersToRefundReview,
      mutation.isPending,
      query,
      setOrders,
      state.orders,
      state.selectedOrder
    ]
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

function mergeOrders(current: Order[], updates: Order[]) {
  const byId = new Map(updates.map((order) => [order.id, order]));
  return current.map((order) => byId.get(order.id) ?? order);
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return fallback;
}
