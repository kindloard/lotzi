export type CategoryTranslationKey = "grocery" | "vegetables" | "bakery" | "dairy" | "meat";
export type CategoryTranslator = (key: CategoryTranslationKey) => string;

export const SUB_CATEGORY_TRANSLATION_KEYS = {
  "baby-care": "babyCare",
  "baby-food": "babyFood",
  "baby-hygiene": "babyHygiene",
  "baking-needs": "bakingNeeds",
  "biscuits": "biscuits",
  "bread-and-bakery": "breadBakery",
  "bread-bakery": "breadBakery",
  "cat-care": "catCare",
  "chicken": "chicken",
  "chips": "chips",
  "chocolates": "chocolates",
  "cleaning": "cleaning",
  "coffee": "coffee",
  "cooking-oils": "cookingOils",
  "dairy": "dairy",
  "dog-care": "dogCare",
  "dry-fruits-and-nuts": "dryFruitsNuts",
  "dry-fruits-nuts": "dryFruitsNuts",
  "eggs": "eggs",
  "festival-items": "festivalItems",
  "fish": "fish",
  "frozen-meat": "frozenMeat",
  "frozen-snacks": "frozenSnacks",
  "fruits": "fruits",
  "gift-packs": "giftPacks",
  "hair-care": "hairCare",
  "health-drinks": "healthDrinks",
  "health-foods": "healthFoods",
  "herbs": "herbs",
  "hygiene": "hygiene",
  "ice-cream": "iceCream",
  "instant-foods": "instantFoods",
  "juices": "juices",
  "kitchen-tools": "kitchenTools",
  "laundry": "laundry",
  "millets": "millets",
  "mutton": "mutton",
  "namkeen": "namkeen",
  "office-items": "officeItems",
  "oral-care": "oralCare",
  "organic-foods": "organicFoods",
  "pickles-and-sauces": "picklesSauces",
  "pickles-sauces": "picklesSauces",
  "school-items": "schoolItems",
  "seafood": "seafood",
  "skin-care": "skinCare",
  "soft-drinks": "softDrinks",
  "spices-and-masala": "spicesMasala",
  "spices-masala": "spicesMasala",
  "staples": "staples",
  "supplements": "supplements",
  "tea": "tea",
  "traditional-snacks": "traditionalSnacks",
  "utility": "utility",
  "vegetables": "vegetables",
  "water": "water"
} as const;

export type SubCategoryTranslationKey = typeof SUB_CATEGORY_TRANSLATION_KEYS[keyof typeof SUB_CATEGORY_TRANSLATION_KEYS];
export type SubCategoryLabels = Record<SubCategoryTranslationKey, string>;
export type ShopCatalogTranslator = (key: `subCategories.${SubCategoryTranslationKey}`) => string;

export function buildSubCategoryLabels(tCatalog: ShopCatalogTranslator): SubCategoryLabels {
  return {
    babyCare: tCatalog("subCategories.babyCare"),
    babyFood: tCatalog("subCategories.babyFood"),
    babyHygiene: tCatalog("subCategories.babyHygiene"),
    bakingNeeds: tCatalog("subCategories.bakingNeeds"),
    biscuits: tCatalog("subCategories.biscuits"),
    breadBakery: tCatalog("subCategories.breadBakery"),
    catCare: tCatalog("subCategories.catCare"),
    chicken: tCatalog("subCategories.chicken"),
    chips: tCatalog("subCategories.chips"),
    chocolates: tCatalog("subCategories.chocolates"),
    cleaning: tCatalog("subCategories.cleaning"),
    coffee: tCatalog("subCategories.coffee"),
    cookingOils: tCatalog("subCategories.cookingOils"),
    dairy: tCatalog("subCategories.dairy"),
    dogCare: tCatalog("subCategories.dogCare"),
    dryFruitsNuts: tCatalog("subCategories.dryFruitsNuts"),
    eggs: tCatalog("subCategories.eggs"),
    festivalItems: tCatalog("subCategories.festivalItems"),
    fish: tCatalog("subCategories.fish"),
    frozenMeat: tCatalog("subCategories.frozenMeat"),
    frozenSnacks: tCatalog("subCategories.frozenSnacks"),
    fruits: tCatalog("subCategories.fruits"),
    giftPacks: tCatalog("subCategories.giftPacks"),
    hairCare: tCatalog("subCategories.hairCare"),
    healthDrinks: tCatalog("subCategories.healthDrinks"),
    healthFoods: tCatalog("subCategories.healthFoods"),
    herbs: tCatalog("subCategories.herbs"),
    hygiene: tCatalog("subCategories.hygiene"),
    iceCream: tCatalog("subCategories.iceCream"),
    instantFoods: tCatalog("subCategories.instantFoods"),
    juices: tCatalog("subCategories.juices"),
    kitchenTools: tCatalog("subCategories.kitchenTools"),
    laundry: tCatalog("subCategories.laundry"),
    millets: tCatalog("subCategories.millets"),
    mutton: tCatalog("subCategories.mutton"),
    namkeen: tCatalog("subCategories.namkeen"),
    officeItems: tCatalog("subCategories.officeItems"),
    oralCare: tCatalog("subCategories.oralCare"),
    organicFoods: tCatalog("subCategories.organicFoods"),
    picklesSauces: tCatalog("subCategories.picklesSauces"),
    schoolItems: tCatalog("subCategories.schoolItems"),
    seafood: tCatalog("subCategories.seafood"),
    skinCare: tCatalog("subCategories.skinCare"),
    softDrinks: tCatalog("subCategories.softDrinks"),
    spicesMasala: tCatalog("subCategories.spicesMasala"),
    staples: tCatalog("subCategories.staples"),
    supplements: tCatalog("subCategories.supplements"),
    tea: tCatalog("subCategories.tea"),
    traditionalSnacks: tCatalog("subCategories.traditionalSnacks"),
    utility: tCatalog("subCategories.utility"),
    vegetables: tCatalog("subCategories.vegetables"),
    water: tCatalog("subCategories.water")
  };
}

export function localizeCategoryLabel(slug: string, fallback: string, tCategories: CategoryTranslator) {
  switch (slug) {
    case "grocery":
    case "vegetables":
    case "bakery":
    case "dairy":
    case "meat":
      return tCategories(slug);
    default:
      return fallback;
  }
}

export function localizeSubCategoryLabel(name: string, labels: SubCategoryLabels) {
  const key = SUB_CATEGORY_TRANSLATION_KEYS[normalizeCategoryLabel(name) as keyof typeof SUB_CATEGORY_TRANSLATION_KEYS];
  return key ? labels[key] : name;
}

function normalizeCategoryLabel(value: string) {
  return value.trim().toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
