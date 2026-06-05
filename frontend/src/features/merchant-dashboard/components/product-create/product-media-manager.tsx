"use client";

import {
  DndContext,
  DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  BadgeCheck,
  CloudUpload,
  GripVertical,
  ImageOff,
  ImagePlus,
  Loader2,
  RefreshCcw,
  Star,
  Trash2,
  X
} from "lucide-react";
import type { ChangeEvent, Dispatch, DragEvent, SetStateAction } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useTranslations } from "next-intl";
import { useToast } from "@/components/toast/toast-context";
import { ApiError } from "@/lib/api";
import {
  createProductImageUploadIdempotencyKey,
  isRetryableUploadError,
  productImageFromAsset,
  uploadProductImage,
  uploadRetryDelayMs
} from "@/lib/upload-engine-api";
import { isAbortError } from "@/lib/abort";
import type { ProductDraft, ProductImage } from "../../types/dashboard";
import { cx, isVisibleStockVariant, uid } from "../../lib/dashboard-utils";
import { uploadStatusKey } from "../../lib/dashboard-i18n";
import { IconButton } from "../ui/dashboard-ui";

const allowedTypes = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/tiff",
  "image/gif"
]);

const maxBytes = 12 * 1024 * 1024;
const maxImages = 8;
const uploadConcurrency = 2;
const maxUploadAttempts = 3;

type FileValidationIssue =
  | { key: "productCreate.media.tooLarge"; values: { name: string; size: number } }
  | { key: "productCreate.media.unsupportedType"; values: { name: string } }
  | { key: "productCreate.media.emptyFile"; values: { name: string } }
  | { key: "productCreate.media.corruptImage"; values: { name: string } };

type MediaScope = ProductDraft["mediaScope"];
type VariantMediaOption = { id: string; label: string; sku?: string };
type FileFingerprint = NonNullable<NonNullable<ProductImage["upload"]>["fileFingerprint"]>;
type UploadQueueItem = {
  imageId: string;
  attemptId: string;
  file: File;
  clientFileId: string;
  idempotencyKey: string;
  previewUrl: string;
  attempt: number;
};

