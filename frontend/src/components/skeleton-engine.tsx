import type { CSSProperties, HTMLAttributes, ReactNode } from "react";

type SkeletonRadius = "sm" | "md" | "lg" | "xl" | "2xl" | "full";
type SkeletonTone = "surface" | "soft" | "dark";

const radiusClass: Record<SkeletonRadius, string> = {
  sm: "rounded-md",
  md: "rounded-lg",
  lg: "rounded-xl",
  xl: "rounded-2xl",
  "2xl": "rounded-[24px]",
  full: "rounded-full"
};

const toneClass: Record<SkeletonTone, string> = {
  surface: "bg-slate-200/80",
  soft: "bg-slate-100",
  dark: "bg-slate-300/80"
};

function cn(...classes: Array<string | false | null | undefined>) {
  return classes.filter(Boolean).join(" ");
}

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  height?: CSSProperties["height"];
  radius?: SkeletonRadius;
  tone?: SkeletonTone;
  width?: CSSProperties["width"];
}

export function Skeleton({
  className,
  height,
  radius = "lg",
  style,
  tone = "surface",
  width = "100%",
  ...props
}: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "skeleton-engine relative overflow-hidden",
        radiusClass[radius],
        toneClass[tone],
        className
      )}
      style={{ height, width, ...style }}
      {...props}
    />
  );
}

interface SkeletonTextProps {
  className?: string;
  lineClassName?: string;
  lines?: number;
  widths?: Array<CSSProperties["width"]>;
}

export function SkeletonText({
  className,
  lineClassName,
  lines = 2,
  widths = ["100%", "72%"]
}: SkeletonTextProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, index) => (
        <Skeleton
          className={lineClassName}
          height={index === 0 ? 12 : 10}
          key={index}
          radius="full"
          width={widths[index] ?? widths[widths.length - 1] ?? "100%"}
        />
      ))}
    </div>
  );
}

interface SkeletonSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  padded?: boolean;
}

export function SkeletonSurface({
  children,
  className,
  padded = true,
  ...props
}: SkeletonSurfaceProps) {
  return (
    <div
      aria-busy="true"
      className={cn(
        "rounded-[24px] border border-slate-200 bg-white shadow-[0_18px_45px_rgba(15,23,42,0.07)]",
        padded && "p-4 sm:p-5",
        className
      )}
      role="status"
      {...props}
    >
      <span className="sr-only">Loading content</span>
      {children}
    </div>
  );
}
