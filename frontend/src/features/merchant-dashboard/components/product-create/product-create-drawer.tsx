import {
  Archive,
  ChevronLeft,
  Database,
  Sparkles,
  X
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import { defaultDraft } from "../../data/mock-dashboard-data";
import { defaultSubcategoryForCategory, defaultTypeForSubcategory, typesForSubcategory } from "../../data/subcategories";
import { coerceMeasurementForProduct, defaultMeasurementForProduct } from "../../data/product-measurement";
import type { ProductDraft } from "../../types/dashboard";
import { cx, PRODUCT_DESCRIPTION_MAX_LENGTH, validateDraftStep } from "../../lib/dashboard-utils";
import { DashboardButton } from "../ui/dashboard-ui";
import {
  DetailsStep,
  InventoryStep,
  PreviewStep,
  PricingStep
} from "./product-create-steps";
import { ProductMediaManager } from "./product-media-manager";
import {
  ProductCreateDesktopProgress,
  ProductCreateMobileProgress,
  type ProductCreateStep
} from "./product-create-progress";
import styles from "../../styles/product-create-drawer.module.css";

const storageKey = "merchant-dashboard-product-draft";

export function ProductCreateDrawer({
  initialDraft,
  isSaving = false,
  mode = "create",
  onClose,
  onSave,
  storeId
}: {
  initialDraft?: ProductDraft;
  isSaving?: boolean;
  mode?: "create" | "edit";
  onClose: () => void;
  onSave: (draft: ProductDraft, publish: boolean) => Promise<void> | void;
  storeId: string;
}) {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const isEditMode = mode === "edit";
  const steps: ProductCreateStep[] = [
    { label: t("productCreate.steps.details"), description: t("productCreate.steps.detailsDescription") },
    { label: t("productCreate.steps.pricing"), description: t("productCreate.steps.pricingDescription") },
    { label: t("productCreate.steps.inventory"), description: t("productCreate.steps.inventoryDescription") },
    { label: t("productCreate.steps.media"), description: t("productCreate.steps.mediaDescription") },
    { label: t("productCreate.steps.preview"), description: t("productCreate.steps.previewDescription") }
  ];
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<ProductDraft>(() => (
    initialDraft ? withSubcategoryFallback(initialDraft) : loadStoredDraft()
  ));
  const [lastSaved, setLastSaved] = useState(t("productCreate.notSaved"));
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    if (isEditMode) {
      return;
    }
    const timer = window.setTimeout(() => {
      window.localStorage.setItem(storageKey, JSON.stringify(persistableDraft(draft)));
      setLastSaved(t("productCreate.autoSaved"));
    }, 600);
    return () => window.clearTimeout(timer);
  }, [draft, isEditMode, t]);

  const errors = validateDraftStep(draft, step);
  const saveBlocked = isSaving || isSubmitting;
  const canChangeStep = (targetStep: number) => {
    if (saveBlocked) {
      return false;
    }
    if (targetStep <= step) {
      return true;
    }
    for (let index = 0; index < targetStep; index += 1) {
      if (validateDraftStep(draft, index).length > 0) {
        return false;
      }
    }
    return true;
  };
  const dirtySteps = useMemo(
    () => (isEditMode && initialDraft ? dirtyValidationSteps(initialDraft, draft) : [0, 1, 2]),
    [draft, initialDraft, isEditMode]
  );
  const editHasChanges = useMemo(
    () => !isEditMode || !initialDraft || hasDraftChanged(initialDraft, draft),
    [draft, initialDraft, isEditMode]
  );
  const draftSaveErrors = useMemo(
    () => dirtySteps.flatMap((index) => validateDraftStep(draft, index)),
    [dirtySteps, draft]
  );
  const publishErrors = useMemo(
    () => [0, 1, 2, 3].flatMap((index) => validateDraftStep(draft, index)),
    [draft]
  );

  const publish = async (published: boolean) => {
    if (saveBlocked) {
      return;
    }
    const targetStatus = isEditMode ? draft.status : published ? "Published" : "Draft";
    const validationSteps = targetStatus === "Published" ? [0, 1, 2, 3] : dirtySteps;
    const allErrors = validationSteps.flatMap((index) => validateDraftStep(draft, index));
    if (allErrors.length) {
      toast.warning(t(`productCreate.validation.${allErrors[0]}` as never));
      setStep(Math.max(0, validationSteps.find((index) => validateDraftStep(draft, index).length > 0) ?? 0));
      return;
    }
    if (isEditMode && !editHasChanges) {
      return;
    }
    setIsSubmitting(true);
    try {
      await onSave(draft, published);
      if (!isEditMode) {
        window.localStorage.removeItem(storageKey);
      }
      onClose();
    } catch {
      toast.error(t("productCreate.saveFailed"));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={cx("fixed inset-0 z-50 bg-zinc-950/45 backdrop-blur-sm", styles.backdrop)}>
      <button
        aria-label={t("productCreate.closeBackdrop")}
        className="absolute inset-0 z-0 cursor-default"
        disabled={saveBlocked}
        onClick={onClose}
        type="button"
      />

      <section
        aria-label={isEditMode ? t("productCreate.editDrawerAria") : t("productCreate.drawerAria")}
        className={cx(
          "fixed inset-y-0 right-0 z-10 flex h-[100dvh] w-full max-w-[920px] flex-col overflow-hidden border-l border-zinc-200 bg-white shadow-2xl sm:w-[min(92vw,920px)]",
          styles.drawer
        )}
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-zinc-200 bg-white px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-600">
                <Database size={12} />
                {t("productCreate.productRecord")}
              </span>
              <span className="rounded-full bg-zinc-950 px-2.5 py-1 text-[11px] font-medium text-white">
                {t("productCreate.stepOf", { current: step + 1, total: steps.length })}
              </span>
            </div>
            <h2 className="text-xl font-semibold tracking-tight text-zinc-950">
              {isEditMode ? t("productCreate.editTitle") : t("productCreate.title")}
            </h2>
            <p className="mt-1 text-[12px] font-normal text-zinc-500">{lastSaved}</p>
          </div>
          <button
            aria-label={t("productCreate.closeDrawer")}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-white text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-950 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
            disabled={saveBlocked}
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          <ProductCreateDesktopProgress canChangeStep={canChangeStep} currentStep={step} onStepChange={setStep} steps={steps} />
          <section className="flex min-w-0 flex-1 flex-col overflow-x-hidden">
            <ProductCreateMobileProgress canChangeStep={canChangeStep} currentStep={step} onStepChange={setStep} steps={steps} />
            <div className={cx("min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-white p-5 sm:p-6", styles.hiddenScrollbar)}>
              {step === 0 && <DetailsStep draft={draft} setDraft={setDraft} />}
              {step === 1 && <PricingStep draft={draft} setDraft={setDraft} />}
              {step === 2 && <InventoryStep draft={draft} setDraft={setDraft} />}
              {step === 3 && <ProductMediaManager draft={draft} setDraft={setDraft} storeId={storeId} />}
              {step === 4 && <PreviewStep draft={draft} />}
            </div>

            <footer className="shrink-0 border-t border-zinc-200 bg-white px-5 py-4 sm:px-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className={cx("min-h-5 text-[12px] font-normal", errors[0] ? "text-amber-700" : "text-zinc-500")}>
                  {errors[0] ? t(`productCreate.validation.${errors[0]}` as never) : t("productCreate.validationGood")}
                </p>
                <div className="flex flex-wrap justify-end gap-2">
                  <DashboardButton
                    disabled={step === 0 || saveBlocked}
                    icon={ChevronLeft}
                    label={t("common.back")}
                    onClick={() => setStep(Math.max(0, step - 1))}
                    showLabelOnMobile
                    variant="secondary"
                  />
                  {step < steps.length - 1 ? (
                    <DashboardButton
                      disabled={errors.length > 0 || saveBlocked}
                      label={t("common.continue")}
                      onClick={() => {
                        if (errors.length) {
                          toast.warning(t(`productCreate.validation.${errors[0]}` as never));
                          return;
                        }
                        setStep(step + 1);
                      }}
                      showLabelOnMobile
                    />
                  ) : isEditMode ? (
                    <DashboardButton
                      disabled={saveBlocked || !editHasChanges || draftSaveErrors.length > 0}
                      icon={Sparkles}
                      label={t("productCreate.saveChanges")}
                      onClick={() => publish(false)}
                      showLabelOnMobile
                    />
                  ) : (
                    <>
                      <DashboardButton
                        disabled={saveBlocked || draftSaveErrors.length > 0}
                        icon={Archive}
                        label={t("productCreate.saveDraft")}
                        onClick={() => publish(false)}
                        showLabelOnMobile
                        variant="secondary"
                      />
                      <DashboardButton
                        disabled={saveBlocked || publishErrors.length > 0}
                        icon={Sparkles}
                        label={t("productCreate.publish")}
                        onClick={() => publish(true)}
                        showLabelOnMobile
                      />
                    </>
                  )}
                </div>
              </div>
            </footer>
          </section>
        </div>
      </section>
    </div>
  );
}