export function ProductMediaManager({
  draft,
  setDraft,
  storeId
}: {
  draft: ProductDraft;
  setDraft: Dispatch<SetStateAction<ProductDraft>>;
  storeId: string;
}) {
  const t = useTranslations("dashboard");
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const filesRef = useRef(new Map<string, File>());
  const controllersRef = useRef(new Map<string, AbortController>());
  const previewsRef = useRef(new Set<string>());
  const queueRef = useRef<UploadQueueItem[]>([]);
  const queuedAttemptIdsRef = useRef(new Set<string>());
  const activeAttemptIdsRef = useRef(new Set<string>());
  const retryTimersRef = useRef(new Map<string, number>());
  const retryRef = useRef<(imageId: string) => void>(() => undefined);
  const draftIdRef = useRef(`draft-${uid()}`);
  // ✅ FIX: imagesRef gives async upload functions a non-stale view of current images.
  // Without this, startUpload() closes over `draft` at render time. If the user
  // removes or replaces an image during the 10–30s upload, draftImage() returns
  // stale/undefined data, corrupting state or writing broken image URLs.
  const imagesRef = useRef<ProductImage[]>(draft.images);
  imagesRef.current = draft.images;
  const mediaScope = draft.mediaScope ?? "PRODUCT";
  const sameImageAsProduct = draft.sameImageAsProduct ?? false;
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  useEffect(() => () => {
    for (const controller of controllersRef.current.values()) {
      controller.abort();
    }
    for (const timer of retryTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    for (const preview of previewsRef.current.values()) {
      URL.revokeObjectURL(preview);
    }
  }, []);

  const uploadedCount = draft.images.filter((image) => image.uploadAssetId).length;
  const pendingCount = draft.images.filter((image) => image.upload && image.upload.status !== "uploaded").length;
  const variantOptions = useMemo<VariantMediaOption[]>(
    () => draft.variants.flatMap((variant, index) => {
      if (!isVisibleStockVariant(variant, draft, index)) {
        return [];
      }
      const sku = variant.sku.trim().toUpperCase();
      return [{
        id: variant.id,
        label: variant.name.trim() || sku || t("productCreate.variantName", { index: index + 1 }),
        sku: sku || undefined
      }];
    }),
    [draft, t]
  );
  const hasVariantMediaControls = variantOptions.length > 0;
  const activeMediaScope: MediaScope = sameImageAsProduct || !hasVariantMediaControls ? "PRODUCT" : mediaScope;
  const variantOptionKey = variantOptions.map((option) => `${option.id}:${option.sku ?? ""}`).join("|");
  const visibleImages = sameImageAsProduct
    ? draft.images
    : draft.images.filter((image) => imageScopeFor(image) === activeMediaScope);

  useEffect(() => {
    setDraft((current) => {
      const options = mediaOptionsFromDraft(current);
      let changed = false;
      const images = current.images.map((image) => {
        if (!hasVariantAssignment(image)) {
          return image;
        }
        const nextImage = imageScopeFor(image) === "VARIANT"
          ? normalizeVariantImageAssignment(image, options)
          : clearVariantAssignment(image);
        if (nextImage !== image) {
          changed = true;
        }
        return nextImage;
      });
      if (changed) {
        imagesRef.current = images;
      }
      return changed ? { ...current, images } : current;
    });
  }, [setDraft, variantOptionKey]);

  const updateMediaScope = (scope: MediaScope) => {
    setDraft((current) => (
      current.mediaScope === scope ? current : { ...current, mediaScope: scope }
    ));
  };

  const updateSameImageAsProduct = (enabled: boolean) => {
    setDraft((current) => {
      const nextScope: MediaScope = enabled ? "PRODUCT" : (current.mediaScope ?? "PRODUCT");
      return {
        ...current,
        sameImageAsProduct: enabled,
        mediaScope: nextScope
      };
    });
  };

  const handleFiles = async (files: FileList | File[]) => {
    const incoming = Array.from(files);
    if (!storeId) {
      toast.error(t("productCreate.media.storeLoading"));
      return;
    }
    const available = maxImages - imagesRef.current.length;
    if (available <= 0) {
      toast.warning(t("productCreate.media.maxImages", { count: maxImages }));
      return;
    }

    const accepted: Array<{ image: ProductImage; file: File; queueItem: UploadQueueItem }> = [];
    for (const file of incoming.slice(0, available)) {
      const issue = await validateFile(file);
      if (issue) {
        toast.error(translateFileIssue(t, issue));
        continue;
      }
      const previewUrl = URL.createObjectURL(file);
      previewsRef.current.add(previewUrl);
      const imageId = uid();
      const attemptId = uid();
      const clientFileId = uid();
      const idempotencyKey = uid();
      const image: ProductImage = {
        id: imageId,
        imageScope: activeMediaScope === "VARIANT" ? "VARIANT" : "PRODUCT",
        name: displayFileName(file),
        url: previewUrl,
        focus: "Center",
        isPrimary: imagesRef.current.length === 0 && accepted.length === 0,
        ...variantImageAssignment(activeMediaScope, variantOptions),
        upload: {
          attemptId,
          attempt: 1,
          clientFileId,
          idempotencyKey,
          previewUrl,
          status: "queued",
          progress: 0,
          speedBytesPerSecond: 0,
          fileFingerprint: fileFingerprint(file)
        }
      };
      accepted.push({
        image,
        file,
        queueItem: {
          imageId,
          attemptId,
          file,
          clientFileId,
          idempotencyKey,
          previewUrl,
          attempt: 1
        }
      });
    }

    if (!accepted.length) {
      return;
    }
    for (const item of accepted) {
      filesRef.current.set(item.image.id, item.file);
    }
    imagesRef.current = normalizePrimary([...imagesRef.current, ...accepted.map((item) => item.image)]);
    setDraft((current) => ({
      ...current,
      images: normalizePrimary([...current.images, ...accepted.map((item) => item.image)])
    }));
    for (const item of accepted) {
      enqueueUpload(item.queueItem);
    }
    toast.success(t("productCreate.media.queued", { count: accepted.length }));
  };

  const enqueueUpload = (item: UploadQueueItem) => {
    if (queuedAttemptIdsRef.current.has(item.attemptId) || activeAttemptIdsRef.current.has(item.attemptId)) {
      return false;
    }
    queuedAttemptIdsRef.current.add(item.attemptId);
    queueRef.current.push(item);
    processQueue();
    return true;
  };

  const processQueue = () => {
    while (activeAttemptIdsRef.current.size < uploadConcurrency && queueRef.current.length) {
      const next = queueRef.current.shift();
      if (!next) return;
      queuedAttemptIdsRef.current.delete(next.attemptId);
      activeAttemptIdsRef.current.add(next.attemptId);
      void startUpload(next).finally(() => {
        activeAttemptIdsRef.current.delete(next.attemptId);
        processQueue();
      });
    }
  };

  const startUpload = async (item: UploadQueueItem) => {
    const { imageId, attemptId, attempt, clientFileId, file, previewUrl } = item;
    const controller = new AbortController();
    controllersRef.current.set(attemptId, controller);
    let idempotencyKey = item.idempotencyKey;
    try {
      updateImageAttempt(imageId, attemptId, {
        upload: {
          attemptId,
          attempt,
          clientFileId,
          idempotencyKey,
          previewUrl,
          status: "validating",
          progress: 0,
          speedBytesPerSecond: 0,
          fileFingerprint: fileFingerprint(file)
        }
      });
      if (!idempotencyKey.startsWith("upload:v1:")) {
        idempotencyKey = await createProductImageUploadIdempotencyKey(file, clientFileId);
      }
      if (controller.signal.aborted) {
        throw new DOMException("Upload aborted.", "AbortError");
      }
      updateImageAttempt(imageId, attemptId, {
        upload: {
          attemptId,
          attempt,
          clientFileId,
          idempotencyKey,
          previewUrl,
          status: "uploading",
          progress: 1,
          speedBytesPerSecond: 0,
          fileFingerprint: fileFingerprint(file)
        }
      });
      const response = await uploadProductImage({
        file,
        storeId,
        draftId: draftIdRef.current,
        clientFileId,
        idempotencyKey,
        signal: controller.signal,
        onProgress: (progress) => {
          if (!isCurrentAttempt(imageId, attemptId)) {
            return;
          }
          updateImageAttempt(imageId, attemptId, {
            upload: {
              attemptId,
              attempt,
              clientFileId,
              idempotencyKey,
              previewUrl,
              status: progress.progress >= 100 ? "processing" : "uploading",
              progress: Math.min(99, progress.progress),
              speedBytesPerSecond: progress.speedBytesPerSecond,
              fileFingerprint: fileFingerprint(file)
            }
          });
        }
      });
      // ✅ FIX: Check image still exists before updating state.
      // The upload takes 5–30s. If the user removed the image during that time,
      // imagesRef.current will not contain it. Updating state for a removed image
      // would corrupt the draft or cause unexpected re-renders.
      const local = draftImage(imageId);
      if (!local || local.upload?.attemptId !== attemptId) {
        // Image was removed while uploading. The uploaded Cloudinary asset will
        // be swept by the orphan cleanup job (sweepUploadCleanup) after 15 min.
        return;
      }
      const nextImage = productImageFromAsset(response.asset, {
        id: imageId,
        imageScope: imageScopeFor(local),
        name: displayFileName(file),
        url: local.url,
        variantIds: local.variantIds ?? [],
        variantSkuIds: local.variantSkuIds ?? []
      });
      updateImageAttempt(imageId, attemptId, (current) => {
        const currentPreviewUrl = current.upload?.previewUrl ?? previewUrl;
        return {
          ...nextImage,
          isPrimary: current.isPrimary ?? imagesRef.current.length === 1,
          imageScope: imageScopeFor(current),
          variantIds: current.variantIds ?? [],
          variantSkuIds: current.variantSkuIds ?? [],
          upload: {
            attemptId,
            attempt,
            clientFileId,
            idempotencyKey,
            previewUrl: currentPreviewUrl,
            status: "uploaded",
            progress: 100,
            speedBytesPerSecond: 0,
            fileFingerprint: fileFingerprint(file)
          }
        };
      });
      filesRef.current.delete(imageId);
      revokePreview(local.upload?.previewUrl ?? previewUrl);
      toast.success(t("productCreate.media.uploadedToast", { name: displayFileName(file) }));
    } catch (error) {
      const aborted = isAbortError(error);
      const retryable = !aborted && isRetryableUploadError(error);
      const message = aborted ? t("productCreate.media.uploadCancelled") : uploadErrorMessage(t, error);
      const canAutoRetry = retryable && attempt < maxUploadAttempts && Boolean(filesRef.current.get(imageId));
      updateImageAttempt(imageId, attemptId, {
        upload: {
          attemptId,
          attempt,
          clientFileId,
          idempotencyKey: idempotencyKey || item.idempotencyKey,
          previewUrl,
          status: aborted ? "aborted" : "failed",
          progress: 0,
          speedBytesPerSecond: 0,
          error: message,
          retryable,
          fileFingerprint: fileFingerprint(file)
        }
      });
      if (canAutoRetry) {
        scheduleAutoRetry({
          ...item,
          idempotencyKey: idempotencyKey || item.idempotencyKey
        }, uploadRetryDelayMs(error, attempt));
      } else if (!aborted) {
        toast.error(message, retryable ? {
          action: {
            label: t("productCreate.media.retryUpload"),
            onClick: () => retry(imageId)
          }
        } : undefined);
      }
    } finally {
      controllersRef.current.delete(attemptId);
    }
  };

  const retry = (imageId: string) => {
    clearRetryTimer(imageId);
    const image = draftImage(imageId);
    const upload = image?.upload;
    if (!image || !upload) {
      return;
    }
    if (isActiveUploadStatus(upload.status)) {
      return;
    }
    const file = filesRef.current.get(imageId);
    if (!file) {
      toast.error(t("productCreate.media.fileMissing"));
      return;
    }
    const attemptId = uid();
    const nextAttempt = upload.attempt + 1;
    updateImageAttempt(imageId, upload.attemptId, {
      upload: {
        attemptId,
        attempt: nextAttempt,
        clientFileId: upload.clientFileId,
        idempotencyKey: upload.idempotencyKey,
        previewUrl: upload.previewUrl,
        status: "retrying",
        progress: 0,
        speedBytesPerSecond: 0,
        fileFingerprint: fileFingerprint(file)
      }
    });
    enqueueUpload({
      imageId,
      attemptId,
      file,
      clientFileId: upload.clientFileId,
      idempotencyKey: upload.idempotencyKey,
      previewUrl: upload.previewUrl,
      attempt: nextAttempt
    });
  };
  retryRef.current = retry;

  const abortUpload = (imageId: string) => {
    clearRetryTimer(imageId);
    const image = draftImage(imageId);
    const upload = image?.upload;
    if (!upload) {
      return;
    }
    controllersRef.current.get(upload.attemptId)?.abort();
    queueRef.current = queueRef.current.filter((item) => {
      if (item.attemptId !== upload.attemptId) {
        return true;
      }
      queuedAttemptIdsRef.current.delete(item.attemptId);
      return false;
    });
    if (!activeAttemptIdsRef.current.has(upload.attemptId)) {
      updateImageAttempt(imageId, upload.attemptId, {
        upload: {
          ...upload,
          status: "aborted",
          progress: 0,
          speedBytesPerSecond: 0,
          error: t("productCreate.media.uploadCancelled"),
          retryable: false
        }
      });
    }
  };

  const remove = (imageId: string) => {
    abortUpload(imageId);
    const image = draftImage(imageId);
    if (image?.upload?.previewUrl) {
      revokePreview(image.upload.previewUrl);
    }
    filesRef.current.delete(imageId);
    queueRef.current = queueRef.current.filter((item) => {
      if (item.imageId !== imageId) {
        return true;
      }
      queuedAttemptIdsRef.current.delete(item.attemptId);
      return false;
    });
    imagesRef.current = normalizePrimary(imagesRef.current.filter((item) => item.id !== imageId));
    setDraft((current) => ({
      ...current,
      images: normalizePrimary(current.images.filter((item) => item.id !== imageId))
    }));
  };

  const replace = async (imageId: string, file: File) => {
    const issue = await validateFile(file);
    if (issue) {
      toast.error(translateFileIssue(t, issue));
      return;
    }
    abortUpload(imageId);
    const current = draftImage(imageId);
    if (current?.upload?.previewUrl) {
      revokePreview(current.upload.previewUrl);
    }
    const previewUrl = URL.createObjectURL(file);
    previewsRef.current.add(previewUrl);
    const attemptId = uid();
    const clientFileId = uid();
    const idempotencyKey = uid();
    filesRef.current.set(imageId, file);
    updateImage(imageId, {
      name: displayFileName(file),
      url: previewUrl,
      uploadAssetId: undefined,
      upload: {
        attemptId,
        attempt: 1,
        clientFileId,
        idempotencyKey,
        previewUrl,
        status: "queued",
        progress: 0,
        speedBytesPerSecond: 0,
        fileFingerprint: fileFingerprint(file)
      }
    });
    enqueueUpload({
      imageId,
      attemptId,
      file,
      clientFileId,
      idempotencyKey,
      previewUrl,
      attempt: 1
    });
  };

  const setPrimary = (imageId: string) => {
    setDraft((current) => ({
      ...current,
      images: current.images.map((image) => ({ ...image, isPrimary: image.id === imageId }))
    }));
  };

  const toggleVariant = (imageId: string, variantId: string) => {
    setDraft((current) => ({
      ...current,
      images: current.images.map((image) => {
        if (image.id !== imageId) return image;
        const options = mediaOptionsFromDraft(current);
        const selected = new Set(image.variantIds ?? []);
        if (selected.has(variantId)) selected.delete(variantId);
        else selected.add(variantId);
        return withSelectedVariantIds({ ...image, imageScope: "VARIANT" }, Array.from(selected), options);
      })
    }));
  };

  const onDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setDraft((current) => {
      const oldIndex = current.images.findIndex((image) => image.id === active.id);
      const newIndex = current.images.findIndex((image) => image.id === over.id);
      return {
        ...current,
        images: arrayMove(current.images, oldIndex, newIndex).map((image, index) => ({
          ...image,
          sortOrder: index
        }))
      };
    });
  };

  const updateImage = (imageId: string, patch: Partial<ProductImage>) => {
    imagesRef.current = normalizePrimary(imagesRef.current.map((image) => image.id === imageId ? { ...image, ...patch } : image));
    setDraft((current) => ({
      ...current,
      images: normalizePrimary(current.images.map((image) => image.id === imageId ? { ...image, ...patch } : image))
    }));
  };

  // ✅ FIX: Use imagesRef instead of draft for stale-closure-safe async lookups.
  const updateImageAttempt = (
    imageId: string,
    attemptId: string,
    patch: Partial<ProductImage> | ((image: ProductImage) => Partial<ProductImage> | null)
  ) => {
    const apply = (image: ProductImage) => {
      if (image.id !== imageId || image.upload?.attemptId !== attemptId) {
        return image;
      }
      const resolved = typeof patch === "function" ? patch(image) : patch;
      return resolved ? { ...image, ...resolved } : image;
    };
    imagesRef.current = normalizePrimary(imagesRef.current.map(apply));
    setDraft((current) => ({
      ...current,
      images: normalizePrimary(current.images.map(apply))
    }));
  };

  const scheduleAutoRetry = (item: UploadQueueItem, delayMs: number) => {
    clearRetryTimer(item.imageId);
    const timer = window.setTimeout(() => {
      retryTimersRef.current.delete(item.imageId);
      const image = draftImage(item.imageId);
      const upload = image?.upload;
      const file = filesRef.current.get(item.imageId);
      if (!upload || upload.attemptId !== item.attemptId || upload.status !== "failed" || !upload.retryable || !file) {
        return;
      }
      const attemptId = uid();
      const nextAttempt = upload.attempt + 1;
      updateImageAttempt(item.imageId, upload.attemptId, {
        upload: {
          attemptId,
          attempt: nextAttempt,
          clientFileId: upload.clientFileId,
          idempotencyKey: upload.idempotencyKey,
          previewUrl: upload.previewUrl,
          status: "retrying",
          progress: 0,
          speedBytesPerSecond: 0,
          fileFingerprint: fileFingerprint(file)
        }
      });
      enqueueUpload({
        imageId: item.imageId,
        attemptId,
        file,
        clientFileId: upload.clientFileId,
        idempotencyKey: upload.idempotencyKey,
        previewUrl: upload.previewUrl,
        attempt: nextAttempt
      });
    }, delayMs);
    retryTimersRef.current.set(item.imageId, timer);
  };

  const clearRetryTimer = (imageId: string) => {
    const timer = retryTimersRef.current.get(imageId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      retryTimersRef.current.delete(imageId);
    }
  };

  const revokePreview = (previewUrl: string) => {
    if (previewsRef.current.delete(previewUrl)) {
      URL.revokeObjectURL(previewUrl);
    }
  };

  const isCurrentAttempt = (imageId: string, attemptId: string) => draftImage(imageId)?.upload?.attemptId === attemptId;

  useEffect(() => {
    const resumeRetryableUploads = () => {
      for (const image of imagesRef.current) {
        if (image.upload?.status === "failed" && image.upload.retryable) {
          retryRef.current(image.id);
        }
      }
    };
    window.addEventListener("online", resumeRetryableUploads);
    return () => window.removeEventListener("online", resumeRetryableUploads);
  }, []);

  const draftImage = (imageId: string) => imagesRef.current.find((image) => image.id === imageId);

  return (
    <div className="space-y-6">
      {hasVariantMediaControls && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-zinc-950">{t("productCreate.media.sameImageAsProduct")}</p>
            </div>
            <button
              aria-checked={sameImageAsProduct}
              aria-label={t("productCreate.media.sameImageAsProduct")}
              className={cx(
                "flex h-5 w-9 shrink-0 items-center rounded-full border p-0.5 transition focus:outline-none focus:ring-4 focus:ring-black/5",
                sameImageAsProduct ? "border-black bg-black" : "border-zinc-200 bg-zinc-100"
              )}
              onClick={() => updateSameImageAsProduct(!sameImageAsProduct)}
              role="switch"
              type="button"
            >
              <span
                className={cx(
                  "size-4 rounded-full bg-white shadow-sm transition-transform",
                  sameImageAsProduct ? "translate-x-4" : "translate-x-0"
                )}
              />
            </button>
          </div>
          {!sameImageAsProduct && (
            <div className="mt-3 flex justify-start sm:justify-end">
              <div className="grid w-full grid-cols-2 rounded-xl border border-zinc-200 bg-zinc-50 p-1 sm:w-auto" role="group" aria-label={t("productCreate.media.samePhotoForVariants")}>
                {(["PRODUCT", "VARIANT"] as const).map((scope) => (
                  <button
                    aria-pressed={activeMediaScope === scope}
                    className={cx(
                      "h-9 rounded-lg px-4 text-[12px] font-medium transition focus:outline-none focus:ring-2 focus:ring-zinc-950/5",
                      activeMediaScope === scope ? "bg-zinc-950 text-white shadow-sm" : "text-zinc-600 hover:text-zinc-950"
                    )}
                    key={scope}
                    onClick={() => updateMediaScope(scope)}
                    type="button"
                  >
                    {scope === "PRODUCT" ? t("productCreate.media.productPhotoScope") : t("productCreate.media.variantPhotoScope")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      <button
        className="group flex min-h-56 w-full flex-col items-center justify-center rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/70 p-6 text-center transition hover:border-zinc-500 hover:bg-zinc-50 focus:outline-none focus:ring-4 focus:ring-zinc-950/5"
        onClick={() => inputRef.current?.click()}
        onDragOver={(event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.currentTarget.classList.add("border-zinc-950", "bg-white");
        }}
        onDragLeave={(event) => {
          event.currentTarget.classList.remove("border-zinc-950", "bg-white");
        }}
        onDrop={(event: DragEvent<HTMLButtonElement>) => {
          event.preventDefault();
          event.currentTarget.classList.remove("border-zinc-950", "bg-white");
          void handleFiles(event.dataTransfer.files);
        }}
        type="button"
      >
        <span className="flex size-12 items-center justify-center rounded-2xl bg-white text-zinc-800 shadow-sm transition group-hover:scale-105">
          <ImagePlus size={22} />
        </span>
        <p className="mt-3 text-sm font-semibold text-zinc-950">{t("productCreate.media.dropImages")}</p>
        <p className="mt-1 text-xs font-normal text-zinc-500">{t("productCreate.media.fileRequirements", { count: maxImages })}</p>
        <p className="mt-3 text-[11px] font-medium text-zinc-500">{t("productCreate.media.uploadSummary", { uploaded: uploadedCount, pending: pendingCount })}</p>
      </button>
      <input
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/tiff,image/gif"
        className="hidden"
        multiple
        onChange={(event: ChangeEvent<HTMLInputElement>) => {
          if (event.target.files) {
            void handleFiles(event.target.files);
          }
          event.target.value = "";
        }}
        ref={inputRef}
        type="file"
      />

      {visibleImages.length > 0 && (
        <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd} sensors={sensors}>
          <SortableContext items={visibleImages.map((image) => image.id)}>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {visibleImages.map((image, index) => (
                <SortableImageTile
                  image={image}
                  index={index}
                  key={image.id}
                  onAbort={() => abortUpload(image.id)}
                  onPrimary={() => setPrimary(image.id)}
                  onRemove={() => remove(image.id)}
                  onReplace={(file) => replace(image.id, file)}
                  onRetry={() => retry(image.id)}
                  onToggleVariant={toggleVariant}
                  mediaScope={activeMediaScope}
                  variantOptions={variantOptions}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}

function SortableImageTile({
  image,
  index,
  onAbort,
  onPrimary,
  onRemove,
  onReplace,
  onRetry,
  onToggleVariant,
  mediaScope,
  variantOptions
}: {
  image: ProductImage;
  index: number;
  mediaScope: MediaScope;
  onAbort: () => void;
  onPrimary: () => void;
  onRemove: () => void;
  onReplace: (file: File) => void | Promise<void>;
  onRetry: () => void;
  onToggleVariant: (imageId: string, variantId: string) => void;
  variantOptions: VariantMediaOption[];
}) {
  const t = useTranslations("dashboard");
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: image.id });
  const upload = image.upload;
  const uploaded = Boolean(image.uploadAssetId);
  const failed = upload?.status === "failed" || upload?.status === "aborted";
  const active = upload?.status === "uploading" || upload?.status === "processing" || upload?.status === "retrying" || upload?.status === "queued";
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  const [imgError, setImgError] = useState(false);
  const bypassImageOptimization = isLocalPreviewUrl(image.url);
  useEffect(() => {
    // Reset error state when the URL changes (e.g. after a successful re-upload)
    setImgError(false);
  }, [image.url]);

  return (
    <article
      className={cx(
        "min-w-0 rounded-2xl border border-zinc-200 bg-white p-3 shadow-sm transition",
        isDragging && "scale-[0.98] border-zinc-400 shadow-lg"
      )}
      ref={setNodeRef}
      style={style}
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-xl border border-zinc-100 bg-zinc-100">
        {imgError ? (
          <div
            aria-label={image.name}
            className="flex h-full w-full items-center justify-center bg-zinc-100"
            role="img"
          >
            <div className="flex flex-col items-center gap-1.5 text-zinc-300">
              <ImageOff size={28} />
              <span className="text-[10px] font-medium">Image unavailable</span>
            </div>
          </div>
        ) : (
          <Image
            alt={image.name}
            className="object-cover"
            fill
            onError={() => setImgError(true)}
            sizes="(max-width: 640px) 50vw, 220px"
            src={image.url}
            unoptimized={bypassImageOptimization}
          />
        )}
        {image.isPrimary && (
          <span className="absolute left-2 top-2 inline-flex items-center gap-1 rounded-lg bg-zinc-950 px-2 py-1 text-[10px] font-medium text-white">
            <Star size={11} />
            {t("productCreate.media.primary")}
          </span>
        )}
        {active && (
          <div className="absolute inset-x-0 bottom-0 bg-white/90 p-2 backdrop-blur">
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-200">
              <div className="h-full rounded-full bg-zinc-950 transition-all" style={{ width: `${upload?.progress ?? 0}%` }} />
            </div>
            <p className="mt-1 text-[10px] font-medium text-zinc-600">
              {t(uploadStatusKey(upload?.status) as never)} {upload?.progress ?? 0}% {upload?.speedBytesPerSecond ? `- ${formatSpeed(upload.speedBytesPerSecond)}` : ""}
            </p>
          </div>
        )}
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2">
        <button
          aria-label={t("productCreate.media.reorderImage")}
          className="flex size-8 shrink-0 cursor-grab items-center justify-center rounded-lg border border-zinc-200 text-zinc-400 active:cursor-grabbing"
          type="button"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={14} />
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[11px] font-medium text-zinc-900">{index === 0 ? t("productCreate.media.coverPrefix") : ""}{image.name}</p>
          <p className={cx("mt-0.5 truncate text-[10px] font-medium", uploaded ? "text-emerald-700" : failed ? "text-rose-700" : "text-zinc-500")}>
            {uploaded ? t("productCreate.media.optimizedReady") : upload?.error ?? t(uploadStatusKey(upload?.status) as never)}
          </p>
        </div>
        {uploaded && <BadgeCheck className="shrink-0 text-emerald-600" size={15} />}
      </div>
      {mediaScope === "VARIANT" && imageScopeFor(image) === "VARIANT" && variantOptions.length > 0 && (
        <div className="mt-3">
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-zinc-400">{t("productCreate.media.variantAssignments")}</p>
          <div className="flex flex-wrap gap-1.5">
          {variantOptions.map((option) => {
            const selected = image.variantIds?.includes(option.id) || Boolean(option.sku && image.variantSkuIds?.includes(option.sku));
            return (
              <button
                className={cx(
                  "rounded-lg border px-2 py-1 text-[10px] font-medium transition",
                  selected ? "border-zinc-950 bg-zinc-950 text-white" : "border-zinc-200 bg-white text-zinc-600"
                )}
                key={option.id}
                onClick={() => onToggleVariant(image.id, option.id)}
                type="button"
              >
                {option.label}
              </button>
            );
          })}
          </div>
        </div>
      )}
      <div className="mt-3 grid grid-cols-4 gap-1.5">
        <IconButton label={t("productCreate.media.setPrimary")} onClick={onPrimary}>
          <Star size={13} />
        </IconButton>
        {failed ? (
          <IconButton label={t("productCreate.media.retryUpload")} onClick={onRetry}>
            <RefreshCcw size={13} />
          </IconButton>
        ) : active ? (
          <IconButton label={t("productCreate.media.cancelUpload")} onClick={onAbort}>
            <X size={13} />
          </IconButton>
        ) : (
          <IconButton label={t("productCreate.media.replaceImage")} onClick={() => replaceRef.current?.click()}>
            <CloudUpload size={13} />
          </IconButton>
        )}
        <IconButton label={t("productCreate.media.removeImage")} onClick={onRemove}>
          <Trash2 size={13} />
        </IconButton>
        <span className="flex size-10 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-500">
          {active ? <Loader2 className="animate-spin" size={13} /> : index + 1}
        </span>
      </div>
      <input
        accept="image/jpeg,image/png,image/webp,image/heic,image/heif,image/avif,image/tiff,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void onReplace(file);
          event.target.value = "";
        }}
        ref={replaceRef}
        type="file"
      />
    </article>
  );
}

async function validateFile(file: File): Promise<FileValidationIssue | null> {
  const name = displayFileName(file);
  if (file.size <= 0) {
    return { key: "productCreate.media.emptyFile", values: { name } };
  }
  if (file.size > maxBytes) {
    return { key: "productCreate.media.tooLarge", values: { name, size: 12 } };
  }
  if (file.type && !allowedTypes.has(file.type)) {
    return { key: "productCreate.media.unsupportedType", values: { name } };
  }
  const magicType = await sniffImageMimeType(file).catch(() => null);
  if (!magicType) {
    return { key: "productCreate.media.corruptImage", values: { name } };
  }
  if (!allowedTypes.has(magicType)) {
    return { key: "productCreate.media.unsupportedType", values: { name } };
  }
  return null;
}

function displayFileName(file: File) {
  return file.name.trim().slice(0, 180) || "image";
}

function fileFingerprint(file: File): FileFingerprint {
  return {
    name: displayFileName(file),
    size: file.size,
    lastModified: file.lastModified,
    type: file.type || "application/octet-stream"
  };
}

async function sniffImageMimeType(file: File): Promise<string | null> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (bytes.length < 12) {
    return null;
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return "image/png";
  }
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") {
    return "image/webp";
  }
  const gif = ascii(bytes, 0, 6);
  if (gif === "GIF87a" || gif === "GIF89a") {
    return "image/gif";
  }
  if (
    (bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00) ||
    (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a)
  ) {
    return "image/tiff";
  }
  if (ascii(bytes, 4, 8) === "ftyp") {
    const brands = `${ascii(bytes, 8, 12)} ${ascii(bytes, 16, Math.min(bytes.length, 64))}`;
    if (brands.includes("avif") || brands.includes("avis")) {
      return "image/avif";
    }
    if (/(heic|heix|hevc|hevx|mif1|msf1)/.test(brands)) {
      return "image/heic";
    }
  }
  return null;
}

function ascii(bytes: Uint8Array, start: number, end: number) {
  return String.fromCharCode(...bytes.slice(start, end));
}

function isActiveUploadStatus(status: NonNullable<ProductImage["upload"]>["status"]) {
  return status === "queued" || status === "validating" || status === "uploading" || status === "processing" || status === "retrying";
}

function translateFileIssue(t: ReturnType<typeof useTranslations<"dashboard">>, issue: FileValidationIssue) {
  if (issue.key === "productCreate.media.tooLarge") {
    return t(issue.key, issue.values);
  }
  return t(issue.key, issue.values);
}

function uploadErrorMessage(t: ReturnType<typeof useTranslations<"dashboard">>, error: unknown) {
  if (error instanceof ApiError && error.message.trim()) {
    return error.message;
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return t("productCreate.media.uploadFailed");
}

function normalizePrimary(images: ProductImage[]) {
  if (!images.length) return images;
  const primary = images.find((image) => image.isPrimary);
  if (primary) {
    return images;
  }
  return images.map((image, index) => ({ ...image, isPrimary: index === 0 }));
}

function mediaOptionsFromDraft(draft: ProductDraft): VariantMediaOption[] {
  return draft.variants.flatMap((variant, index) => {
    if (!isVisibleStockVariant(variant, draft, index)) {
      return [];
    }
    const sku = variant.sku.trim().toUpperCase();
    return [{
      id: variant.id,
      label: variant.name.trim() || sku || `Variant ${index + 1}`,
      sku: sku || undefined
    }];
  });
}

function variantImageAssignment(scope: MediaScope, options: VariantMediaOption[]) {
  if (scope !== "VARIANT" || options.length === 0) {
    return { variantIds: [], variantSkuIds: [] };
  }
  const firstOption = options[0];

  return {
    variantIds: [firstOption.id],
    variantSkuIds: firstOption.sku ? [firstOption.sku] : []
  };
}

function normalizeVariantImageAssignment(image: ProductImage, options: VariantMediaOption[]) {
  if (!options.length) {
    return image.variantIds?.length || image.variantSkuIds?.length
      ? { ...image, variantIds: [], variantSkuIds: [] }
      : image;
  }

  const validIds = new Set(options.map((option) => option.id));
  const skuToId = new Map(options.filter((option) => option.sku).map((option) => [option.sku as string, option.id]));
  const selectedIds = [
    ...(image.variantIds ?? []).filter((id) => validIds.has(id)),
    ...(image.variantSkuIds ?? []).map((sku) => skuToId.get(sku.toUpperCase())).filter((id): id is string => Boolean(id))
  ];
  const uniqueIds = Array.from(new Set(selectedIds));
  return withSelectedVariantIds(image, uniqueIds, options);
}

function withSelectedVariantIds(image: ProductImage, selectedIds: string[], options: VariantMediaOption[]) {
  const selected = new Set(selectedIds);
  const normalizedIds = options.filter((option) => selected.has(option.id)).map((option) => option.id);
  const normalizedSkus = options
    .filter((option) => selected.has(option.id) && option.sku)
    .map((option) => option.sku as string);

  if (sameStringList(image.variantIds ?? [], normalizedIds) && sameStringList(image.variantSkuIds ?? [], normalizedSkus)) {
    return image;
  }

  return {
    ...image,
    variantIds: normalizedIds,
    variantSkuIds: normalizedSkus
  };
}

function clearVariantAssignment(image: ProductImage) {
  return hasVariantAssignment(image)
    ? { ...image, variantIds: [], variantSkuIds: [] }
    : image;
}

function hasVariantAssignment(image: ProductImage) {
  return Boolean(image.variantIds?.length || image.variantSkuIds?.length);
}

function imageScopeFor(image: ProductImage): MediaScope {
  return image.imageScope ?? "PRODUCT";
}

function sameStringList(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isLocalPreviewUrl(value: string) {
  return value.startsWith("blob:") || value.startsWith("data:");
}

function formatSpeed(value: number) {
  if (value > 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.max(1, Math.round(value / 1024))} KB/s`;
}
