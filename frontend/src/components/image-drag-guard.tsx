"use client";

import { useEffect } from "react";

const IMAGE_DRAG_ALLOW_SELECTOR = "[data-allow-image-drag='true']";
const IMAGE_DRAG_BLOCK_SELECTOR = "img, picture, [data-no-image-drag='true']";

export function ImageDragGuard() {
  useEffect(() => {
    const preventImageDrag = (event: DragEvent) => {
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      if (target.closest(IMAGE_DRAG_ALLOW_SELECTOR)) {
        return;
      }
      if (target.closest(IMAGE_DRAG_BLOCK_SELECTOR)) {
        event.preventDefault();
      }
    };

    document.addEventListener("dragstart", preventImageDrag, { capture: true });
    return () => {
      document.removeEventListener("dragstart", preventImageDrag, { capture: true });
    };
  }, []);

  return null;
}
