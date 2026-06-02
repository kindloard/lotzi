"use client";

import { useEffect } from "react";
import { useReportWebVitals } from "next/web-vitals";

declare global {
  interface Window {
    __LOTZI_WEB_VITALS__?: Record<string, number[]>;
  }
}

export function WebVitalsReporter() {
  useEffect(() => {
    window.__LOTZI_WEB_VITALS__ ??= {};
    window.__LOTZI_WEB_VITALS__.CLS ??= [0];
    window.__LOTZI_WEB_VITALS__.INP ??= [0];
  }, []);

  useReportWebVitals((metric) => {
    window.__LOTZI_WEB_VITALS__ ??= {};
    window.__LOTZI_WEB_VITALS__[metric.name] ??= [];
    window.__LOTZI_WEB_VITALS__[metric.name].push(metric.value);
    window.dispatchEvent(new CustomEvent("lotzi:web-vital", { detail: metric }));
  });

  return null;
}
