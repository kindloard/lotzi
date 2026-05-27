export const UNIT_GROUPS = ["WEIGHT", "VOLUME", "COUNT", "LENGTH", "AREA", "BUNDLE"] as const;
export type UnitGroup = (typeof UNIT_GROUPS)[number];

export const MEASUREMENT_UNITS = [
  "MG",
  "G",
  "KG",
  "TONNE",
  "ML",
  "LITRE",
  "GALLON",
  "PIECE",
  "PAIR",
  "DOZEN",
  "CM",
  "METER",
  "INCH",
  "FEET",
  "SQ_FT",
  "SQ_METER"
] as const;
export type MeasurementUnit = (typeof MEASUREMENT_UNITS)[number];

export const PACK_TYPES = [
  "UNIT",
  "PACK",
  "PACKET",
  "BOX",
  "CARTON",
  "BOTTLE",
  "POUCH",
  "JAR",
  "CAN",
  "SACHET",
  "STRIP",
  "BAG",
  "TRAY",
  "BUNCH",
  "BUNDLE",
  "SET"
] as const;
export type PackType = (typeof PACK_TYPES)[number];

export interface MeasurementInput {
  unitGroup?: string | null;
  quantityValue?: number | null;
  quantityUnit?: string | null;
  packType?: string | null;
}

export interface MeasurementContext {
  category?: string | null;
  subCategory?: string | null;
  productType?: string | null;
  price?: number | null;
}

export interface NormalizedMeasurement {
  unitGroup: UnitGroup;
  quantityValue: number;
  quantityUnit: MeasurementUnit;
  normalizedValue: number;
  normalizedUnit: MeasurementUnit;
  packType: PackType;
  pricePerBaseUnit: number;
  unitDisplay: string;
  pricePerBaseUnitDisplay: string;
}

export interface SuggestedMeasurement {
  quantityValue: number;
  quantityUnit: MeasurementUnit;
  packType: PackType;
}

export interface MeasurementPreset {
  key: string;
  allowedUnitGroups: UnitGroup[];
  allowedQuantityUnits: MeasurementUnit[];
  allowedPackTypes: PackType[];
  defaultMeasurement: SuggestedMeasurement & { unitGroup: UnitGroup };
  suggestedVariants: SuggestedMeasurement[];
  helperText: string;
}

export class ProductMeasurementError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details: Record<string, unknown> = {}
  ) {
    super(message);
  }
}

const unitMeta: Record<MeasurementUnit, {
  group: UnitGroup;
  factorToNormalized: number;
  normalizedUnit: MeasurementUnit;
  shortLabel: string;
}> = {
  MG: { group: "WEIGHT", factorToNormalized: 0.001, normalizedUnit: "G", shortLabel: "mg" },
  G: { group: "WEIGHT", factorToNormalized: 1, normalizedUnit: "G", shortLabel: "g" },
  KG: { group: "WEIGHT", factorToNormalized: 1000, normalizedUnit: "G", shortLabel: "kg" },
  TONNE: { group: "WEIGHT", factorToNormalized: 1_000_000, normalizedUnit: "G", shortLabel: "tonne" },
  ML: { group: "VOLUME", factorToNormalized: 1, normalizedUnit: "ML", shortLabel: "ml" },
  LITRE: { group: "VOLUME", factorToNormalized: 1000, normalizedUnit: "ML", shortLabel: "L" },
  GALLON: { group: "VOLUME", factorToNormalized: 3785.411784, normalizedUnit: "ML", shortLabel: "gal" },
  PIECE: { group: "COUNT", factorToNormalized: 1, normalizedUnit: "PIECE", shortLabel: "pc" },
  PAIR: { group: "COUNT", factorToNormalized: 2, normalizedUnit: "PIECE", shortLabel: "pair" },
  DOZEN: { group: "COUNT", factorToNormalized: 12, normalizedUnit: "PIECE", shortLabel: "dozen" },
  CM: { group: "LENGTH", factorToNormalized: 1, normalizedUnit: "CM", shortLabel: "cm" },
  METER: { group: "LENGTH", factorToNormalized: 100, normalizedUnit: "CM", shortLabel: "m" },
  INCH: { group: "LENGTH", factorToNormalized: 2.54, normalizedUnit: "CM", shortLabel: "in" },
  FEET: { group: "LENGTH", factorToNormalized: 30.48, normalizedUnit: "CM", shortLabel: "ft" },
  SQ_FT: { group: "AREA", factorToNormalized: 0.09290304, normalizedUnit: "SQ_METER", shortLabel: "sq ft" },
  SQ_METER: { group: "AREA", factorToNormalized: 1, normalizedUnit: "SQ_METER", shortLabel: "sq m" }
};

