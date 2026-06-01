"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import {
  beforeLocaleSwitchEvent,
  clearOnboardingLocaleSnapshot,
  readOnboardingLocaleSnapshot,
  writeOnboardingLocaleSnapshot,
  type OnboardingLocaleSnapshot
} from "@/i18n/onboarding-snapshot";
import { useToast } from "@/components/toast/toast-context";
import { isAbortError } from "@/lib/abort";
import { ApiError } from "@/lib/api";
import {
  attachStoreMedia,
  completeOnboardingStep,
  createMediaSignature,
  fetchOnboarding,
  launchOnboarding,
  OnboardingBootstrap,
  OnboardingPayload,
  OnboardingStep,
  saveOnboardingDraft,
  ValidationIssue
} from "@/lib/merchant-onboarding-api";
import {
  DEFAULT_BUSINESS_HOURS,
  normalizeBusinessHours,
  record
} from "../onboarding-utils";
import { validateStepPayload } from "../onboarding-schemas";

const STORAGE_KEY = "namastore:merchant-onboarding-draft:v2";
const LOCAL_DRAFT_WRITE_DELAY_MS = 500;
const SERVER_AUTO_SAVE_DELAY_MS = 2000;

const STEP_COMPLETION: Record<Exclude<OnboardingStep, "REVIEW">, { nextStep: OnboardingStep; lifecycle: OnboardingBootstrap["state"]["lifecycle"]; completionPercent: number }> = {
  BUSINESS: { nextStep: "BRANDING", lifecycle: "BUSINESS_DONE", completionPercent: 17 },
  BRANDING: { nextStep: "LEGAL", lifecycle: "BRANDING_DONE", completionPercent: 33 },
  LEGAL: { nextStep: "LOCATION", lifecycle: "LEGAL_DONE", completionPercent: 50 },
  LOCATION: { nextStep: "PREFERENCES", lifecycle: "LOCATION_DONE", completionPercent: 67 },
  PREFERENCES: { nextStep: "REVIEW", lifecycle: "PREFS_DONE", completionPercent: 83 }
};
const MEDIA_LIMITS = {
  LOGO: { maxBytes: 3 * 1024 * 1024, minWidth: 128, minHeight: 128 },
  BANNER: { maxBytes: 6 * 1024 * 1024, minWidth: 0, minHeight: 0 }
} as const;
const ALLOWED_MEDIA_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type StepValues = Record<OnboardingStep, OnboardingPayload>;
type DraftVersions = Partial<Record<OnboardingStep, number>>;
type SavingState = "idle" | "saving" | "saved" | "error";
type DraftSaveSource = "auto" | "manual";
type DraftSaveOutcome =
  | { status: "saved"; step: OnboardingStep; version: number }
  | { status: "aborted"; step: OnboardingStep }
  | { status: "failed"; step: OnboardingStep; issues: ValidationIssue[] };

export type UploadState = Partial<Record<"LOGO" | "BANNER", "idle" | "uploading" | "error">>;

const blankValues: StepValues = {
  BUSINESS: {},
  BRANDING: {},
  LEGAL: {},
  LOCATION: {},
  PREFERENCES: {},
  REVIEW: {}
};

