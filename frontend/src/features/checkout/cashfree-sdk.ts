"use client";

type CashfreeInstance = {
  checkout(input: { paymentSessionId: string; redirectTarget?: "_self" | "_blank" | "_modal" }): Promise<unknown>;
};

declare global {
  interface Window {
    Cashfree?: (input: { mode: "sandbox" | "production" }) => CashfreeInstance;
  }
}

let sdkPromise: Promise<CashfreeInstance> | null = null;

export function loadCashfree(): Promise<CashfreeInstance> {
  if (sdkPromise) {
    return sdkPromise;
  }
  sdkPromise = new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Cashfree can only be loaded in the browser."));
      return;
    }
    if (window.Cashfree) {
      resolve(window.Cashfree({ mode: cashfreeMode() }));
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>("script[data-cashfree-sdk='true']");
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.Cashfree) resolve(window.Cashfree({ mode: cashfreeMode() }));
        else reject(new Error("Cashfree SDK did not initialize."));
      });
      existing.addEventListener("error", () => reject(new Error("Cashfree SDK failed to load.")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
    script.async = true;
    script.dataset.cashfreeSdk = "true";
    script.onload = () => {
      if (window.Cashfree) resolve(window.Cashfree({ mode: cashfreeMode() }));
      else reject(new Error("Cashfree SDK did not initialize."));
    };
    script.onerror = () => reject(new Error("Cashfree SDK failed to load."));
    document.head.appendChild(script);
  });
  return sdkPromise;
}

function cashfreeMode(): "sandbox" | "production" {
  return process.env.NEXT_PUBLIC_CASHFREE_MODE === "production" ? "production" : "sandbox";
}
