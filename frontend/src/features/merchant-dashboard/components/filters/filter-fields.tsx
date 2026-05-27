export interface FilterOption {
  label: string;
  value: string;
}

export function FilterSelect({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  value: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">{label}</span>
      <select
        aria-label={label}
        className="mt-1.5 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-900 outline-none transition focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function FilterInput({
  label,
  onChange,
  placeholder,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  placeholder: string;
  value: string;
}) {
  return (
    <label className="block min-w-0">
      <span className="text-[10px] font-semibold uppercase tracking-[0.08em] text-zinc-400">{label}</span>
      <input
        aria-label={label}
        className="mt-1.5 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-medium tabular-nums text-zinc-900 outline-none transition placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5"
        min={0}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        type="number"
        value={value}
      />
    </label>
  );
}
