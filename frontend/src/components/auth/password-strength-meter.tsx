import { PasswordStrength } from "@/lib/auth-schemas";

const toneByScore = [
  "bg-rose-500",
  "bg-orange-500",
  "bg-amber-500",
  "bg-lime-500",
  "bg-emerald-600"
] as const;

export function PasswordStrengthMeter({ strength }: { strength: PasswordStrength }) {
  const fillPercent = strength.score >= 3 ? 100 : strength.percent;

  return (
    <div className="mt-2 w-full" aria-live="polite">
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
        <div
          className={`h-full rounded-full transition-all duration-200 ${toneByScore[strength.score]}`}
          style={{ width: `${fillPercent}%` }}
        />
      </div>
      <p className="mt-1 text-[11px] font-extrabold text-slate-600">
        Password strength: {strength.label}
      </p>
    </div>
  );
}