export function useOnboarding() {
  const router = useRouter();
  const toast = useToast();
  const t = useTranslations("onboarding");

  const [bootstrap, setBootstrap] = useState<OnboardingBootstrap | null>(null);
  const [values, setValues] = useState<StepValues>(blankValues);
  const [, setVersions] = useState<DraftVersions>({});
  const [currentStep, setCurrentStepState] = useState<OnboardingStep>("BUSINESS");
  const [loading, setLoading] = useState(true);
  const [redirecting, setRedirecting] = useState(false);
  const [savingState, setSavingState] = useState<SavingState>("idle");
  const [submitting] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const [errors, setErrors] = useState<ValidationIssue[]>([]);
  const [uploadState, setUploadState] = useState<UploadState>({});

  const bootstrapRef = useRef<OnboardingBootstrap | null>(null);
  const valuesRef = useRef<StepValues>(blankValues);
  const versionsRef = useRef<DraftVersions>({});
  const currentStepRef = useRef<OnboardingStep>("BUSINESS");
  const localGeneration = useRef(0);
  const localeSnapshot = useRef<OnboardingLocaleSnapshot | null>(null);

  const localDraftTimer = useRef<number | null>(null);
  const pendingLocalDraft = useRef<StepValues | null>(null);
  const autoSaveTimer = useRef<number | null>(null);
  const pendingAutoSave = useRef<{ step: OnboardingStep; values: StepValues } | null>(null);
  const draftSaveAbort = useRef<AbortController | null>(null);
  const draftSavePromise = useRef<Promise<DraftSaveOutcome> | null>(null);
  const draftSaveStep = useRef<OnboardingStep | null>(null);
  const submitAbort = useRef<AbortController | null>(null);
  const launchAbort = useRef<AbortController | null>(null);
  const completionQueue = useRef<Promise<void>>(Promise.resolve());
  const failedCompletion = useRef<{ step: OnboardingStep; issues: ValidationIssue[] } | null>(null);

  const currentErrors = useMemo(() => fieldErrors(errors), [errors]);

  const setCurrentStep = useCallback((step: OnboardingStep) => {
    currentStepRef.current = step;
    setCurrentStepState(step);
  }, []);

  const setBootstrapValue = useCallback((next: OnboardingBootstrap | null) => {
    bootstrapRef.current = next;
    setBootstrap(next);
  }, []);

  const updateBootstrapValue = useCallback((updater: (current: OnboardingBootstrap) => OnboardingBootstrap) => {
    setBootstrap((current) => {
      if (!current) return current;
      const next = updater(current);
      bootstrapRef.current = next;
      return next;
    });
  }, []);

  const setVersionForStep = useCallback((step: OnboardingStep, version: number) => {
    versionsRef.current = { ...versionsRef.current, [step]: version };
    setVersions(versionsRef.current);
  }, []);

  const clearLocalDraftTimer = useCallback(() => {
    if (localDraftTimer.current) {
      window.clearTimeout(localDraftTimer.current);
      localDraftTimer.current = null;
    }
  }, []);

  const flushLocalDraft = useCallback((override?: StepValues) => {
    clearLocalDraftTimer();
    const next = override ?? pendingLocalDraft.current ?? valuesRef.current;
    pendingLocalDraft.current = null;
    writeLocalDraft(next);
  }, [clearLocalDraftTimer]);

  const scheduleLocalDraftWrite = useCallback((next: StepValues) => {
    pendingLocalDraft.current = next;
    clearLocalDraftTimer();
    localDraftTimer.current = window.setTimeout(() => flushLocalDraft(), LOCAL_DRAFT_WRITE_DELAY_MS);
  }, [clearLocalDraftTimer, flushLocalDraft]);

  const commitValues = useCallback((next: StepValues, persistence: "debounced" | "immediate" | "none" = "debounced") => {
    valuesRef.current = next;
    setValues(next);
    if (persistence === "immediate") {
      flushLocalDraft(next);
    } else if (persistence === "debounced") {
      scheduleLocalDraftWrite(next);
    }
  }, [flushLocalDraft, scheduleLocalDraftWrite]);

  const commitVersions = useCallback((next: DraftVersions) => {
    versionsRef.current = next;
    setVersions(next);
  }, []);

  const saveDraftSnapshot = useCallback(async (
    step: OnboardingStep,
    snapshot: StepValues,
    controller: AbortController,
    clientGeneration: number,
    source: DraftSaveSource
  ): Promise<DraftSaveOutcome> => {
    if (!bootstrapRef.current || step === "REVIEW") {
      return { status: "aborted", step };
    }

    setSavingState("saving");
    const payload = materializeStepPayload(step, snapshot[step]);

    try {
      const draft = await saveOnboardingDraft(
        step,
        { payload, version: versionsRef.current[step] },
        { signal: controller.signal }
      );
      if (controller.signal.aborted) {
        return { status: "aborted", step };
      }

      setVersionForStep(step, draft.version);
      if (clientGeneration === localGeneration.current) {
        setSavingState("saved");
      }
      return { status: "saved", step, version: draft.version };
    } catch (error) {
      if (isAbortError(error)) {
        return { status: "aborted", step };
      }

      const issues = issuesFromError(error);
      if (clientGeneration === localGeneration.current || source === "manual") {
        setSavingState("error");
      }
      if (source === "manual") {
        setErrors(issues);
        focusFirstInvalid(issues[0]?.path);
      }
      return { status: "failed", step, issues };
    }
  }, [setVersionForStep]);

  const startDraftSave = useCallback((step: OnboardingStep, snapshot: StepValues, source: DraftSaveSource) => {
    draftSaveAbort.current?.abort();
    const controller = new AbortController();
    const clientGeneration = localGeneration.current;
    draftSaveAbort.current = controller;
    draftSaveStep.current = step;

    const promise = saveDraftSnapshot(step, snapshot, controller, clientGeneration, source)
      .finally(() => {
        if (draftSaveAbort.current === controller) {
          draftSaveAbort.current = null;
          draftSavePromise.current = null;
          draftSaveStep.current = null;
        }
      });

    draftSavePromise.current = promise;
    return promise;
  }, [saveDraftSnapshot]);

  const clearPendingAutoSave = useCallback((step?: OnboardingStep) => {
    if (step && pendingAutoSave.current?.step !== step) {
      return;
    }
    if (autoSaveTimer.current) {
      window.clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    pendingAutoSave.current = null;
  }, []);

  const scheduleAutoSave = useCallback((step: OnboardingStep, next: StepValues) => {
    if (!bootstrapRef.current || step === "REVIEW") {
      return;
    }
    clearPendingAutoSave();
    pendingAutoSave.current = { step, values: next };
    autoSaveTimer.current = window.setTimeout(() => {
      const pending = pendingAutoSave.current;
      pendingAutoSave.current = null;
      autoSaveTimer.current = null;
      if (pending) {
        void startDraftSave(pending.step, pending.values, "auto");
      }
    }, SERVER_AUTO_SAVE_DELAY_MS);
  }, [clearPendingAutoSave, startDraftSave]);

  const cancelDraftSaveForStep = useCallback(async (step: OnboardingStep) => {
    clearPendingAutoSave(step);
    if (draftSaveStep.current !== step || !draftSavePromise.current) {
      return null;
    }

    draftSaveAbort.current?.abort();
    return draftSavePromise.current.catch((): DraftSaveOutcome => ({ status: "aborted", step }));
  }, [clearPendingAutoSave]);

  const flushAnyPendingDraftSave = useCallback(async () => {
    if (pendingAutoSave.current) {
      const pending = pendingAutoSave.current;
      clearPendingAutoSave();
      const outcome = await startDraftSave(pending.step, pending.values, "auto");
      if (outcome.status === "failed") {
        return outcome;
      }
    }

    if (draftSavePromise.current) {
      const outcome = await draftSavePromise.current;
      if (outcome.status === "failed") {
        return outcome;
      }
    }

    return null;
  }, [clearPendingAutoSave, startDraftSave]);

  useEffect(() => {
    const snapshot = readOnboardingLocaleSnapshot();
    if (!snapshot) {
      return;
    }
    localeSnapshot.current = snapshot;
    commitValues(snapshot.values, "immediate");
    setCurrentStep(snapshot.currentStep);
    toast.success(t("helper.snapshotRestored"));
  }, [commitValues, setCurrentStep, t, toast]);

  useEffect(() => {
    const snapshotBeforeSwitch = () => {
      writeOnboardingLocaleSnapshot({
        currentStep: currentStepRef.current,
        values: valuesRef.current
      });
      flushLocalDraft(valuesRef.current);
      const activeStep = currentStepRef.current;
      if (activeStep !== "REVIEW" && bootstrapRef.current) {
        void startDraftSave(activeStep, valuesRef.current, "auto");
      }
    };

    window.addEventListener(beforeLocaleSwitchEvent, snapshotBeforeSwitch);
    return () => window.removeEventListener(beforeLocaleSwitchEvent, snapshotBeforeSwitch);
  }, [flushLocalDraft, startDraftSave]);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;

    fetchOnboarding({ signal: controller.signal })
      .then((payload) => {
        if (!active) return;
        if (shouldLeaveOnboarding(payload)) {
          setRedirecting(true);
          localStorage.removeItem(STORAGE_KEY);
          router.replace("/merchant/dashboard");
          return;
        }
        const snapshot = localeSnapshot.current;
        const local = readLocalDraft();
        const merged = mergeBootstrapValues(payload, snapshot?.values ?? local?.values);
        const nextVersions = draftVersions(payload);
        setBootstrapValue(payload);
        commitValues(merged, "immediate");
        commitVersions(nextVersions);
        setCurrentStep(snapshot?.currentStep ?? payload.state.currentStep);
        if (snapshot) {
          localeSnapshot.current = null;
          clearOnboardingLocaleSnapshot();
        }
      })
      .catch((error) => {
        if (!active || isAbortError(error)) return;
        if (error instanceof ApiError && error.status === 401) {
          setRedirecting(true);
          router.replace("/auth/login");
          return;
        }
        if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
          setRedirecting(true);
          router.replace("/");
          return;
        }
        setErrors([{ path: "form", message: error instanceof Error ? error.message : "Unable to load onboarding." }]);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [commitValues, commitVersions, router, setBootstrapValue, setCurrentStep]);

  useEffect(() => {
    return () => {
      clearLocalDraftTimer();
      clearPendingAutoSave();
      draftSaveAbort.current?.abort();
      submitAbort.current?.abort();
      launchAbort.current?.abort();
    };
  }, [clearLocalDraftTimer, clearPendingAutoSave]);

  const updateValue = useCallback((step: OnboardingStep, field: string, value: unknown) => {
    localGeneration.current += 1;
    setErrors((current) => current.filter((issue) => issue.path !== field));
    setSavingState((current) => (current === "idle" ? current : "idle"));
    setValues((current) => {
      const next = {
        ...current,
        [step]: {
          ...current[step],
          [field]: value
        }
      };
      valuesRef.current = next;
      scheduleLocalDraftWrite(next);
      scheduleAutoSave(step, next);
      return next;
    });
  }, [scheduleAutoSave, scheduleLocalDraftWrite]);

  const saveCurrentDraft = async () => {
    const activeStep = currentStepRef.current;
    if (!bootstrapRef.current || activeStep === "REVIEW" || savingState === "saving" || submitting || launching) {
      return;
    }

    clearPendingAutoSave(activeStep);
    flushLocalDraft(valuesRef.current);
    const outcome = await startDraftSave(activeStep, valuesRef.current, "manual");
    if (outcome.status === "saved") {
      toast.success("Draft saved.");
    } else if (outcome.status === "failed") {
      toast.error(outcome.issues[0]?.message ?? "Draft save failed.");
    }
  };

  const completeCurrentStep = async () => {
    const activeBootstrap = bootstrapRef.current;
    const activeStep = currentStepRef.current;
    if (!activeBootstrap || !activeBootstrap.rules || activeStep === "REVIEW" || launching) return;

    const rules = activeBootstrap.rules;
    const payload = materializeStepPayload(activeStep, valuesRef.current[activeStep]);
    const nextValues = { ...valuesRef.current, [activeStep]: payload };
    const localIssues = validateStepPayload(activeStep, payload, rules);

    if (localIssues.length) {
      setErrors(localIssues);
      focusFirstInvalid(localIssues[0]?.path);
      return;
    }

    const optimistic = STEP_COMPLETION[activeStep as Exclude<OnboardingStep, "REVIEW">];
    if (!optimistic) return;

    failedCompletion.current = failedCompletion.current?.step === activeStep ? null : failedCompletion.current;
    localGeneration.current += 1;
    setErrors([]);
    commitValues(nextValues, "immediate");
    setCurrentStep(optimistic.nextStep);
    updateBootstrapValue((current) => ({
      ...current,
      state: {
        ...current.state,
        lifecycle: optimistic.lifecycle,
        currentStep: optimistic.nextStep,
        completionPercent: Math.max(current.state.completionPercent, optimistic.completionPercent)
      }
    }));

    const controller = new AbortController();
    submitAbort.current = controller;
    setSavingState("saving");

    const completionTask = completionQueue.current
      .catch(() => undefined)
      .then(async () => {
        await cancelDraftSaveForStep(activeStep);
        const result = await completeOnboardingStep(
          activeStep,
          { payload, version: versionsRef.current[activeStep] },
          { signal: controller.signal }
        );
        if (controller.signal.aborted) return;

        setVersionForStep(activeStep, result.draft.version);
        updateBootstrapValue((current) => ({
          ...current,
          state: result.state,
          rules: result.rules ?? current.rules
        }));
        failedCompletion.current = null;
        clearOnboardingLocaleSnapshot();
        setSavingState("saved");
      })
      .catch((error) => {
        if (isAbortError(error)) return;
        const issues = issuesFromError(error);
        failedCompletion.current = { step: activeStep, issues };
        setSavingState("error");
        toast.error(issues[0]?.message ?? "We could not save that step. You can keep editing while we retry on submit.");
      })
      .finally(() => {
        if (submitAbort.current === controller) {
          submitAbort.current = null;
        }
      });

    completionQueue.current = completionTask;
    void completionTask;
  };

  const handleLaunch = async () => {
    if (launching) return;
    setLaunching(true);
    setErrors([]);

    const controller = new AbortController();
    launchAbort.current = controller;

    try {
      await completionQueue.current.catch(() => undefined);
      const draftFailure = await flushAnyPendingDraftSave();
      const completionFailure = failedCompletion.current;

      if (draftFailure?.status === "failed" || completionFailure) {
        const issues = draftFailure?.status === "failed"
          ? draftFailure.issues
          : completionFailure?.issues ?? [{ path: "form", message: "Finish saving the previous onboarding step before submitting." }];
        setErrors(issues);
        toast.error(issues[0]?.message ?? "Finish saving your changes before submitting.");
        focusFirstInvalid(issues[0]?.path);
        return;
      }

      const result = await launchOnboarding({ signal: controller.signal });
      localStorage.removeItem(STORAGE_KEY);
      clearOnboardingLocaleSnapshot();
      if (result.status === "ACTIVE") {
        router.replace(result.redirectTo);
        return;
      }
      setLaunched(true);
      window.setTimeout(() => router.replace(result.redirectTo), 1200);
    } catch (error) {
      if (isAbortError(error)) return;
      const issues = issuesFromError(error);
      setErrors(issues);
      toast.error(issues[0]?.message ?? "Launch failed.");
      focusFirstInvalid(issues[0]?.path);
    } finally {
      if (launchAbort.current === controller) {
        launchAbort.current = null;
      }
      setLaunching(false);
    }
  };

  const uploadAsset = async (kind: "LOGO" | "BANNER", file: File) => {
    if (!file) return;
    const fileIssue = validateMediaFile(kind, file);
    if (fileIssue) {
      setErrors([fileIssue]);
      setUploadState((current) => ({ ...current, [kind]: "error" }));
      toast.error(fileIssue.message);
      return;
    }

    setUploadState((current) => ({ ...current, [kind]: "uploading" }));
    try {
      const dimensions = await imageDimensions(file);
      const dimensionIssue = validateMediaDimensions(kind, dimensions);
      if (dimensionIssue) {
        throw new Error(dimensionIssue.message);
      }
      const signature = await createMediaSignature({
        kind,
        fileName: file.name,
        mimeType: file.type,
        byteSize: file.size,
        ...dimensions
      });
      if (!signature.cloudName || !signature.apiKey) {
        throw new Error("Upload provider is not configured.");
      }
      const upload = await uploadToCloudinary(file, signature);
      const media = await attachStoreMedia({
        kind,
        providerPublicId: upload.public_id,
        url: upload.secure_url,
        mimeType: file.type,
        byteSize: upload.bytes ?? file.size,
        width: upload.width ?? dimensions.width,
        height: upload.height ?? dimensions.height
      });
      updateValue("BRANDING", kind === "LOGO" ? "logoUrl" : "bannerUrl", media.url);
      updateValue("BRANDING", kind === "LOGO" ? "logoMediaId" : "bannerMediaId", media.id);
      setUploadState((current) => ({ ...current, [kind]: "idle" }));
    } catch (error) {
      setUploadState((current) => ({ ...current, [kind]: "error" }));
      setErrors([{ path: kind.toLowerCase(), message: error instanceof Error ? error.message : "Upload failed." }]);
    }
  };

  return {
    bootstrap,
    values,
    currentStep,
    loading,
    redirecting,
    savingState,
    submitting,
    launching,
    launched,
    errors,
    currentErrors,
    uploadState,
    setCurrentStep,
    setErrors,
    updateValue,
    saveCurrentDraft,
    completeCurrentStep,
    handleLaunch,
    uploadAsset
  };
}

function mergeBootstrapValues(payload: OnboardingBootstrap, local?: StepValues | null): StepValues {
  const server: StepValues = {
    BUSINESS: { ...payload.data.business, ...(payload.drafts.BUSINESS?.payload ?? {}) },
    BRANDING: { ...payload.data.branding, ...(payload.drafts.BRANDING?.payload ?? {}) },
    LEGAL: { ...payload.data.legal, ...(payload.drafts.LEGAL?.payload ?? {}) },
    LOCATION: { ...payload.data.location, ...(payload.drafts.LOCATION?.payload ?? {}) },
    PREFERENCES: materializeStepPayload("PREFERENCES", { ...payload.data.preferences, ...(payload.drafts.PREFERENCES?.payload ?? {}) }),
    REVIEW: {}
  };
  return local
    ? {
        BUSINESS: { ...server.BUSINESS, ...local.BUSINESS },
        BRANDING: { ...server.BRANDING, ...local.BRANDING },
        LEGAL: { ...server.LEGAL, ...local.LEGAL },
        LOCATION: { ...server.LOCATION, ...local.LOCATION },
        PREFERENCES: materializeStepPayload("PREFERENCES", { ...server.PREFERENCES, ...local.PREFERENCES }),
        REVIEW: {}
      }
    : server;
}

function materializeStepPayload(step: OnboardingStep, payload: OnboardingPayload): OnboardingPayload {
  if (step !== "PREFERENCES") {
    return payload;
  }

  return {
    ...payload,
    businessHours: normalizeBusinessHours({
      ...DEFAULT_BUSINESS_HOURS,
      ...record(payload.businessHours)
    })
  };
}

function draftVersions(payload: OnboardingBootstrap): DraftVersions {
  return Object.fromEntries(Object.entries(payload.drafts).map(([step, draft]) => [step, draft?.version])) as DraftVersions;
}

function writeLocalDraft(values: StepValues) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ values, updatedAt: Date.now() }));
  } catch {
    // Local persistence is best-effort; server drafts remain authoritative.
  }
}

