import { I18nObservabilityController } from "@/modules/observability/i18n-observability.controller";

describe("I18nObservabilityController", () => {
  it("records fallback labels using a route template, not a raw dynamic URL", () => {
    const recordI18nFallback = jest.fn();
    const controller = new I18nObservabilityController({ recordI18nFallback } as never);

    expect(
      controller.recordFallback({
        key: "login.title",
        locale: "ta",
        namespace: "auth",
        routeTemplate: "/[locale]/auth/login"
      })
    ).toEqual({
      code: "I18N_FALLBACK_RECORDED",
      message: "Translation fallback recorded."
    });

    expect(recordI18nFallback).toHaveBeenCalledWith({
      key: "login.title",
      locale: "ta",
      namespace: "auth",
      routeTemplate: "/[locale]/auth/login"
    });
  });

  it("rejects high-cardinality dynamic URL labels", () => {
    const recordI18nFallback = jest.fn();
    const controller = new I18nObservabilityController({ recordI18nFallback } as never);

    controller.recordFallback({
      key: "title",
      locale: "ta",
      namespace: "dashboard",
      routeTemplate: "/ta/merchant/products/abc123456789xyz"
    });

    expect(recordI18nFallback).toHaveBeenCalledWith(
      expect.objectContaining({ routeTemplate: "/[locale]/unknown" })
    );
  });
});
