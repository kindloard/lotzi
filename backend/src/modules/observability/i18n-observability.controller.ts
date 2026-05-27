import { Body, Controller, HttpCode, Post } from "@nestjs/common";
import { ObservabilityService } from "./observability.service";

interface I18nFallbackBody {
  locale?: string;
  namespace?: string;
  key?: string;
  routeTemplate?: string;
}

@Controller("observability")
export class I18nObservabilityController {
  constructor(private readonly observability: ObservabilityService) {}

  @Post("i18n-fallback")
  @HttpCode(202)
  recordFallback(@Body() body: I18nFallbackBody) {
    this.observability.recordI18nFallback({
      key: sanitizeLabel(body.key, "unknown"),
      locale: sanitizeLabel(body.locale, "unknown"),
      namespace: sanitizeLabel(body.namespace, "unknown"),
      routeTemplate: sanitizeRouteTemplate(body.routeTemplate)
    });
    return { code: "I18N_FALLBACK_RECORDED", message: "Translation fallback recorded." };
  }
}

function sanitizeLabel(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 160) : fallback;
}

function sanitizeRouteTemplate(value: unknown) {
  const template = sanitizeLabel(value, "/[locale]/unknown");
  if (/\/[A-Za-z0-9_-]{12,}/.test(template)) {
    return "/[locale]/unknown";
  }
  return template;
}
