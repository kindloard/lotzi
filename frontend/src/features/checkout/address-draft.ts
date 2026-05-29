import type { AddressInput } from "@/features/customer-account/customer-account-api";

export const CHECKOUT_SELECTED_ADDRESS_KEY = "ns:checkout:selected-address-id";
export const CHECKOUT_ADDRESS_DRAFT_KEY = "ns:checkout:address-draft";

export interface DeliveryPoint {
  latitude: number;
  longitude: number;
}

export interface AddressDraft extends AddressInput {
  latitude?: number;
  longitude?: number;
}

export interface NominatimAddress {
  house_number?: string;
  road?: string;
  neighbourhood?: string;
  suburb?: string;
  city?: string;
  town?: string;
  village?: string;
  county?: string;
  state_district?: string;
  state?: string;
  postcode?: string;
}

export interface ReverseGeocodeResult {
  display_name?: string;
  address?: NominatimAddress;
}

export function emptyAddressDraft(): AddressDraft {
  return {
    city: "",
    deliveryInstructions: "",
    isDefault: true,
    label: "Home",
    line1: "",
    line2: "",
    pincode: "",
    recipientName: "",
    recipientPhone: "",
    state: ""
  };
}

export function readAddressDraft() {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const savedDraft = window.sessionStorage.getItem(CHECKOUT_ADDRESS_DRAFT_KEY);
    return savedDraft ? (JSON.parse(savedDraft) as Partial<AddressDraft>) : null;
  } catch {
    return null;
  }
}

export function persistSelectedAddress(addressId: string) {
  try {
    window.sessionStorage.setItem(CHECKOUT_SELECTED_ADDRESS_KEY, addressId);
  } catch {
    // Checkout can continue with the default address if storage is unavailable.
  }
}

export function persistAddressDraft(draft: AddressDraft) {
  try {
    window.sessionStorage.setItem(CHECKOUT_ADDRESS_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    // The user can still type the address again if storage is unavailable.
  }
}

export function clearAddressDraft() {
  try {
    window.sessionStorage.removeItem(CHECKOUT_ADDRESS_DRAFT_KEY);
  } catch {
    // Nothing to clear.
  }
}

export function pointFromDraft(draft: Partial<AddressDraft>): DeliveryPoint | null {
  return typeof draft.latitude === "number" && typeof draft.longitude === "number"
    ? { latitude: draft.latitude, longitude: draft.longitude }
    : null;
}

export function addressDraftFromNominatim(result: ReverseGeocodeResult): Partial<AddressDraft> {
  // FAANG standard: Do NOT auto-fill ANY text fields from reverse geocoding.
  // We capture the GPS coordinates under the hood, but force the user to 
  // manually type their exact House, Area, City, State, and Pincode 
  // to ensure 100% address accuracy and prevent delivery failures.
  
  return {
    line1: "",
    line2: "",
    city: "",
    state: "",
    pincode: ""
  };
}

export function withoutEmpty(input: Partial<AddressDraft>) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined)
  ) as Partial<AddressDraft>;
}

export function safeNextPath(raw: string | null) {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("://")) {
    return "/cart";
  }
  return raw;
}
