import { SelectHTMLAttributes, forwardRef } from "react";
import { ChevronDown } from "lucide-react";

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  error?: string;
  label: string;
  options: Array<{ value: string; label: string }>;
  dataField?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className = "", error, label, options, dataField, ...props }, ref) => {
    return (
      <label className="block w-full">
        <span className="text-[13px] font-semibold text-zinc-900 tracking-tight">{label}</span>
        <div className="relative mt-1.5">
          <select
            ref={ref}
            data-field={dataField}
            className={`
              appearance-none flex h-11 w-full rounded-lg border bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm
              transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]
              focus:outline-none focus:ring-4
              ${
                error
                  ? "border-red-400 focus:border-red-600 focus:ring-red-600/10"
                  : "border-zinc-200 hover:border-zinc-300 focus:border-zinc-900 focus:ring-zinc-900/10"
              }
              ${className}
            `}
            {...props}
          >
            <option value="" disabled hidden>
              Select...
            </option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <div className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400">
            <ChevronDown size={16} strokeWidth={2.5} />
          </div>
        </div>
        {error && (
          <span className="mt-1.5 block text-xs font-medium text-red-600 animate-in fade-in slide-in-from-top-1">
            {error}
          </span>
        )}
      </label>
    );
  }
);

Select.displayName = "Select";