function shouldLeaveOnboarding(payload: OnboardingBootstrap) {
  return (
    ["APPROVAL_PENDING", "ACTIVE", "SUSPENDED", "LAUNCHED"].includes(payload.state.lifecycle) ||
    ["APPROVED", "REJECTED", "SUSPENDED"].includes(payload.store.status)
  );
}

function readLocalDraft(): { values: StepValues; updatedAt: number } | null {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    return value ? (JSON.parse(value) as { values: StepValues; updatedAt: number }) : null;
  } catch {
    return null;
  }
}

function fieldErrors(errors: ValidationIssue[]) {
  return Object.fromEntries(errors.map((issue) => [issue.path, issue.message]));
}

function focusFirstInvalid(path?: string) {
  if (!path) return;
  window.requestAnimationFrame(() => {
    const target = document.querySelector<HTMLElement>(`[data-field="${path}"]`);
    target?.focus();
  });
}

function issuesFromError(error: unknown): ValidationIssue[] {
  if (error instanceof ApiError && error.body && typeof error.body === "object" && "errors" in error.body) {
    const body = error.body as { errors?: unknown };
    if (Array.isArray(body.errors)) {
      return body.errors.filter((item): item is ValidationIssue => Boolean(item) && typeof item === "object" && "path" in item && "message" in item);
    }
  }
  return [{ path: "form", message: error instanceof Error ? error.message : "Something went wrong." }];
}

