"use client";

import React, { useEffect, useState } from "react";

export function LoaderEngine({
  label = "Loading...",
  fullScreen = true,
}: {
  label?: string;
  fullScreen?: boolean;
}) {
  const [mounted, setMounted] = useState(false);

  // Prevent hydration mismatch on initial render
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return null;
  }

  const containerClasses = fullScreen
    ? "fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-slate-900/10 backdrop-blur-sm animate-fade-in"
    : "flex min-h-[400px] w-full flex-col items-center justify-center animate-fade-in";

  return (
    <div className={containerClasses}>
      {/* Animated Dots */}
      <div className="mb-4 flex items-center justify-center gap-2.5 animate-scale-up">
        <div
          className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-950"
          style={{ animationDelay: "0ms", animationDuration: "1000ms" }}
        />
        <div
          className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-950"
          style={{ animationDelay: "150ms", animationDuration: "1000ms" }}
        />
        <div
          className="h-2.5 w-2.5 animate-bounce rounded-full bg-slate-950"
          style={{ animationDelay: "300ms", animationDuration: "1000ms" }}
        />
      </div>
      
      {/* Loading Label */}
      <span className="text-xs font-black uppercase tracking-[0.25em] text-slate-950 [font-weight:950] animate-fade-in">
        {label}
      </span>
    </div>
  );
}