function loadStoredDraft() {
  if (typeof window === "undefined") {
    return defaultDraft;
  }

  try {
    const stored = window.localStorage.getItem(storageKey);
    return stored ? withSubcategoryFallback({ ...defaultDraft, ...(JSON.parse(stored) as ProductDraft) }) : defaultDraft;
  } catch {
    return defaultDraft;
  }
}

function withSubcategoryFallback(draft: ProductDraft): ProductDraft {
  const subCategory = draft.subCategory || defaultSubcategoryForCategory(draft.category);
  const typeOptions = typesForSubcategory(draft.category, subCategory);
  const productType = typeOptions.includes(draft.productType) ? draft.productType : defaultTypeForSubcategory(draft.category, subCategory);
  const context = { category: draft.category, subCategory, productType };
  const measurement = coerceMeasurementForProduct(draft.measurement ?? defaultMeasurementForProduct(context), context);
  return {
    ...draft,
    costPrice: draft.costPrice ?? 0,
    mediaScope: draft.mediaScope ?? "PRODUCT",
    sameImageAsProduct: draft.sameImageAsProduct ?? (draft.mediaScope ?? "PRODUCT") === "PRODUCT",
    seoDescription: draft.seoDescription.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH),
    subCategory,
    productType,
    measurement,
    images: (draft.images ?? []).map((image) => {
      if (image.imageScope) {
        return image;
      }
      return {
        ...image,
        imageScope: "PRODUCT",
        variantIds: [],
        variantSkuIds: []
      };
    }),
    variants: (Array.isArray(draft.variants) ? draft.variants : defaultDraft.variants).map((variant) => {
      const variantMeasurement = coerceMeasurementForProduct(variant.measurement ?? measurement, context);
      return {
        ...variant,
        manualPrice: variant.manualPrice ?? variant.price !== draft.price,
        manualPackSize: variant.manualPackSize ?? variantMeasurement.quantityValue !== measurement.quantityValue,
        manualUnit: variant.manualUnit ?? variantMeasurement.quantityUnit !== measurement.quantityUnit,
        manualPackType: variant.manualPackType ?? variantMeasurement.packType !== measurement.packType,
        mrp: variant.mrp ?? 0,
        costPrice: variant.costPrice ?? 0,
        measurement: variantMeasurement
      };
    })
  };
}

