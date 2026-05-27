import type { ReactNode } from "react";

export function CatalogSectionHeader({
  action,
  eyebrow,
  title
}: {
  action?: ReactNode;
  eyebrow: string;
  title: string;
}) {
  return (
    <div className="flex min-w-0 items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-zinc-400">{eyebrow}</p>
        <h2 className="mt-1 text-base font-semibold tracking-tight text-zinc-950">{title}</h2>
      </div>
      {action}
    </div>
  );
}