function validateMediaFile(kind: "LOGO" | "BANNER", file: File): ValidationIssue | null {
  const path = kind.toLowerCase();
  if (!ALLOWED_MEDIA_MIME_TYPES.has(file.type)) {
    return { path, message: "Only PNG, JPEG, and WebP images are allowed." };
  }

  const limit = MEDIA_LIMITS[kind];
  if (file.size > limit.maxBytes) {
    return { path, message: `${kind === "LOGO" ? "Logo" : "Banner"} image must be ${formatBytes(limit.maxBytes)} or smaller.` };
  }

  return null;
}

function validateMediaDimensions(
  kind: "LOGO" | "BANNER",
  dimensions: { width?: number; height?: number }
): ValidationIssue | null {
  const limit = MEDIA_LIMITS[kind];
  const label = kind === "LOGO" ? "Logo" : "Banner";
  const path = kind.toLowerCase();
  if (limit.minWidth > 0 && dimensions.width && dimensions.width < limit.minWidth) {
    return { path, message: `${label} image must be at least ${limit.minWidth}px wide.` };
  }
  if (limit.minHeight > 0 && dimensions.height && dimensions.height < limit.minHeight) {
    return { path, message: `${label} image must be at least ${limit.minHeight}px tall.` };
  }
  return null;
}

