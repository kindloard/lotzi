export const unitGroups = ["WEIGHT", "VOLUME", "COUNT", "LENGTH", "AREA", "BUNDLE"] as const;
export type UnitGroup = (typeof unitGroups)[number];

export const measurementUnits = [
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
export type MeasurementUnit = (typeof measurementUnits)[number];

export const packTypes = [
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
export type PackType = (typeof packTypes)[number];

export interface ProductMeasurementDraft {
  unitGroup: UnitGroup;
  quantityValue: number;
  quantityUnit: MeasurementUnit;
  packType: PackType;
}

export interface NormalizedMeasurement extends ProductMeasurementDraft {
  normalizedValue: number;
  normalizedUnit: MeasurementUnit;
  pricePerBaseUnit: number;
  unitDisplay: string;
  pricePerBaseUnitDisplay: string;
}

export interface MeasurementPreset {
  key: string;
  allowedUnitGroups: UnitGroup[];
  allowedQuantityUnits: MeasurementUnit[];
  allowedPackTypes: PackType[];
  defaultMeasurement: ProductMeasurementDraft;
  suggestedVariants: ProductMeasurementDraft[];
  helperText: string;
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

const comparisonUnits: Record<UnitGroup, { unit: string; normalizedFactor: number }> = {
  WEIGHT: { unit: "kg", normalizedFactor: 1000 },
  VOLUME: { unit: "L", normalizedFactor: 1000 },
  COUNT: { unit: "pc", normalizedFactor: 1 },
  LENGTH: { unit: "m", normalizedFactor: 100 },
  AREA: { unit: "sq m", normalizedFactor: 1 },
  BUNDLE: { unit: "set", normalizedFactor: 1 }
};

const genericPreset: MeasurementPreset = {
  key: "generic",
  allowedUnitGroups: ["COUNT", "WEIGHT", "VOLUME"],
  allowedQuantityUnits: ["PIECE", "G", "KG", "ML", "LITRE"],
  allowedPackTypes: ["UNIT", "PACK", "PACKET", "BOX", "POUCH", "BOTTLE"],
  defaultMeasurement: { unitGroup: "COUNT", quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" },
  suggestedVariants: [
    { unitGroup: "COUNT", quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" },
    { unitGroup: "WEIGHT", quantityValue: 1, quantityUnit: "KG", packType: "PACK" },
    { unitGroup: "VOLUME", quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" }
  ],
  helperText: "Choose the sellable quantity customers receive for one variant."
};

const presets: Array<MeasurementPreset & { match: (input: MeasurementContext) => boolean }> = [
  {
    key: "cooking-oils",
    allowedUnitGroups: ["VOLUME"],
    allowedQuantityUnits: ["ML", "LITRE", "GALLON"],
    allowedPackTypes: ["BOTTLE", "POUCH", "PACKET", "CAN", "JAR"],
    defaultMeasurement: { unitGroup: "VOLUME", quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" },
    suggestedVariants: [
      { unitGroup: "VOLUME", quantityValue: 500, quantityUnit: "ML", packType: "BOTTLE" },
      { unitGroup: "VOLUME", quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" },
      { unitGroup: "VOLUME", quantityValue: 2, quantityUnit: "LITRE", packType: "BOTTLE" },
      { unitGroup: "VOLUME", quantityValue: 5, quantityUnit: "LITRE", packType: "CAN" }
    ],
    helperText: "Cooking oils should be sold by volume.",
    match: (input) => norm(input.subCategory) === "cooking oils"
  },
  {
    key: "staples-weight",
    allowedUnitGroups: ["WEIGHT"],
    allowedQuantityUnits: ["G", "KG", "TONNE"],
    allowedPackTypes: ["BAG", "PACK", "PACKET", "POUCH", "BOX"],
    defaultMeasurement: { unitGroup: "WEIGHT", quantityValue: 1, quantityUnit: "KG", packType: "BAG" },
    suggestedVariants: [
      { unitGroup: "WEIGHT", quantityValue: 1, quantityUnit: "KG", packType: "BAG" },
      { unitGroup: "WEIGHT", quantityValue: 5, quantityUnit: "KG", packType: "BAG" },
      { unitGroup: "WEIGHT", quantityValue: 10, quantityUnit: "KG", packType: "BAG" },
      { unitGroup: "WEIGHT", quantityValue: 25, quantityUnit: "KG", packType: "BAG" }
    ],
    helperText: "Staples should be sold by weight.",
    match: (input) =>
      norm(input.subCategory) === "staples" ||
      ["rice", "wheat", "atta", "maida", "rava", "dal", "pulses", "sugar", "salt", "poha"].includes(norm(input.productType))
  },
  {
    key: "eggs",
    allowedUnitGroups: ["COUNT"],
    allowedQuantityUnits: ["PIECE", "DOZEN"],
    allowedPackTypes: ["TRAY", "PACK", "PACKET", "BOX"],
    defaultMeasurement: { unitGroup: "COUNT", quantityValue: 12, quantityUnit: "PIECE", packType: "TRAY" },
    suggestedVariants: [
      { unitGroup: "COUNT", quantityValue: 6, quantityUnit: "PIECE", packType: "PACK" },
      { unitGroup: "COUNT", quantityValue: 12, quantityUnit: "PIECE", packType: "TRAY" },
      { unitGroup: "COUNT", quantityValue: 30, quantityUnit: "PIECE", packType: "TRAY" }
    ],
    helperText: "Eggs should be sold by count.",
    match: (input) => norm(input.subCategory) === "eggs" || norm(input.productType).includes("egg")
  },
  {
    key: "milk-juices-water",
    allowedUnitGroups: ["VOLUME"],
    allowedQuantityUnits: ["ML", "LITRE"],
    allowedPackTypes: ["POUCH", "PACKET", "BOTTLE", "CARTON"],
    defaultMeasurement: { unitGroup: "VOLUME", quantityValue: 500, quantityUnit: "ML", packType: "POUCH" },
    suggestedVariants: [
      { unitGroup: "VOLUME", quantityValue: 500, quantityUnit: "ML", packType: "POUCH" },
      { unitGroup: "VOLUME", quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" },
      { unitGroup: "VOLUME", quantityValue: 2, quantityUnit: "LITRE", packType: "BOTTLE" }
    ],
    helperText: "Milk, juices, water, and soft drinks should be sold by volume.",
    match: (input) =>
      ["juices", "water", "soft drinks"].includes(norm(input.subCategory)) ||
      ["milk", "curd", "fruit juice", "mixed juice", "mineral water", "flavored water"].includes(norm(input.productType))
  },
  {
    key: "tea-coffee-powders",
    allowedUnitGroups: ["WEIGHT", "COUNT"],
    allowedQuantityUnits: ["G", "KG", "PIECE"],
    allowedPackTypes: ["PACK", "PACKET", "POUCH", "JAR", "BOX"],
    defaultMeasurement: { unitGroup: "WEIGHT", quantityValue: 250, quantityUnit: "G", packType: "PACK" },
    suggestedVariants: [
      { unitGroup: "WEIGHT", quantityValue: 100, quantityUnit: "G", packType: "PACK" },
      { unitGroup: "WEIGHT", quantityValue: 250, quantityUnit: "G", packType: "PACK" },
      { unitGroup: "WEIGHT", quantityValue: 500, quantityUnit: "G", packType: "POUCH" }
    ],
    helperText: "Tea, coffee, spice powders, and mixes usually sell by weight.",
    match: (input) =>
      ["tea", "coffee", "spices & masala", "health drinks", "baking needs"].includes(norm(input.subCategory))
  },
  {
    key: "fruits-vegetables",
    allowedUnitGroups: ["WEIGHT", "COUNT", "BUNDLE"],
    allowedQuantityUnits: ["G", "KG", "PIECE"],
    allowedPackTypes: ["BAG", "PACK", "PACKET", "BUNCH", "BUNDLE", "UNIT"],
    defaultMeasurement: { unitGroup: "WEIGHT", quantityValue: 1, quantityUnit: "KG", packType: "BAG" },
    suggestedVariants: [
      { unitGroup: "WEIGHT", quantityValue: 500, quantityUnit: "G", packType: "BAG" },
      { unitGroup: "WEIGHT", quantityValue: 1, quantityUnit: "KG", packType: "BAG" },
      { unitGroup: "COUNT", quantityValue: 1, quantityUnit: "PIECE", packType: "UNIT" }
    ],
    helperText: "Fresh produce can be sold by weight, piece, bunch, or bundle.",
    match: (input) => norm(input.category) === "fruits & vegetables"
  }
];

interface MeasurementContext {
  category?: string;
  subCategory?: string;
  productType?: string;
}

export function getMeasurementPreset(context: MeasurementContext): MeasurementPreset {
  const match = presets.find((preset) => preset.match(context));
  if (!match) {
    return genericPreset;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { match: _match, ...preset } = match;
  return preset;
}

export function normalizeMeasurement(measurement: ProductMeasurementDraft, price = 0): NormalizedMeasurement {
  const meta = unitMeta[measurement.quantityUnit];
  const normalizedValue = roundMeasurement(measurement.quantityValue * meta.factorToNormalized);
  const pricePerBaseUnit = computePricePerBaseUnit(price, measurement.unitGroup, normalizedValue);
  const normalized = {
    ...measurement,
    normalizedValue,
    normalizedUnit: meta.normalizedUnit,
    pricePerBaseUnit,
    unitDisplay: formatUnitDisplay(measurement),
    pricePerBaseUnitDisplay: formatPricePerBaseUnitDisplay(pricePerBaseUnit, measurement.unitGroup)
  };
  return normalized;
}

export function isMeasurementAllowed(measurement: ProductMeasurementDraft, context: MeasurementContext) {
  const preset = getMeasurementPreset(context);
  const meta = unitMeta[measurement.quantityUnit];
  return (
    measurement.quantityValue > 0 &&
    meta.group === measurement.unitGroup &&
    preset.allowedUnitGroups.includes(measurement.unitGroup) &&
    preset.allowedQuantityUnits.includes(measurement.quantityUnit) &&
    preset.allowedPackTypes.includes(measurement.packType)
  );
}

export function defaultMeasurementForProduct(context: MeasurementContext) {
  return { ...getMeasurementPreset(context).defaultMeasurement };
}

export function coerceMeasurementForProduct(measurement: ProductMeasurementDraft, context: MeasurementContext) {
  if (isMeasurementAllowed(measurement, context)) {
    return measurement;
  }
  return defaultMeasurementForProduct(context);
}

export function formatUnitDisplay(measurement: ProductMeasurementDraft) {
  const label = measurement.quantityUnit === "PIECE"
    ? measurement.quantityValue === 1 ? "pc" : "pcs"
    : unitMeta[measurement.quantityUnit].shortLabel;
  const separator = measurement.quantityUnit === "PIECE" ? " " : "";
  return `${formatQuantity(measurement.quantityValue)}${separator}${label} ${titleCase(measurement.packType)}`;
}

export function formatPricePerBaseUnitDisplay(pricePerBaseUnit: number, unitGroup: UnitGroup) {
  const unit = comparisonUnits[unitGroup].unit;
  return `₹${formatMoney(pricePerBaseUnit)}/${unit}`;
}

export function computePricePerBaseUnit(price: number, unitGroup: UnitGroup, normalizedValue: number) {
  if (!price || !normalizedValue) {
    return 0;
  }
  const comparison = comparisonUnits[unitGroup];
  return roundMoney(price / (normalizedValue / comparison.normalizedFactor));
}

export function unitOptionsForGroup(group: UnitGroup) {
  return measurementUnits.filter((unit) => unitMeta[unit].group === group);
}

export function unitGroupForUnit(unit: MeasurementUnit) {
  return unitMeta[unit].group;
}

export function measurementLabel(value: string) {
  return titleCase(value.replace(/_/g, " "));
}

function norm(value: string | undefined) {
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
