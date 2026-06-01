import { Check } from "lucide-react";
import { cx } from "../../lib/dashboard-utils";

export interface ProductCreateStep {
  description: string;
  label: string;
}

export function ProductCreateDesktopProgress({
  canChangeStep,
  currentStep,
  onStepChange,
  steps
}: {
  canChangeStep?: (step: number) => boolean;
  currentStep: number;
  onStepChange: (step: number) => void;
  steps: ProductCreateStep[];
}) {
  return (
    <aside className="hidden w-[232px] shrink-0 border-r border-zinc-200 bg-zinc-50/70 p-4 lg:block">
      <div className="sticky top-4 space-y-1">
        {steps.map((step, index) => {
          const active = currentStep === index;
          const complete = currentStep > index;
          const disabled = canChangeStep ? !canChangeStep(index) : false;
          return (
            <button
              className={cx(
                "grid w-full grid-cols-[auto_minmax(0,1fr)] gap-3 rounded-xl p-3 text-left transition disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 focus:outline-none focus:ring-4 focus:ring-zinc-950/5",
                active ? "bg-zinc-950 text-white shadow-sm" : "text-zinc-600 hover:bg-white hover:text-zinc-950"
              )}
              disabled={disabled}
              key={step.label}
              onClick={() => onStepChange(index)}
              type="button"
            >
              <span
                className={cx(
                  "flex size-7 items-center justify-center rounded-lg text-[11px] font-semibold",
                  active && "bg-white/10 text-white",
                  complete && !active && "bg-emerald-50 text-emerald-700",
                  !active && !complete && "bg-zinc-200/70 text-zinc-600"
                )}
              >
                {complete ? <Check size={13} /> : index + 1}
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{step.label}</span>
                <span className={cx("mt-0.5 block text-[11px] font-normal leading-4", active ? "text-zinc-300" : "text-zinc-400")}>
                  {step.description}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </aside>
  );
}

export function ProductCreateMobileProgress({
  currentStep,
  steps
}: {
  canChangeStep?: (step: number) => boolean;
  currentStep: number;
  onStepChange: (step: number) => void;
  steps: ProductCreateStep[];
}) {
  const progress = `${((currentStep + 1) / steps.length) * 100}%`;

  return (
    <div className="shrink-0 bg-white lg:hidden">
      <div
        aria-label={`Step ${currentStep + 1} of ${steps.length}`}
        aria-valuemax={steps.length}
        aria-valuemin={1}
        aria-valuenow={currentStep + 1}
        className="h-0.5 w-full bg-zinc-100"
        role="progressbar"
      >
        <div className="h-full bg-zinc-950 transition-[width] duration-300 ease-out" style={{ width: progress }} />
      </div>
    </div>
  );
}
