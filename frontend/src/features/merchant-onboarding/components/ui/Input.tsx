import { InputHTMLAttributes, forwardRef } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: string;
  label: string;
  dataField?: string;
  optional?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className = "", error, label, dataField, optional, ...props }, ref) => {
    return (
      <label className="block w-full">
        <div className="flex items-baseline">
          <span className="text-[13px] font-semibold text-zinc-900 tracking-tight">{label}</span>
          {optional && (
            <span className="ml-1 text-[13px] font-medium text-zinc-500">
              (Optional)
            </span>
          )}
        </div>
        <div className="relative mt-1.5">
          <input
            ref={ref}
            data-field={dataField}
            className={`
              flex h-11 w-full rounded-lg border bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm
              transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]
              placeholder:text-zinc-400
              focus:outline-none focus:ring-4
              ${
                error
                  ? "border-red-400 focus:border-red-600 focus:ring-red-600/10"
                  : "border-zinc-200 hover:border-zinc-300 focus:border-zinc-900 focus:ring-zinc-900/10"
              }
              ${className}
            `}
            {...props}
          />
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

Input.displayName = "Input";