const comparisonUnits: Record<UnitGroup, { unit: string; normalizedUnit: MeasurementUnit; normalizedFactor: number }> = {
  WEIGHT: { unit: "kg", normalizedUnit: "G", normalizedFactor: 1000 },
  VOLUME: { unit: "L", normalizedUnit: "ML", normalizedFactor: 1000 },
  COUNT: { unit: "pc", normalizedUnit: "PIECE", normalizedFactor: 1 },
  LENGTH: { unit: "m", normalizedUnit: "CM", normalizedFactor: 100 },
  AREA: { unit: "sq m", normalizedUnit: "SQ_METER", normalizedFactor: 1 },
  BUNDLE: { unit: "set", normalizedUnit: "PIECE", normalizedFactor: 1 }
};

const genericPreset: MeasurementPreset = {
  key: "generic",
  allowedUnitGroups: ["COUNT", "WEIGHT", "VOLUME"],
  allowedQuantityUnits: ["PIECE", "G", "KG", "ML", "LITRE"],
  allowedPackTypes: ["UNIT", "PACK", "PACKET", "BOX", "POUCH", "BOTTLE"],
  defaultMeasurement: { unitGroup: "COUNT", quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" },
  suggestedVariants: [
    { quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" },
    { quantityValue: 1, quantityUnit: "KG", packType: "PACK" },
    { quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" }
  ],
  helperText: "Choose the sellable quantity customers receive for one variant."
};

const presetRules: Array<MeasurementPreset & { match: (context: MeasurementContext) => boolean }> = [
  {
    key: "cooking-oils",
    allowedUnitGroups: ["VOLUME"],
    allowedQuantityUnits: ["ML", "LITRE", "GALLON"],
    allowedPackTypes: ["BOTTLE", "POUCH", "PACKET", "CAN", "JAR"],
    defaultMeasurement: { unitGroup: "VOLUME", quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" },
    suggestedVariants: [
      { quantityValue: 500, quantityUnit: "ML", packType: "BOTTLE" },
      { quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" },
      { quantityValue: 2, quantityUnit: "LITRE", packType: "BOTTLE" },
      { quantityValue: 5, quantityUnit: "LITRE", packType: "CAN" }
    ],
    helperText: "Cooking oils should be sold by volume, usually as bottles, pouches, cans, or jars.",
    match: (context) => norm(context.subCategory) === "cooking oils"
  },
  {
    key: "staples-weight",
    allowedUnitGroups: ["WEIGHT"],
    allowedQuantityUnits: ["G", "KG", "TONNE"],
    allowedPackTypes: ["BAG", "PACK", "PACKET", "POUCH", "BOX"],
    defaultMeasurement: { unitGroup: "WEIGHT", quantityValue: 1, quantityUnit: "KG", packType: "BAG" },
    suggestedVariants: [
      { quantityValue: 1, quantityUnit: "KG", packType: "BAG" },
      { quantityValue: 5, quantityUnit: "KG", packType: "BAG" },
      { quantityValue: 10, quantityUnit: "KG", packType: "BAG" },
      { quantityValue: 25, quantityUnit: "KG", packType: "BAG" }
    ],
    helperText: "Staples such as rice, wheat, dal, sugar, and salt should be sold by weight.",
    match: (context) =>
      norm(context.subCategory) === "staples" ||
      ["rice", "wheat", "atta", "maida", "rava", "dal", "pulses", "sugar", "salt", "poha"].includes(norm(context.productType))
  },
  {
    key: "eggs",
    allowedUnitGroups: ["COUNT"],
    allowedQuantityUnits: ["PIECE", "DOZEN"],
    allowedPackTypes: ["TRAY", "PACK", "PACKET", "BOX"],
    defaultMeasurement: { unitGroup: "COUNT", quantityValue: 12, quantityUnit: "PIECE", packType: "TRAY" },
    suggestedVariants: [
      { quantityValue: 6, quantityUnit: "PIECE", packType: "PACK" },
      { quantityValue: 12, quantityUnit: "PIECE", packType: "TRAY" },
      { quantityValue: 30, quantityUnit: "PIECE", packType: "TRAY" }
    ],
    helperText: "Eggs should be sold by count as pieces, dozens, packs, or trays.",
    match: (context) => norm(context.subCategory) === "eggs" || norm(context.productType).includes("egg")
  },
  {
    key: "milk-juices-water",
    allowedUnitGroups: ["VOLUME"],
    allowedQuantityUnits: ["ML", "LITRE"],
    allowedPackTypes: ["POUCH", "PACKET", "BOTTLE", "CARTON"],
    defaultMeasurement: { unitGroup: "VOLUME", quantityValue: 500, quantityUnit: "ML", packType: "POUCH" },
    suggestedVariants: [
      { quantityValue: 500, quantityUnit: "ML", packType: "POUCH" },
      { quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" },
      { quantityValue: 2, quantityUnit: "LITRE", packType: "BOTTLE" }
    ],
    helperText: "Milk, juices, water, and soft drinks should be sold by volume.",
    match: (context) =>
      ["juices", "water", "soft drinks"].includes(norm(context.subCategory)) ||
      ["milk", "curd", "fruit juice", "mixed juice", "mineral water", "flavored water"].includes(norm(context.productType))
  },
  {
    key: "tea-coffee-powders",
    allowedUnitGroups: ["WEIGHT", "COUNT"],
    allowedQuantityUnits: ["G", "KG", "PIECE"],
    allowedPackTypes: ["PACK", "PACKET", "POUCH", "JAR", "BOX"],
    defaultMeasurement: { unitGroup: "WEIGHT", quantityValue: 250, quantityUnit: "G", packType: "PACK" },
    suggestedVariants: [
      { quantityValue: 100, quantityUnit: "G", packType: "PACK" },
      { quantityValue: 250, quantityUnit: "G", packType: "PACK" },
      { quantityValue: 500, quantityUnit: "G", packType: "POUCH" }
    ],
    helperText: "Tea, coffee, spice powders, and mixes usually sell by weight.",
    match: (context) =>
      ["tea", "coffee", "spices & masala", "health drinks", "baking needs"].includes(norm(context.subCategory))
  },
  {
    key: "fruits-vegetables",
    allowedUnitGroups: ["WEIGHT", "COUNT", "BUNDLE"],
    allowedQuantityUnits: ["G", "KG", "PIECE"],
    allowedPackTypes: ["BAG", "PACK", "PACKET", "BUNCH", "BUNDLE", "UNIT"],
    defaultMeasurement: { unitGroup: "WEIGHT", quantityValue: 1, quantityUnit: "KG", packType: "BAG" },
    suggestedVariants: [
      { quantityValue: 500, quantityUnit: "G", packType: "BAG" },
      { quantityValue: 1, quantityUnit: "KG", packType: "BAG" },
      { quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" }
    ],
    helperText: "Fresh produce can be sold by weight, piece, bunch, or bundle depending on the item.",
    match: (context) => norm(context.category) === "fruits & vegetables"
  },
  {
    key: "personal-household-count",
    allowedUnitGroups: ["COUNT", "VOLUME", "WEIGHT"],
    allowedQuantityUnits: ["PIECE", "ML", "LITRE", "G", "KG"],
    allowedPackTypes: ["UNIT", "PACK", "PACKET", "BOX", "BOTTLE", "POUCH", "SACHET", "CAN", "JAR"],
    defaultMeasurement: { unitGroup: "COUNT", quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" },
    suggestedVariants: [
      { quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" },
      { quantityValue: 3, quantityUnit: "PIECE", packType: "PACK" },
      { quantityValue: 500, quantityUnit: "ML", packType: "BOTTLE" }
    ],
    helperText: "Personal care and household products can be sold by count, volume, or weight.",
    match: (context) => ["personal care", "household", "baby care", "home & kitchen"].includes(norm(context.category))
  }
];

export function getMeasurementPreset(context: MeasurementContext): MeasurementPreset {
  const matched = presetRules.find((rule) => rule.match(context));
  if (!matched) {
    return genericPreset;
  }
  const { match: _match, ...preset } = matched;
  return preset;
}

export function normalizeProductMeasurement(
  input: MeasurementInput | undefined,
  context: MeasurementContext
): NormalizedMeasurement {
  const preset = getMeasurementPreset(context);
  const defaultMeasurement = preset.defaultMeasurement;
  const unitGroup = normalizeToken<UnitGroup>(input?.unitGroup, UNIT_GROUPS) ?? defaultMeasurement.unitGroup;
  const quantityUnit = normalizeToken<MeasurementUnit>(input?.quantityUnit, MEASUREMENT_UNITS) ?? defaultMeasurement.quantityUnit;
  const packType = normalizeToken<PackType>(input?.packType, PACK_TYPES) ?? defaultMeasurement.packType;
  const quantityValue = Number(input?.quantityValue ?? defaultMeasurement.quantityValue);

  if (!Number.isFinite(quantityValue) || quantityValue <= 0) {
    throw new ProductMeasurementError(
      "PRODUCT_UNIT_QUANTITY_INVALID",
      "Quantity must be greater than zero.",
      { quantityValue: input?.quantityValue }
    );
  }

  const meta = unitMeta[quantityUnit];
  if (meta.group !== unitGroup) {
    throw new ProductMeasurementError(
      "PRODUCT_UNIT_INVALID_FOR_CATEGORY",
      `${quantityUnit} does not belong to ${unitGroup}.`,
      { unitGroup, quantityUnit }
    );
  }

  if (!preset.allowedUnitGroups.includes(unitGroup) || !preset.allowedQuantityUnits.includes(quantityUnit) || !preset.allowedPackTypes.includes(packType)) {
    throw new ProductMeasurementError(
      "PRODUCT_UNIT_INVALID_FOR_CATEGORY",
      "This unit is not allowed for the selected category.",
      {
        category: context.category,
        subCategory: context.subCategory,
        productType: context.productType,
        unitGroup,
        quantityUnit,
        packType,
        preset: preset.key
      }
    );
  }

  const normalizedValue = roundMeasurement(quantityValue * meta.factorToNormalized);
  const pricePerBaseUnit = computePricePerBaseUnit(Number(context.price ?? 0), unitGroup, normalizedValue);
  const measurement = {
    unitGroup,
    quantityValue: roundMeasurement(quantityValue),
    quantityUnit,
    normalizedValue,
    normalizedUnit: meta.normalizedUnit,
    packType,
    pricePerBaseUnit
  };

  return {
    ...measurement,
    unitDisplay: formatUnitDisplay(measurement),
    pricePerBaseUnitDisplay: formatPricePerBaseUnitDisplay(pricePerBaseUnit, unitGroup)
  };
}

export function formatUnitDisplay(input: Pick<NormalizedMeasurement, "quantityValue" | "quantityUnit" | "packType">) {
  const unit = input.quantityUnit;
  const quantity = formatQuantity(input.quantityValue);
  const unitLabel = unit === "PIECE"
    ? Number(input.quantityValue) === 1 ? "pc" : "pcs"
    : unitMeta[unit]?.shortLabel ?? unit.toLowerCase();
  const pack = titleCase(input.packType.replace(/_/g, " "));
  return `${quantity}${unit === "PIECE" ? " " : ""}${unitLabel} ${pack}`;
}

export function computePricePerBaseUnit(price: number, unitGroup: UnitGroup, normalizedValue: number) {
  if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(normalizedValue) || normalizedValue <= 0) {
    return 0;
  }
  const comparison = comparisonUnits[unitGroup];
  const comparableQuantity = normalizedValue / comparison.normalizedFactor;
  if (!Number.isFinite(comparableQuantity) || comparableQuantity <= 0) {
    return 0;
  }
  return roundMoney(price / comparableQuantity);
}

export function formatPricePerBaseUnitDisplay(pricePerBaseUnit: number, unitGroup: UnitGroup) {
  const comparison = comparisonUnits[unitGroup];
  if (!pricePerBaseUnit) {
    return `₹0/${comparison.unit}`;
  }
  return `₹${formatMoney(pricePerBaseUnit)}/${comparison.unit}`;
}

export function availableStock(stockOnHand: number, stockReserved: number) {
  return Math.max(0, stockOnHand - stockReserved);
}

function normalizeToken<T extends string>(value: string | null | undefined, allowed: readonly T[]): T | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().replace(/[\s-]+/g, "_").toUpperCase() as T;
  return allowed.includes(normalized) ? normalized : null;
}

function norm(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? "";
}

function formatQuantity(value: number) {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))).replace(/\.?0+$/, "");
}

function formatMoney(value: number) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, "");
}

function roundMoney(value: number) {
  return Math.round(value * 100) / 100;
}

function roundMeasurement(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

function titleCase(value: string) {
  return value
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}
