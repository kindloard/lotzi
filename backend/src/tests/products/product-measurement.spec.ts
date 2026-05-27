import {
  availableStock,
  formatUnitDisplay,
  normalizeProductMeasurement
} from "../../modules/products/product-measurement";

describe("product measurement engine", () => {
  it("normalizes weight and computes price per kg", () => {
    const measurement = normalizeProductMeasurement(
      { unitGroup: "WEIGHT", quantityValue: 500, quantityUnit: "G", packType: "PACK" },
      { category: "Grocery", subCategory: "Staples", productType: "Rice", price: 50 }
    );

    expect(measurement.normalizedValue).toBe(500);
    expect(measurement.normalizedUnit).toBe("G");
    expect(measurement.pricePerBaseUnit).toBe(100);
    expect(measurement.pricePerBaseUnitDisplay).toBe("₹100/kg");
  });

  it("normalizes volume and computes price per litre", () => {
    const measurement = normalizeProductMeasurement(
      { unitGroup: "VOLUME", quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" },
      { category: "Grocery", subCategory: "Cooking Oils", productType: "Sunflower Oil", price: 220 }
    );

    expect(measurement.normalizedValue).toBe(1000);
    expect(measurement.normalizedUnit).toBe("ML");
    expect(measurement.unitDisplay).toBe("1L Bottle");
    expect(measurement.pricePerBaseUnitDisplay).toBe("₹220/L");
  });

  it("normalizes count and computes price per piece", () => {
    const measurement = normalizeProductMeasurement(
      { unitGroup: "COUNT", quantityValue: 12, quantityUnit: "PIECE", packType: "TRAY" },
      { category: "Dairy & Bakery", subCategory: "Eggs", productType: "Chicken Eggs", price: 60 }
    );

    expect(measurement.normalizedValue).toBe(12);
    expect(measurement.normalizedUnit).toBe("PIECE");
    expect(measurement.pricePerBaseUnit).toBe(5);
    expect(measurement.pricePerBaseUnitDisplay).toBe("₹5/pc");
  });

  it("blocks invalid category-unit combinations", () => {
    expect(() =>
      normalizeProductMeasurement(
        { unitGroup: "VOLUME", quantityValue: 1, quantityUnit: "LITRE", packType: "BOTTLE" },
        { category: "Grocery", subCategory: "Staples", productType: "Rice", price: 100 }
      )
    ).toThrow("This unit is not allowed for the selected category.");
  });

  it("formats stock-safe unit displays", () => {
    expect(formatUnitDisplay({ quantityValue: 12, quantityUnit: "PIECE", packType: "TRAY" })).toBe("12 pcs Tray");
    expect(availableStock(20, 3)).toBe(17);
  });
});
