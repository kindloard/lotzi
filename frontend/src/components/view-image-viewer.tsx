"use client";

import Image from "next/image";
import { ChevronLeft, ChevronRight, RotateCcw, X, ZoomIn, ZoomOut } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type WheelEvent as ReactWheelEvent
} from "react";

const MIN_ZOOM = 1;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.3;
const DOUBLE_TAP_DELAY_MS = 280;
const DOUBLE_TAP_DISTANCE_PX = 24;
const TOUCH_TAP_MAX_DRIFT_PX = 10;

interface Point {
  x: number;
  y: number;
}

export interface ViewImageItem {
  id: string;
  src: string;
  alt: string;
  width?: number | null;
  height?: number | null;
}

interface ViewImageViewerProps {
  images: ViewImageItem[];
  initialIndex?: number;
  isOpen: boolean;
  onClose: () => void;
  title: string;
}

export function ViewImageViewer({
  images,
  initialIndex = 0,
  isOpen,
  onClose,
  title
}: ViewImageViewerProps) {
  const [activeIndex, setActiveIndex] = useState(() => clampIndex(initialIndex, images.length));
  const [offset, setOffset] = useState<Point>({ x: 0, y: 0 });
  const [scale, setScale] = useState(MIN_ZOOM);
  const [imageNaturalSize, setImageNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [stageSize, setStageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [isInteracting, setIsInteracting] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pointersRef = useRef(new Map<number, Point>());
  const pinchRef = useRef<{ distance: number; center: Point } | null>(null);
  const panPointerIdRef = useRef<number | null>(null);
  const panStartRef = useRef<{ pointer: Point; offset: Point } | null>(null);
  const touchTapStartRef = useRef(new Map<number, Point>());
  const scaleRef = useRef(MIN_ZOOM);
  const offsetRef = useRef<Point>({ x: 0, y: 0 });
  const lastTapRef = useRef<{ at: number; point: Point | null }>({ at: 0, point: null });

  const activeImage = images[activeIndex];
  const imageFitSize = useMemo(() => {
    const width = activeImage?.width ?? imageNaturalSize?.width ?? 0;
    const height = activeImage?.height ?? imageNaturalSize?.height ?? 0;
    if (!width || !height || !stageSize.width || !stageSize.height) {
      return { width: 0, height: 0 };
    }
    const ratio = Math.min(stageSize.width / width, stageSize.height / height);
    return {
      width: width * ratio,
      height: height * ratio
    };
  }, [activeImage?.height, activeImage?.width, imageNaturalSize?.height, imageNaturalSize?.width, stageSize.height, stageSize.width]);

  const clampOffset = useCallback((candidate: Point, targetScale: number): Point => {
    if (targetScale <= MIN_ZOOM || !imageFitSize.width || !imageFitSize.height) {
      return { x: 0, y: 0 };
    }

    const maxX = Math.max(0, (imageFitSize.width * targetScale - stageSize.width) / 2);
    const maxY = Math.max(0, (imageFitSize.height * targetScale - stageSize.height) / 2);
    return {
      x: clamp(candidate.x, -maxX, maxX),
      y: clamp(candidate.y, -maxY, maxY)
    };
  }, [imageFitSize.height, imageFitSize.width, stageSize.height, stageSize.width]);

  const setTransform = useCallback((targetScale: number, targetOffset: Point) => {
    const clampedScale = clamp(targetScale, MIN_ZOOM, MAX_ZOOM);
    const clampedOffset = clampOffset(targetOffset, clampedScale);
    scaleRef.current = clampedScale;
    offsetRef.current = clampedOffset;
    setScale(clampedScale);
    setOffset(clampedOffset);
  }, [clampOffset]);

  const resetView = useCallback(() => {
    pointersRef.current.clear();
    touchTapStartRef.current.clear();
    pinchRef.current = null;
    panPointerIdRef.current = null;
    panStartRef.current = null;
    setTransform(MIN_ZOOM, { x: 0, y: 0 });
  }, [setTransform]);

  const zoomAtPoint = useCallback((targetScale: number, screenPoint?: Point) => {
    if (!stageRef.current || !screenPoint) {
      setTransform(targetScale, offsetRef.current);
      return;
    }

    const rect = stageRef.current.getBoundingClientRect();
    const point = {
      x: screenPoint.x - rect.left - rect.width / 2,
      y: screenPoint.y - rect.top - rect.height / 2
    };
    const currentScale = scaleRef.current;
    const clampedScale = clamp(targetScale, MIN_ZOOM, MAX_ZOOM);
    const scaleRatio = clampedScale / currentScale;
    const candidate = {
      x: point.x - (point.x - offsetRef.current.x) * scaleRatio,
      y: point.y - (point.y - offsetRef.current.y) * scaleRatio
    };
    setTransform(clampedScale, candidate);
  }, [setTransform]);

  const moveToImage = useCallback((nextIndex: number) => {
    if (!images.length) {
      return;
    }
    const clampedIndex = clampIndex(nextIndex, images.length);
    if (clampedIndex === activeIndex) {
      return;
    }
    setActiveIndex(clampedIndex);
    setImageNaturalSize(null);
    resetView();
  }, [activeIndex, images.length, resetView]);

  const moveNext = useCallback(() => {
    if (!images.length) {
      return;
    }
    moveToImage(activeIndex === images.length - 1 ? 0 : activeIndex + 1);
  }, [activeIndex, images.length, moveToImage]);

  const movePrev = useCallback(() => {
    if (!images.length) {
      return;
    }
    moveToImage(activeIndex === 0 ? images.length - 1 : activeIndex - 1);
  }, [activeIndex, images.length, moveToImage]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const nextIndex = clampIndex(initialIndex, images.length);
    setActiveIndex(nextIndex);
    setImageNaturalSize(null);
    resetView();
  }, [images.length, initialIndex, isOpen, resetView]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const html = document.documentElement;
    const body = document.body;
    const previousHtmlOverflow = html.style.overflow;
    const previousBodyOverflow = body.style.overflow;
    html.style.overflow = "hidden";
    body.style.overflow = "hidden";
    return () => {
      html.style.overflow = previousHtmlOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen || !stageRef.current) {
      return;
    }

    const stage = stageRef.current;
    const syncBounds = () => {
      setStageSize({
        width: stage.clientWidth,
        height: stage.clientHeight
      });
    };
    syncBounds();

    const observer = new ResizeObserver(syncBounds);
    observer.observe(stage);
    window.addEventListener("resize", syncBounds);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
    };
  }, [isOpen]);

  useEffect(() => {
    setTransform(scaleRef.current, offsetRef.current);
  }, [imageFitSize.height, imageFitSize.width, setTransform, stageSize.height, stageSize.width]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key === "ArrowRight") {
        moveNext();
        return;
      }
      if (event.key === "ArrowLeft") {
        movePrev();
        return;
      }
      if (event.key === "+" || event.key === "=") {
        zoomAtPoint(scaleRef.current + ZOOM_STEP);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        zoomAtPoint(scaleRef.current - ZOOM_STEP);
        return;
      }
      if (event.key === "0") {
        resetView();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isOpen, moveNext, movePrev, onClose, resetView, zoomAtPoint]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!stageRef.current) {
      return;
    }

    const stage = stageRef.current;
    event.preventDefault();
    stage.setPointerCapture(event.pointerId);
    const point = toStagePoint(stage, event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    setIsInteracting(true);

    if (pointersRef.current.size === 1 && scaleRef.current > MIN_ZOOM) {
      panPointerIdRef.current = event.pointerId;
      panStartRef.current = {
        pointer: point,
        offset: offsetRef.current
      };
    } else if (pointersRef.current.size === 2) {
      const [first, second] = Array.from(pointersRef.current.values());
      pinchRef.current = {
        distance: distanceBetween(first, second),
        center: midpoint(first, second)
      };
      panPointerIdRef.current = null;
      panStartRef.current = null;
    }

    if (event.pointerType === "touch") {
      touchTapStartRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    }
  }, []);

  const onPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!stageRef.current || !pointersRef.current.has(event.pointerId)) {
      return;
    }

    const stage = stageRef.current;
    const point = toStagePoint(stage, event.clientX, event.clientY);
    pointersRef.current.set(event.pointerId, point);
    const pointers = Array.from(pointersRef.current.values());

    if (pointers.length === 2) {
      const [first, second] = pointers;
      const distance = distanceBetween(first, second);
      const center = midpoint(first, second);
      const previousPinch = pinchRef.current;

      if (!previousPinch || previousPinch.distance <= 0) {
        pinchRef.current = { distance, center };
        return;
      }

      const scaleRatio = distance / previousPinch.distance;
      const targetScale = clamp(scaleRef.current * scaleRatio, MIN_ZOOM, MAX_ZOOM);
      const centerDelta = {
        x: center.x - previousPinch.center.x,
        y: center.y - previousPinch.center.y
      };
      const rect = stage.getBoundingClientRect();
      const pointFromCenter = {
        x: center.x + rect.left + rect.width / 2,
        y: center.y + rect.top + rect.height / 2
      };
      zoomAtPoint(targetScale, pointFromCenter);
      setTransform(scaleRef.current, {
        x: offsetRef.current.x + centerDelta.x,
        y: offsetRef.current.y + centerDelta.y
      });
      pinchRef.current = { distance, center };
      return;
    }

    if (panPointerIdRef.current !== event.pointerId || !panStartRef.current) {
      if (event.pointerType === "touch") {
        const tapStart = touchTapStartRef.current.get(event.pointerId);
        if (tapStart && distanceBetween(tapStart, { x: event.clientX, y: event.clientY }) > TOUCH_TAP_MAX_DRIFT_PX) {
          touchTapStartRef.current.delete(event.pointerId);
        }
      }
      return;
    }

    const delta = {
      x: point.x - panStartRef.current.pointer.x,
      y: point.y - panStartRef.current.pointer.y
    };
    setTransform(scaleRef.current, {
      x: panStartRef.current.offset.x + delta.x,
      y: panStartRef.current.offset.y + delta.y
    });
  }, [setTransform, zoomAtPoint]);

  const onPointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!stageRef.current) {
      return;
    }

    pointersRef.current.delete(event.pointerId);
    const tapStart = touchTapStartRef.current.get(event.pointerId);
    touchTapStartRef.current.delete(event.pointerId);
    if (stageRef.current.hasPointerCapture(event.pointerId)) {
      stageRef.current.releasePointerCapture(event.pointerId);
    }

    if (pointersRef.current.size < 2) {
      pinchRef.current = null;
    }
    if (panPointerIdRef.current === event.pointerId) {
      panPointerIdRef.current = null;
      panStartRef.current = null;
    }

    const remainingPointer = Array.from(pointersRef.current.entries())[0];
    if (remainingPointer && scaleRef.current > MIN_ZOOM) {
      panPointerIdRef.current = remainingPointer[0];
      panStartRef.current = {
        pointer: remainingPointer[1],
        offset: offsetRef.current
      };
    }

    if (pointersRef.current.size === 0) {
      setIsInteracting(false);
      setTransform(scaleRef.current, offsetRef.current);
    }

    if (event.pointerType !== "touch" || pointersRef.current.size > 0 || !tapStart) {
      return;
    }

    if (distanceBetween(tapStart, { x: event.clientX, y: event.clientY }) > TOUCH_TAP_MAX_DRIFT_PX) {
      return;
    }

    const now = Date.now();
    const currentPoint = { x: event.clientX, y: event.clientY };
    const previousTap = lastTapRef.current;
    if (
      previousTap.point &&
      now - previousTap.at <= DOUBLE_TAP_DELAY_MS &&
      distanceBetween(previousTap.point, currentPoint) <= DOUBLE_TAP_DISTANCE_PX
    ) {
      const nextScale = scaleRef.current > 2 ? MIN_ZOOM : 2.5;
      zoomAtPoint(nextScale, currentPoint);
      lastTapRef.current = { at: 0, point: null };
      return;
    }
    lastTapRef.current = { at: now, point: currentPoint };
  }, [setTransform, zoomAtPoint]);

  const onWheel = useCallback((event: ReactWheelEvent<HTMLDivElement>) => {
    if (!stageRef.current) {
      return;
    }
    event.preventDefault();
    const direction = event.deltaY < 0 ? 1 : -1;
    zoomAtPoint(scaleRef.current + direction * ZOOM_STEP, {
      x: event.clientX,
      y: event.clientY
    });
  }, [zoomAtPoint]);

  if (!isOpen || !activeImage) {
    return null;
  }

  return (
    <div
      aria-label={title}
      aria-modal="true"
      className="fixed inset-0 z-[70] bg-black/95 text-white"
      role="dialog"
    >
      <div className="absolute inset-x-0 top-0 z-20 flex h-14 items-center justify-between bg-black/60 px-3 sm:px-4">
        <div className="truncate text-sm font-semibold text-white/90">
          {title}
        </div>
        <div className="flex items-center gap-1">
          <IconButton
            ariaLabel="Zoom out"
            disabled={scale <= MIN_ZOOM}
            onClick={() => zoomAtPoint(scaleRef.current - ZOOM_STEP)}
          >
            <ZoomOut size={18} />
          </IconButton>
          <IconButton
            ariaLabel="Zoom in"
            disabled={scale >= MAX_ZOOM}
            onClick={() => zoomAtPoint(scaleRef.current + ZOOM_STEP)}
          >
            <ZoomIn size={18} />
          </IconButton>
          <IconButton ariaLabel="Reset zoom" onClick={resetView}>
            <RotateCcw size={18} />
          </IconButton>
          <IconButton ariaLabel="Close image viewer" onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-14 top-14">
        <div
          ref={stageRef}
          className="relative h-full w-full overflow-hidden touch-none select-none"
          onDoubleClick={(event) => zoomAtPoint(scaleRef.current > 2 ? MIN_ZOOM : 2.5, { x: event.clientX, y: event.clientY })}
          onPointerCancel={onPointerUp}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onWheel={onWheel}
        >
          <div className="absolute left-1/2 top-1/2 h-full w-full -translate-x-1/2 -translate-y-1/2">
            <Image
              alt={activeImage.alt}
              className="pointer-events-none select-none object-contain will-change-transform"
              draggable={false}
              fill
              onLoad={(event) => {
                const image = event.currentTarget as HTMLImageElement;
                setImageNaturalSize({
                  width: image.naturalWidth,
                  height: image.naturalHeight
                });
              }}
              priority
              sizes="100vw"
              src={activeImage.src}
              style={{
                transform: `translate3d(${offset.x}px, ${offset.y}px, 0) scale(${scale})`,
                transformOrigin: "center center",
                transition: isInteracting ? "none" : "transform 120ms ease-out"
              }}
            />
          </div>

          {images.length > 1 ? (
            <>
              <button
                type="button"
                aria-label="Previous image"
                className="absolute left-3 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white transition hover:bg-black/70"
                onClick={movePrev}
              >
                <ChevronLeft size={22} />
              </button>
              <button
                type="button"
                aria-label="Next image"
                className="absolute right-3 top-1/2 -translate-y-1/2 rounded-full bg-black/55 p-2 text-white transition hover:bg-black/70"
                onClick={moveNext}
              >
                <ChevronRight size={22} />
              </button>
            </>
          ) : null}
        </div>
      </div>

      <div className="absolute inset-x-0 bottom-0 z-20 flex h-14 items-center gap-2 overflow-x-auto bg-black/70 px-3">
        {images.map((image, index) => (
          <button
            key={image.id}
            type="button"
            aria-label={`View image ${index + 1}`}
            className={`relative h-10 w-10 shrink-0 overflow-hidden rounded border ${
              index === activeIndex ? "border-white" : "border-white/25"
            }`}
            onClick={() => moveToImage(index)}
          >
            <Image
              alt={image.alt}
              className="object-cover"
              fill
              sizes="40px"
              src={image.src}
            />
          </button>
        ))}
      </div>
    </div>
  );
}

function IconButton({
  ariaLabel,
  children,
  disabled = false,
  onClick
}: {
  ariaLabel: string;
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-white/20 bg-black/50 text-white transition hover:bg-black/65 disabled:cursor-not-allowed disabled:opacity-40"
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function clampIndex(index: number, total: number) {
  if (!total) {
    return 0;
  }
  return clamp(index, 0, total - 1);
}

function distanceBetween(first: Point, second: Point) {
  const dx = first.x - second.x;
  const dy = first.y - second.y;
  return Math.hypot(dx, dy);
}

function midpoint(first: Point, second: Point): Point {
  return {
    x: (first.x + second.x) / 2,
    y: (first.y + second.y) / 2
  };
}

function toStagePoint(stage: HTMLDivElement, clientX: number, clientY: number): Point {
  const rect = stage.getBoundingClientRect();
  return {
    x: clientX - rect.left - rect.width / 2,
    y: clientY - rect.top - rect.height / 2
  };
}
