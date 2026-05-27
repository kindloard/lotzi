import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  ImagePlus,
  Plus,
  Trash2
} from "lucide-react";
import { useEffect } from "react";
import type { ChangeEvent, Dispatch, DragEvent, MutableRefObject, SetStateAction } from "react";
import { useTranslations } from "next-intl";
import type { MeasurementUnit, PackType, ProductDraft, ProductMeasurement, UnitGroup } from "../../types/dashboard";
import {
  coerceMeasurementForProduct,
  defaultMeasurementForProduct,
  formatUnitDisplay,
  getMeasurementPreset,
  isMeasurementAllowed,
  normalizeMeasurement,
  unitOptionsForGroup
} from "../../data/product-measurement";
import {
  defaultSubcategoryForCategory,
  defaultTypeForSubcategory,
  productCategories,
  subcategoriesForCategory,
  typesForSubcategory
} from "../../data/subcategories";
import { cx, isVisibleStockVariant, PRODUCT_DESCRIPTION_MAX_LENGTH, uid, updateVariant } from "../../lib/dashboard-utils";
import { useDashboardFormatters } from "../../lib/use-dashboard-formatters";
import {
  DashboardButton,
  FormField,
  FormGrid,
  IconButton,
  InlineInput,
  InlineNumber,
  NumberField,
  SectionHeading
} from "../ui/dashboard-ui";
import { SearchableSelect, type SearchableSelectOption } from "../ui/searchable-select";
import styles from "../../styles/product-create-drawer.module.css";