function persistableDraft(draft: ProductDraft): ProductDraft {
  return {
    ...draft,
    seoDescription: draft.seoDescription.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH),
    images: draft.images
      .filter((image) => image.uploadAssetId)
      .map((image, index) => ({
        ...image,
        sortOrder: index,
        upload: undefined
      }))
  };
}

function dirtyValidationSteps(original: ProductDraft, current: ProductDraft) {
  const dirty = new Set<number>();
  if (
    original.name !== current.name ||
    original.sku !== current.sku ||
    original.category !== current.category ||
    original.subCategory !== current.subCategory ||
    original.productType !== current.productType ||
    original.status !== current.status ||
    original.seoTitle !== current.seoTitle ||
    original.seoDescription !== current.seoDescription
  ) {
    dirty.add(0);
  }
  if (
    original.price !== current.price ||
    original.compareAtPrice !== current.compareAtPrice ||
    original.costPrice !== current.costPrice ||
    JSON.stringify(original.measurement) !== JSON.stringify(current.measurement) ||
    JSON.stringify(original.variants) !== JSON.stringify(current.variants)
  ) {
    dirty.add(1);
  }
  if (original.stock !== current.stock || original.reorderPoint !== current.reorderPoint) {
    dirty.add(2);
  }
  if (JSON.stringify(original.images) !== JSON.stringify(current.images)) {
    dirty.add(3);
  }
  return dirty.size ? Array.from(dirty) : [0];
}

function hasDraftChanged(original: ProductDraft, current: ProductDraft) {
  return JSON.stringify({
    name: original.name,
    sku: original.sku,
    category: original.category,
    subCategory: original.subCategory,
    productType: original.productType,
    price: original.price,
    compareAtPrice: original.compareAtPrice,
    costPrice: original.costPrice,
    stock: original.stock,
    reorderPoint: original.reorderPoint,
    measurement: original.measurement,
    status: original.status,
    seoTitle: original.seoTitle,
    seoDescription: original.seoDescription,
    images: original.images,
    variants: original.variants
  }) !== JSON.stringify({
    name: current.name,
    sku: current.sku,
    category: current.category,
    subCategory: current.subCategory,
    productType: current.productType,
    price: current.price,
    compareAtPrice: current.compareAtPrice,
    costPrice: current.costPrice,
    stock: current.stock,
    reorderPoint: current.reorderPoint,
    measurement: current.measurement,
    status: current.status,
    seoTitle: current.seoTitle,
    seoDescription: current.seoDescription,
    images: current.images,
    variants: current.variants
  });
}
