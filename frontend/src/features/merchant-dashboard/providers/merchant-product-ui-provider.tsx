"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode
} from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import { createMerchantProduct, updateMerchantProduct } from "@/lib/upload-engine-api";
import { uid } from "../lib/dashboard-utils";
import type { Product, ProductDraft } from "../types/dashboard";
import { useMerchantIdentity } from "./merchant-identity-provider";
import { merchantProductsQueryKey, setProductsForStore } from "./merchant-products";

interface MerchantProductUiContextValue {
  archiveProduct: () => void;
  closeProductCreate: () => void;
  confirmProduct: Product | null;
  createProduct: (draft: ProductDraft, publish: boolean) => Promise<void>;
  duplicateProduct: (product: Product) => void;
  editProduct: (product: Product) => void;
  isCreatingProduct: boolean;
  openProductCreate: () => void;
  productCreateMode: { kind: "create" } | { kind: "edit"; product: Product };
  productCreateOpen: boolean;
  requestArchiveProduct: (product: Product) => void;
  resetArchiveProduct: () => void;
  restockProduct: (productId: string) => void;
}

const MerchantProductUiContext = createContext<MerchantProductUiContextValue | null>(null);

export function MerchantProductUiProvider({ children }: { children: ReactNode }) {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const queryClient = useQueryClient();
  const { storeId } = useMerchantIdentity();
  const [productCreateOpen, setProductCreateOpen] = useState(false);
  const [productCreateMode, setProductCreateMode] = useState<MerchantProductUiContextValue["productCreateMode"]>({ kind: "create" });
  const [confirmProduct, setConfirmProduct] = useState<Product | null>(null);

  const createProductMutation = useMutation({
    mutationFn: ({ draft, publish }: { draft: ProductDraft; publish: boolean }) => {
      if (!storeId) {
        throw new Error(t("productCreate.media.storeLoading"));
      }
      return createMerchantProduct(draft, storeId, publish);
    },
    onSuccess: (response, variables) => {
      setProductsForStore(queryClient, storeId, (current) => [response.product, ...current]);
      toast.success(variables.publish ? t("toasts.productPublished") : t("toasts.draftSaved"));
    }
  });

  const updateProductMutation = useMutation({
    mutationFn: ({ draft, product }: { draft: ProductDraft; product: Product }) => {
      if (!storeId) {
        throw new Error(t("productCreate.media.storeLoading"));
      }
      return updateMerchantProduct(product.id, draft, storeId, product);
    },
    onMutate: async ({ draft, product }) => {
      if (!storeId) {
        return { previous: undefined };
      }
      const queryKey = merchantProductsQueryKey(storeId);
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData<Product[]>(queryKey);
      setProductsForStore(queryClient, storeId, (current) =>
        current.map((item) => item.id === product.id ? optimisticProductFromDraft(item, draft) : item)
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (!storeId || !context?.previous) {
        return;
      }
      queryClient.setQueryData(merchantProductsQueryKey(storeId), context.previous);
    },
    onSuccess: (response) => {
      setProductsForStore(queryClient, storeId, (current) =>
        current.map((item) => item.id === response.product.id ? mergeProductPatch(item, response.product) : item)
      );
      toast.success(t("toasts.saved"));
    }
  });

  const createProduct = useCallback(
    async (draft: ProductDraft, publish: boolean) => {
      if (productCreateMode.kind === "edit") {
        await updateProductMutation.mutateAsync({ draft, product: productCreateMode.product });
        return;
      }
      await createProductMutation.mutateAsync({ draft, publish });
    },
    [createProductMutation, productCreateMode, updateProductMutation]
  );

  const openProductCreate = useCallback(() => {
    setProductCreateMode({ kind: "create" });
    setProductCreateOpen(true);
  }, []);

  const editProduct = useCallback((product: Product) => {
    setProductCreateMode({ kind: "edit", product });
    setProductCreateOpen(true);
  }, []);

  const closeProductCreate = useCallback(() => {
    setProductCreateOpen(false);
  }, []);

  const duplicateProduct = useCallback(
    (product: Product) => {
      if (!storeId) {
        return;
      }
      setProductsForStore(queryClient, storeId, (current) => [
        {
          ...product,
          id: uid(),
          name: t("products.duplicateName", { name: product.name }),
          sku: product.sku ? `${product.sku}-COPY` : "",
          status: "Draft",
          updatedAt: new Date().toISOString()
        },
        ...current
      ]);
      toast.success(t("toasts.productDuplicated"));
    },
    [queryClient, storeId, t, toast]
  );

  const archiveProduct = useCallback(() => {
    if (!storeId || !confirmProduct) {
      return;
    }
    setProductsForStore(queryClient, storeId, (current) => current.filter((item) => item.id !== confirmProduct.id));
    toast.success(t("toasts.productArchived"));
    setConfirmProduct(null);
  }, [confirmProduct, queryClient, storeId, t, toast]);

  const restockProduct = useCallback(
    (productId: string) => {
      if (!storeId) {
        return;
      }
      setProductsForStore(queryClient, storeId, (current) =>
        current.map((item) => (item.id === productId ? { ...item, stock: item.stock + 50 } : item))
      );
      toast.success(t("toasts.stockUpdated"));
    },
    [queryClient, storeId, t, toast]
  );

  const value = useMemo<MerchantProductUiContextValue>(
    () => ({
      archiveProduct,
      closeProductCreate,
      confirmProduct,
      createProduct,
      duplicateProduct,
      editProduct,
      isCreatingProduct: createProductMutation.isPending || updateProductMutation.isPending,
      openProductCreate,
      productCreateMode,
      productCreateOpen,
      requestArchiveProduct: setConfirmProduct,
      resetArchiveProduct: () => setConfirmProduct(null),
      restockProduct
    }),
    [
      archiveProduct,
      closeProductCreate,
      confirmProduct,
      createProduct,
      createProductMutation.isPending,
      duplicateProduct,
      editProduct,
      openProductCreate,
      productCreateMode,
      productCreateOpen,
      restockProduct,
      updateProductMutation.isPending
    ]
  );

  return <MerchantProductUiContext.Provider value={value}>{children}</MerchantProductUiContext.Provider>;
}

function optimisticProductFromDraft(product: Product, draft: ProductDraft): Product {
  return {
    ...product,
    name: draft.name,
    sku: draft.sku,
    category: draft.category,
    subCategory: draft.subCategory,
    productType: draft.productType,
    price: draft.price,
    compareAtPrice: draft.compareAtPrice,
    stock: draft.stock,
    reorderPoint: draft.reorderPoint,
    measurement: draft.measurement,
    status: draft.status,
    description: draft.description,
    seoTitle: draft.seoTitle,
    seoDescription: draft.seoDescription,
    catalogVersion: product.catalogVersion + 1,
    updatedAt: new Date().toISOString()
  };
}

function mergeProductPatch(product: Product, patch: Partial<Product> & Pick<Product, "id">): Product {
  return {
    ...product,
    ...patch,
    images: patch.images ?? product.images,
    variants: patch.variants ?? product.variants,
    sales: patch.sales ?? product.sales,
    revenue: patch.revenue ?? product.revenue,
    conversion: patch.conversion ?? product.conversion
  };
}

export function useMerchantProductUi() {
  const context = useContext(MerchantProductUiContext);
  if (!context) {
    throw new Error("useMerchantProductUi must be used within MerchantProductUiProvider.");
  }
  return context;
}