export function MediaStep({
  draft,
  fileInputRef,
  onAddFiles,
  setDraft
}: {
  draft: ProductDraft;
  fileInputRef: MutableRefObject<HTMLInputElement | null>;
  onAddFiles: (files: FileList | File[]) => void;
  setDraft: Dispatch<SetStateAction<ProductDraft>>;
}) {
  const t = useTranslations("dashboard");
  const moveImage = (imageId: string, direction: -1 | 1) => {
    setDraft((current) => {
      const index = current.images.findIndex((item) => item.id === imageId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.images.length) {
        return current;
      }
      const images = [...current.images];
      const [image] = images.splice(index, 1);
      images.splice(nextIndex, 0, image);
      return { ...current, images };
    });
  };

  return (
    <div className="space-y-6">
      <SectionHeading title={t("productCreate.sections.mediaTitle")} body={t("productCreate.sections.mediaBody")} />
      <button
        className="flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-6 text-center transition hover:border-zinc-400 hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
        onClick={() => fileInputRef.current?.click()}
        onDragOver={(event: DragEvent<HTMLButtonElement>) => event.preventDefault()}
        onDrop={(event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          onAddFiles(event.dataTransfer.files);
        }}
        type="button"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-zinc-800 shadow-sm">
          <ImagePlus size={22} />
        </span>
        <p className="mt-3 text-sm font-semibold text-zinc-950">{t("productCreate.media.dropImages")}</p>
        <p className="mt-1 text-xs font-normal text-zinc-500">{t("productCreate.media.fileRequirements", { count: 8 })}</p>
      </button>
      <input
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        multiple
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          if (event.target.files) {
            onAddFiles(event.target.files);
          }
          event.target.value = "";
        }}
        ref={fileInputRef}
        type="file"
      />

      {draft.images.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {draft.images.map((image, index) => (
            <div className="rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm" key={image.id}>
              <div
                aria-label={image.name}
                className="aspect-[4/3] rounded-xl border border-zinc-100 bg-zinc-100 bg-cover"
                role="img"
                style={{ backgroundImage: `url(${image.url})`, backgroundPosition: "center" }}
              />
              <div className="mt-3 flex items-center gap-2">
                <GripVertical className="shrink-0 text-zinc-400" size={14} />
                <p className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-900">{index === 0 ? t("productCreate.media.coverPrefix") : ""}{image.name}</p>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-1.5">
                <IconButton label={t("productCreate.media.moveLeft")} onClick={() => moveImage(image.id, -1)}>
                  <ArrowUp size={13} className="rotate-270" />
                </IconButton>
                <IconButton label={t("productCreate.media.moveRight")} onClick={() => moveImage(image.id, 1)}>
                  <ArrowDown size={13} className="rotate-270" />
                </IconButton>
                <IconButton label={t("productCreate.media.removeImage")} onClick={() => setDraft((current) => ({ ...current, images: current.images.filter((item) => item.id !== image.id) }))}>
                  <Trash2 size={13} />
                </IconButton>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DetailsStep({
  draft,
  setDraft
}: {
  draft: ProductDraft;
  setDraft: Dispatch<SetStateAction<ProductDraft>>;
}) {
  const t = useTranslations("dashboard");
  const subcategories = subcategoriesForCategory(draft.category);
  const activeSubCategory = subcategories.some((item) => item === draft.subCategory)
    ? draft.subCategory
    : defaultSubcategoryForCategory(draft.category);
  const productTypes = typesForSubcategory(draft.category, activeSubCategory);
  const activeProductType = productTypes.includes(draft.productType)
    ? draft.productType
    : defaultTypeForSubcategory(draft.category, activeSubCategory);
  const measurementPreset = getMeasurementPreset({
    category: draft.category,
    subCategory: activeSubCategory,
    productType: activeProductType
  });
  const activeMeasurementGroup = measurementPreset.allowedUnitGroups.includes(draft.measurement.unitGroup)
    ? draft.measurement.unitGroup
    : measurementPreset.defaultMeasurement.unitGroup;
  const description = draft.seoDescription.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH);
  const measurementCategoryOptions: SearchableSelectOption[] = measurementPreset.allowedUnitGroups.map((group) => {
    const unitSummary = unitSummaryForGroup(group, measurementPreset.allowedQuantityUnits, t);
    const categoryLabel = t(`productCreate.measurementCategories.${group}` as never);
    return {
      value: group,
      label: `${categoryLabel} (${unitSummary})`,
      searchText: `${group} ${categoryLabel} ${unitSummary}`
    };
  });
  const categoryOptions: SearchableSelectOption[] = productCategories.map((category) => ({
    value: category,
    label: category
  }));
  const subCategoryOptions: SearchableSelectOption[] = subcategories.map((subCategory) => ({
    value: subCategory,
    label: subCategory
  }));
  const productTypeOptions: SearchableSelectOption[] = productTypes.map((productType) => ({
    value: productType,
    label: productType
  }));
  const statusOptions: SearchableSelectOption[] = [
    { value: "Draft", label: t("status.draft") },
    { value: "Published", label: t("status.published") },
    { value: "Needs review", label: t("status.needsReview") }
  ];

  const updateCategory = (category: string) => {
    const subCategory = defaultSubcategoryForCategory(category);
    const productType = defaultTypeForSubcategory(category, subCategory);
    const measurement = defaultMeasurementForProduct({ category, subCategory, productType });
    setDraft((current) => ({
      ...current,
      category,
      subCategory,
      productType,
      measurement,
      variants: current.variants.map((variant, index) => {
        const fallbackName = t("productCreate.variantName", { index: index + 1 });
        return {
          ...variant,
          measurement,
          name: shouldSyncVariantName(variant.name, current.name, fallbackName, variant.measurement)
            ? variantNameFromProductName(current.name, fallbackName, measurement)
            : variant.name
        };
      })
    }));
  };

  const updateSubCategory = (subCategory: string) => {
    const productType = defaultTypeForSubcategory(draft.category, subCategory);
    const measurement = defaultMeasurementForProduct({ category: draft.category, subCategory, productType });
    setDraft((current) => ({
      ...current,
      subCategory,
      productType,
      measurement,
      variants: current.variants.map((variant, index) => {
        const fallbackName = t("productCreate.variantName", { index: index + 1 });
        return {
          ...variant,
          measurement,
          name: shouldSyncVariantName(variant.name, current.name, fallbackName, variant.measurement)
            ? variantNameFromProductName(current.name, fallbackName, measurement)
            : variant.name
        };
      })
    }));
  };

  const updateProductType = (productType: string) => {
    const measurement = defaultMeasurementForProduct({ category: draft.category, subCategory: activeSubCategory, productType });
    setDraft((current) => ({
      ...current,
      productType,
      measurement,
      variants: current.variants.map((variant, index) => {
        const fallbackName = t("productCreate.variantName", { index: index + 1 });
        return {
          ...variant,
          measurement,
          name: shouldSyncVariantName(variant.name, current.name, fallbackName, variant.measurement)
            ? variantNameFromProductName(current.name, fallbackName, measurement)
            : variant.name
        };
      })
    }));
  };

  const updateMeasurementCategory = (value: string) => {
    const unitGroup = value as UnitGroup;
    if (!measurementPreset.allowedUnitGroups.includes(unitGroup)) {
      return;
    }
    setDraft((current) => {
      const previousMeasurement = current.measurement;
      const quantityUnit = firstUnitForMeasurementGroup(measurementPreset, unitGroup);
      const measurement = {
        ...previousMeasurement,
        unitGroup,
        quantityUnit
      };
      return {
        ...current,
        measurement,
        variants: current.variants.map((variant, index) => {
          const fallbackName = t("productCreate.variantName", { index: index + 1 });
          const shouldSyncMeasurement = sameMeasurement(variant.measurement, previousMeasurement);
          const nextMeasurement = shouldSyncMeasurement ? measurement : variant.measurement;
          return {
            ...variant,
            measurement: nextMeasurement,
            name: shouldSyncVariantName(variant.name, current.name, fallbackName, variant.measurement)
              ? variantNameFromProductName(current.name, fallbackName, nextMeasurement)
              : variant.name
          };
        })
      };
    });
  };

  return (
    <div className="space-y-6">
      <SectionHeading title={t("productCreate.sections.detailsTitle")} body={t("productCreate.sections.detailsBody")} />
      <FormGrid>
        <FormField
          label={t("productCreate.fields.name")}
          value={draft.name}
          onChange={(value) => setDraft((current) => ({ ...current, name: value }))}
          placeholder={t("productCreate.placeholders.name")}
        />
        <FormField
          label={t("productCreate.fields.skuOptional")}
          value={draft.sku}
          onChange={(value) => {
            const sku = value.toUpperCase();
            setDraft((current) => ({
              ...current,
              sku,
              variants: current.variants.map((variant) => ({
                ...variant,
                sku: sku ? sku : ""
              }))
            }));
          }}
          placeholder={t("productCreate.placeholders.sku")}
        />
        <SearchableSelect
          emptyText={t("productCreate.searchableSelect.noResults")}
          label={t("productCreate.fields.category")}
          onChange={updateCategory}
          options={categoryOptions}
          searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
          value={draft.category}
        />
        <SearchableSelect
          emptyText={t("productCreate.searchableSelect.noResults")}
          label={t("productCreate.fields.subCategory")}
          onChange={updateSubCategory}
          options={subCategoryOptions}
          searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
          value={activeSubCategory}
        />
        <SearchableSelect
          emptyText={t("productCreate.searchableSelect.noResults")}
          label={t("productCreate.fields.productType")}
          onChange={updateProductType}
          options={productTypeOptions}
          searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
          value={activeProductType}
        />
        <SearchableSelect
          emptyText={t("productCreate.searchableSelect.noResults")}
          label={t("productCreate.fields.status")}
          onChange={(value) => setDraft((current) => ({ ...current, status: value as ProductDraft["status"] }))}
          options={statusOptions}
          searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
          value={draft.status}
        />
        <SearchableSelect
          className="md:col-span-2"
          emptyText={t("productCreate.searchableSelect.noResults")}
          label={t("productCreate.fields.measurementCategory")}
          onChange={updateMeasurementCategory}
          options={measurementCategoryOptions}
          searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
          value={activeMeasurementGroup}
        />
      </FormGrid>
      <div className="block">
        <label className="text-[13px] font-medium text-zinc-700" htmlFor="product-description">
          {t("productCreate.fields.description")}
        </label>
        <textarea
          id="product-description"
          className="mt-2 min-h-28 w-full resize-none rounded-xl border border-zinc-200 bg-white p-3 text-[13px] font-normal outline-none placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5"
          maxLength={PRODUCT_DESCRIPTION_MAX_LENGTH}
          onChange={(event) => setDraft((current) => ({
            ...current,
            seoDescription: event.target.value.slice(0, PRODUCT_DESCRIPTION_MAX_LENGTH)
          }))}
          placeholder={t("productCreate.placeholders.description")}
          value={description}
        />
        <div className="mt-1.5 flex justify-end">
          <span className="text-[11px] font-medium tabular-nums text-zinc-400">
            {t("productCreate.descriptionCounter.count", {
              limit: PRODUCT_DESCRIPTION_MAX_LENGTH,
              used: description.length
            })}
          </span>
        </div>
      </div>
    </div>
  );
}

export function PricingStep({
  draft,
  setDraft
}: {
  draft: ProductDraft;
  setDraft: Dispatch<SetStateAction<ProductDraft>>;
}) {
  const t = useTranslations("dashboard");
  const productSku = draft.sku.trim().toUpperCase();
  const preset = getMeasurementPreset(draft);
  const priceError = draft.price <= 0 ? t("productCreate.validation.priceRequired") : undefined;
  const compareAtPriceError =
    draft.compareAtPrice > 0 && draft.price > 0 && draft.compareAtPrice <= draft.price
      ? t("productCreate.validation.compareAtPriceAbovePrice")
      : undefined;
  const measurementUnitOptions: SearchableSelectOption[] = preset.allowedQuantityUnits
    .filter((unit) => unitOptionsForGroup(draft.measurement.unitGroup).includes(unit))
    .map((unit) => ({
      value: unit,
      label: t(`productCreate.units.${unit}` as never),
      searchText: unit
    }));
  const packTypeOptions: SearchableSelectOption[] = preset.allowedPackTypes.map((packType) => ({
    value: packType,
    label: t(`productCreate.packTypes.${packType}` as never),
    searchText: packType
  }));
  const updateProductPrice = (value: number) => {
    setDraft((current) => ({
      ...current,
      price: value,
      variants: current.variants.map((variant) =>
        variant.manualPrice ? variant : { ...variant, price: value }
      )
    }));
  };
  const updateProductPackSize = (value: number) => {
    setDraft((current) => {
      const measurement = patchMeasurement(current.measurement, { quantityValue: value }, current);
      return {
        ...current,
        measurement,
        variants: current.variants.map((variant) => ({
          ...variant,
          measurement: variant.manualPackSize
            ? variant.measurement
            : patchMeasurement(variant.measurement, { quantityValue: value }, current)
        }))
      };
    });
  };
  const updateProductMeasurementUnit = (value: string) => {
    const quantityUnit = value as MeasurementUnit;
    setDraft((current) => {
      const previousMeasurement = current.measurement;
      const measurement = patchMeasurement(previousMeasurement, { quantityUnit }, current);
      return {
        ...current,
        measurement,
        variants: current.variants.map((variant, index) => {
          const fallbackName = t("productCreate.variantName", { index: index + 1 });
          const nextMeasurement = variant.manualUnit
            ? variant.measurement
            : patchMeasurement(variant.measurement, { quantityUnit }, current);
          return {
            ...variant,
            measurement: nextMeasurement,
            name: shouldSyncVariantName(variant.name, current.name, fallbackName, variant.measurement)
              ? variantNameFromProductName(current.name, fallbackName, nextMeasurement)
              : variant.name
          };
        })
      };
    });
  };
  const updateProductPackType = (value: string) => {
    const packType = value as PackType;
    setDraft((current) => {
      const previousMeasurement = current.measurement;
      const measurement = patchMeasurement(previousMeasurement, { packType }, current);
      return {
        ...current,
        measurement,
        variants: current.variants.map((variant, index) => {
          const fallbackName = t("productCreate.variantName", { index: index + 1 });
          const nextMeasurement = variant.manualPackType
            ? variant.measurement
            : patchMeasurement(variant.measurement, { packType }, current);
          return {
            ...variant,
            measurement: nextMeasurement,
            name: shouldSyncVariantName(variant.name, current.name, fallbackName, variant.measurement)
              ? variantNameFromProductName(current.name, fallbackName, nextMeasurement)
              : variant.name
          };
        })
      };
    });
  };
  useEffect(() => {
    setDraft((current) => {
      const sku = current.sku.trim().toUpperCase();
      let changed = false;
      const variants = current.variants.map((variant) => {
        if (variant.sku === sku || (!sku && !variant.sku)) {
          return variant;
        }
        changed = true;
        return { ...variant, sku };
      });
      return changed ? { ...current, variants } : current;
    });
  }, [setDraft]);
  useEffect(() => {
    setDraft((current) => {
      let changed = false;
      const variants = current.variants.map((variant) => {
        let measurement = variant.measurement;
        if (
          !variant.manualPackSize &&
          measurement.quantityValue !== current.measurement.quantityValue
        ) {
          measurement = patchMeasurement(measurement, { quantityValue: current.measurement.quantityValue }, current);
        }
        if (
          !variant.manualUnit &&
          measurement.quantityUnit !== current.measurement.quantityUnit
        ) {
          measurement = patchMeasurement(measurement, { quantityUnit: current.measurement.quantityUnit }, current);
        }
        if (
          !variant.manualPackType &&
          measurement.packType !== current.measurement.packType
        ) {
          measurement = patchMeasurement(measurement, { packType: current.measurement.packType }, current);
        }
        if (sameMeasurement(measurement, variant.measurement)) {
          return variant;
        }
        changed = true;
        return { ...variant, measurement };
      });
      return changed ? { ...current, variants } : current;
    });
  }, [draft.measurement.packType, draft.measurement.quantityUnit, draft.measurement.quantityValue, setDraft]);

  return (
    <div className="space-y-6">
      <SectionHeading title={t("productCreate.sections.pricingTitle")} body={t("productCreate.sections.pricingBody")} />
      <div className={styles.pricingGrid}>
        <NumberField
          error={priceError}
          label={t("productCreate.fields.price")}
          value={draft.price}
          onChange={updateProductPrice}
        />
        <NumberField
          error={draft.measurement.quantityValue <= 0 ? t("productCreate.validation.quantityInvalid") : undefined}
          label={t("productCreate.fields.packSize")}
          value={draft.measurement.quantityValue}
          onChange={updateProductPackSize}
        />
        <SearchableSelect
          emptyText={t("productCreate.searchableSelect.noResults")}
          label={t("productCreate.fields.unit")}
          onChange={updateProductMeasurementUnit}
          options={measurementUnitOptions}
          searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
          value={draft.measurement.quantityUnit}
        />
        <SearchableSelect
          emptyText={t("productCreate.searchableSelect.noResults")}
          label={t("productCreate.fields.packType")}
          onChange={updateProductPackType}
          options={packTypeOptions}
          searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
          value={draft.measurement.packType}
        />
        <NumberField
          error={compareAtPriceError}
          label={t("productCreate.fields.compareAtPrice")}
          value={draft.compareAtPrice}
          onChange={(value) => setDraft((current) => ({
            ...current,
            compareAtPrice: value,
            variants: current.variants.map((variant) => ({ ...variant, mrp: value }))
          }))}
        />
      </div>
      <div>
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t("productCreate.fields.variants")}</h3>
          <DashboardButton
            icon={Plus}
            label={t("productCreate.actions.addVariant")}
            onClick={() => setDraft((current) => ({
                ...current,
                variants: [
                  ...current.variants,
                  newVariantDraft(current, t("productCreate.variantName", { index: current.variants.length + 1 }))
                ]
              }))}
            showLabelOnMobile
            variant="secondary"
          />
        </div>
        <div className="space-y-2">
          {draft.variants.map((variant) => (
            <div
              className={cx("items-end rounded-2xl border border-zinc-200 bg-white p-3", styles.variantGrid)}
              key={variant.id}
            >
              <div className={styles.variantNameField}>
                <InlineInput
                  error={!variant.name.trim() ? t("productCreate.validation.variantNameRequired") : undefined}
                  label={t("productCreate.fields.variant")}
                  value={variant.name}
                  onChange={(value) => updateVariant(setDraft, variant.id, { name: value })}
                />
              </div>
              {productSku && (
                <div className={styles.variantSkuField}>
                  <InlineInput
                    label={t("productCreate.fields.skuOptional")}
                    value={variant.sku || productSku}
                    onChange={(value) => updateVariant(setDraft, variant.id, { sku: value.toUpperCase() })}
                  />
                </div>
              )}
              <InlineNumber
                error={variant.price <= 0 ? t("productCreate.validation.variantPriceRequired") : undefined}
                label={t("productCreate.fields.price")}
                value={variant.price}
                onChange={(value) => {
                  updateVariant(setDraft, variant.id, { manualPrice: true, price: value });
                }}
              />
              <InlineNumber
                error={variant.measurement.quantityValue <= 0 ? t("productCreate.validation.quantityInvalid") : undefined}
                label={t("productCreate.fields.packSize")}
                value={variant.measurement.quantityValue}
                onChange={(value) => {
                  updateVariant(setDraft, variant.id, {
                    manualPackSize: true,
                    measurement: patchMeasurement(variant.measurement, { quantityValue: value }, draft)
                  });
                }}
              />
              <SearchableSelect
                compact
                emptyText={t("productCreate.searchableSelect.noResults")}
                error={!isMeasurementAllowed(variant.measurement, draft) ? t("productCreate.validation.variantMeasurementInvalid") : undefined}
                label={t("productCreate.fields.unit")}
                onChange={(value) => {
                  updateVariant(setDraft, variant.id, {
                    manualUnit: true,
                    measurement: patchMeasurement(variant.measurement, { quantityUnit: value as MeasurementUnit }, draft)
                  });
                }}
                options={preset.allowedQuantityUnits
                  .filter((unit) => unitOptionsForGroup(variant.measurement.unitGroup).includes(unit))
                  .map((value) => ({
                    label: t(`productCreate.units.${value}` as never),
                    searchText: value,
                    value
                  }))}
                searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
                value={variant.measurement.quantityUnit}
              />
              <SearchableSelect
                compact
                emptyText={t("productCreate.searchableSelect.noResults")}
                label={t("productCreate.fields.packType")}
                onChange={(value) => {
                  updateVariant(setDraft, variant.id, {
                    manualPackType: true,
                    measurement: patchMeasurement(variant.measurement, { packType: value as PackType }, draft)
                  });
                }}
                options={preset.allowedPackTypes.map((value) => ({
                  label: t(`productCreate.packTypes.${value}` as never),
                  searchText: value,
                  value
                }))}
                searchPlaceholder={t("productCreate.searchableSelect.searchPlaceholder")}
                value={variant.measurement.packType}
              />
              <button
                aria-label={t("productCreate.actions.removeVariant")}
                className={cx("flex size-9 items-center justify-center rounded-lg border border-zinc-200 text-zinc-500 transition hover:border-zinc-300 hover:text-zinc-950", styles.variantDeleteButton)}
                onClick={() => setDraft((current) => ({ ...current, variants: current.variants.filter((item) => item.id !== variant.id) }))}
                type="button"
              >
                <Trash2 size={14} />
              </button>
              <div className="col-span-full">
                <span className="text-[11px] font-normal text-zinc-500">
                  {normalizeMeasurement(variant.measurement, variant.price).unitDisplay} - {normalizeMeasurement(variant.measurement, variant.price).pricePerBaseUnitDisplay}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function patchMeasurement(
  current: ProductMeasurement,
  patch: Partial<ProductMeasurement>,
  context: Pick<ProductDraft, "category" | "subCategory" | "productType">
): ProductMeasurement {
  const preset = getMeasurementPreset(context);
  const group = (patch.unitGroup ?? current.unitGroup) as UnitGroup;
  const unitOptions = preset.allowedQuantityUnits.filter((unit) => unitOptionsForGroup(group).includes(unit));
  const requestedUnit = (patch.quantityUnit ?? current.quantityUnit) as MeasurementUnit;
  const requestedPack = (patch.packType ?? current.packType) as PackType;
  const next = {
    ...current,
    ...patch,
    unitGroup: preset.allowedUnitGroups.includes(group) ? group : preset.defaultMeasurement.unitGroup,
    quantityUnit: unitOptions.includes(requestedUnit) ? requestedUnit : unitOptions[0] ?? preset.defaultMeasurement.quantityUnit,
    packType: preset.allowedPackTypes.includes(requestedPack) ? requestedPack : preset.defaultMeasurement.packType,
    quantityValue: Number(patch.quantityValue ?? current.quantityValue)
  };
  return coerceMeasurementForProduct(next, context);
}

function firstUnitForMeasurementGroup(
  preset: ReturnType<typeof getMeasurementPreset>,
  group: UnitGroup
): MeasurementUnit {
  return (
    preset.allowedQuantityUnits.find((unit) => unitOptionsForGroup(group).includes(unit)) ??
    preset.defaultMeasurement.quantityUnit
  );
}

function unitSummaryForGroup(
  group: UnitGroup,
  allowedUnits: MeasurementUnit[],
  t: ReturnType<typeof useTranslations>
) {
  return allowedUnits
    .filter((unit) => unitOptionsForGroup(group).includes(unit))
    .map((unit) => t(`productCreate.units.${unit}` as never))
    .join(", ");
}

function newVariantDraft(current: ProductDraft, fallbackName: string) {
  const measurement = coerceMeasurementForProduct(current.measurement, current);
  const normalized = normalizeMeasurement(measurement, current.price);
  return {
    id: uid(),
    name: variantNameFromProductName(current.name, fallbackName, measurement),
    sku: current.sku.trim().toUpperCase(),
    price: current.price,
    mrp: current.compareAtPrice,
    costPrice: current.costPrice,
    stock: 0,
    measurement,
    unitDisplay: normalized.unitDisplay,
    pricePerBaseUnit: normalized.pricePerBaseUnit,
    pricePerBaseUnitDisplay: normalized.pricePerBaseUnitDisplay
  };
}

function sameMeasurement(left: ProductMeasurement, right: ProductMeasurement) {
  return (
    left.unitGroup === right.unitGroup &&
    left.quantityValue === right.quantityValue &&
    left.quantityUnit === right.quantityUnit &&
    left.packType === right.packType
  );
}

function variantNameFromProductName(productName: string, fallbackName: string, _measurement?: ProductMeasurement) {
  return productName.trim() || fallbackName;
}

function legacyMeasuredVariantName(productName: string, fallbackName: string, measurement?: ProductMeasurement) {
  const baseName = productName.trim() || fallbackName;
  return measurement ? `${baseName} ${formatUnitDisplay(measurement)}` : baseName;
}

function hasLegacyMeasurementSuffix(variantName: string, productName: string) {
  const baseName = productName.trim();
  if (!baseName) {
    return false;
  }
  const prefix = `${baseName} `;
  if (!variantName.toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase())) {
    return false;
  }
  const suffix = variantName.slice(prefix.length).trim();
  return /^\d+(?:\.\d+)?\s*(?:mg|g|kg|tonne|ml|l|litre|gal|pc|pcs|piece|pair|dozen|cm|m|meter|in|inch|ft|feet|sq ft|sq m|sq meter)(?:\s+[a-z][a-z\s]*)?$/i.test(suffix);
}

function shouldSyncVariantName(
  variantName: string,
  currentProductName: string,
  fallbackName: string,
  measurement?: ProductMeasurement
) {
  const normalized = variantName.trim();
  const currentName = currentProductName.trim();
  const generatedName = variantNameFromProductName(currentProductName, fallbackName, measurement);
  const legacyGeneratedName = legacyMeasuredVariantName(currentProductName, fallbackName, measurement);
  if (!normalized) {
    return true;
  }
  if (currentName && normalized === currentName) {
    return true;
  }
  if (currentName && normalized === generatedName) {
    return true;
  }
  if (currentName && (normalized === legacyGeneratedName || hasLegacyMeasurementSuffix(normalized, currentName))) {
    return true;
  }
  return (
    normalized === "Default" ||
    normalized === fallbackName.trim() ||
    /^Variant\s+\d+$/i.test(normalized) ||
    /^மாற்று\s+\d+$/.test(normalized)
  );
}

export function InventoryStep({
  draft,
  setDraft
}: {
  draft: ProductDraft;
  setDraft: Dispatch<SetStateAction<ProductDraft>>;
}) {
  const t = useTranslations("dashboard");
  const format = useDashboardFormatters();
  const stockVariants = draft.variants.filter((variant, index) => isVisibleStockVariant(variant, draft, index));
  const stockRowCount = 1 + stockVariants.length;
  const productStockMeasurement = normalizeMeasurement(draft.measurement, draft.price);
  const updateVariantStock = (variantId: string, value: number) => {
    setDraft((current) => {
      const variants = current.variants.map((variant) =>
        variant.id === variantId ? { ...variant, stock: Math.max(0, Math.floor(value)) } : variant
      );
      return {
        ...current,
        variants
      };
    });
  };

  return (
    <div className="space-y-6">
      <SectionHeading title={t("productCreate.sections.inventoryTitle")} body={t("productCreate.sections.inventoryBody")} />
      <div className="min-w-0 space-y-3">
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">{t("productCreate.inventory.productStock")}</h3>
          <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-medium text-zinc-500">
            {t("productCreate.inventory.productCount", { count: stockRowCount })}
          </span>
        </div>
        <div className="space-y-2">
          <div className="grid min-w-0 gap-3 rounded-2xl border border-zinc-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(130px,170px)] sm:items-end">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-zinc-950">{draft.name.trim() || t("productCreate.preview.untitled")}</p>
              <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-normal text-zinc-500">
                <span className="font-medium text-zinc-700">{format.currency(draft.price)}</span>
                <span>{productStockMeasurement.unitDisplay}</span>
                <span>{productStockMeasurement.pricePerBaseUnitDisplay}</span>
              </p>
              {draft.sku && (
                <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                  {draft.sku}
                </p>
              )}
            </div>
            <InlineNumber
              label={t("productCreate.fields.stock")}
              mode="integer"
              value={draft.stock}
              onChange={(value) => setDraft((current) => ({ ...current, stock: Math.max(0, Math.floor(value)) }))}
            />
          </div>
          {stockVariants.map((variant, index) => {
            const normalized = normalizeMeasurement(variant.measurement, variant.price);
            const variantName = variant.name.trim() || t("productCreate.variantName", { index: index + 1 });
            return (
              <div
                className="grid min-w-0 gap-3 rounded-2xl border border-zinc-200 bg-white p-3 sm:grid-cols-[minmax(0,1fr)_minmax(130px,170px)] sm:items-end"
                key={variant.id}
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-zinc-950">{variantName}</p>
                  <p className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px] font-normal text-zinc-500">
                    <span className="font-medium text-zinc-700">{format.currency(variant.price)}</span>
                    <span>{normalized.unitDisplay}</span>
                    <span>{normalized.pricePerBaseUnitDisplay}</span>
                  </p>
                  {variant.sku && (
                    <p className="mt-1 truncate text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
                      {variant.sku}
                    </p>
                  )}
                </div>
                <InlineNumber
                  label={t("productCreate.fields.stock")}
                  mode="integer"
                  value={variant.stock}
                  onChange={(value) => updateVariantStock(variant.id, value)}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function PreviewStep({ draft }: { draft: ProductDraft }) {
  const t = useTranslations("dashboard");
  const description = draft.seoDescription.trim();
  const measurement = normalizeMeasurement(draft.measurement, draft.price);
  return (
    <div className="space-y-6">
      <SectionHeading title={t("productCreate.sections.previewTitle")} body={t("productCreate.sections.previewBody")} />
      <div className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="grid gap-5 md:grid-cols-[280px_minmax(0,1fr)] md:items-center">
          <div
            className="aspect-square rounded-xl bg-zinc-50 bg-cover bg-center"
            style={{ backgroundImage: draft.images[0] ? `url(${draft.images[0].url})` : undefined }}
          />
          <div className="min-w-0">
            <p className="text-base font-semibold text-zinc-950">{draft.name || t("productCreate.preview.untitled")}</p>
            {description && (
              <p className="mt-2 max-w-2xl text-[13px] font-normal leading-relaxed text-zinc-600">
                {description}
              </p>
            )}
            <p className="mt-3 text-[11px] font-normal text-zinc-500">
              {draft.sku ? `${draft.category} / ${draft.subCategory} / ${draft.productType} - ${draft.sku}` : `${draft.category} / ${draft.subCategory} / ${draft.productType}`}
            </p>
            <p className="mt-4 text-2xl font-semibold tabular-nums text-zinc-900">{measurement.pricePerBaseUnitDisplay}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