function formatBytes(value: number) {
  return `${Math.round(value / (1024 * 1024))}MB`;
}

async function imageDimensions(file: File): Promise<{ width?: number; height?: number }> {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    const loaded = new Promise<{ width: number; height: number }>((resolve, reject) => {
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => reject(new Error("Image could not be read."));
    });
    image.src = url;
    return await loaded;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function uploadToCloudinary(
  file: File,
  signature: {
    cloudName?: string;
    apiKey?: string;
    folder: string;
    timestamp: number;
    signature: string;
  }
): Promise<{ public_id: string; secure_url: string; bytes?: number; width?: number; height?: number }> {
  const form = new FormData();
  form.append("file", file);
  form.append("api_key", signature.apiKey ?? "");
  form.append("timestamp", String(signature.timestamp));
  form.append("signature", signature.signature);
  form.append("folder", signature.folder);

  const response = await fetch(`https://api.cloudinary.com/v1_1/${signature.cloudName}/image/upload`, {
    method: "POST",
    body: form
  });
  const body = (await response.json()) as { public_id?: string; secure_url?: string; bytes?: number; width?: number; height?: number; error?: { message?: string } };
  if (!response.ok || !body.public_id || !body.secure_url) {
    throw new Error(body.error?.message ?? "Image upload failed.");
  }
  return {
    public_id: body.public_id,
    secure_url: body.secure_url,
    bytes: body.bytes,
    width: body.width,
    height: body.height
  };
}
