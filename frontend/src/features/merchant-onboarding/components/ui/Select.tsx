import { Check, ChevronDown } from "lucide-react";
import {
  KeyboardEvent,
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState
} from "react";

export interface SelectProps {
  className?: string;
  dataField?: string;
  disabled?: boolean;
  error?: string;
  label: string;
  name?: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  placeholder?: string;
  value: string;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  (
    {
      className = "",
      dataField,
      disabled = false,
      error,
      label,
      name,
      onValueChange,
      options,
      placeholder = "Select...",
      value
    },
    ref
  ) => {
    const id = useId();
    const rootRef = useRef<HTMLDivElement | null>(null);
    const internalButtonRef = useRef<HTMLButtonElement | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [highlightedValue, setHighlightedValue] = useState<string | null>(value || null);

    const selectedOption = useMemo(
      () => options.find((option) => option.value === value),
      [options, value]
    );
    const enabledOptions = useMemo(() => options.filter((option) => option.value), [options]);
    const listboxId = `${id}-listbox`;
    const labelId = `${id}-label`;
    const errorId = error ? `${id}-error` : undefined;

    useEffect(() => {
      if (!isOpen) {
        return;
      }
      setHighlightedValue(value || enabledOptions[0]?.value || null);

      const handlePointerDown = (event: PointerEvent) => {
        if (!rootRef.current?.contains(event.target as Node)) {
          setIsOpen(false);
        }
      };

      document.addEventListener("pointerdown", handlePointerDown);
      return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [enabledOptions, isOpen, value]);

    const setButtonRef = (node: HTMLButtonElement | null) => {
      internalButtonRef.current = node;
      if (typeof ref === "function") {
        ref(node);
      } else if (ref) {
        ref.current = node;
      }
    };

    const closeAndFocusButton = () => {
      setIsOpen(false);
      window.requestAnimationFrame(() => internalButtonRef.current?.focus());
    };

    const selectOption = (nextValue: string) => {
      onValueChange(nextValue);
      closeAndFocusButton();
    };

    const moveHighlight = (direction: 1 | -1) => {
      if (enabledOptions.length === 0) {
        setHighlightedValue(null);
        return;
      }

      const currentIndex = enabledOptions.findIndex((option) => option.value === highlightedValue);
      const fallbackIndex = direction === 1 ? -1 : 0;
      const nextIndex = (currentIndex === -1 ? fallbackIndex : currentIndex) + direction;
      const wrappedIndex = (nextIndex + enabledOptions.length) % enabledOptions.length;
      setHighlightedValue(enabledOptions[wrappedIndex]?.value ?? null);
    };

    const handleButtonKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setIsOpen(true);
      }
    };

    const handlePanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeAndFocusButton();
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        moveHighlight(1);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        moveHighlight(-1);
        return;
      }
      if (event.key === "Home") {
        event.preventDefault();
        setHighlightedValue(enabledOptions[0]?.value ?? null);
        return;
      }
      if (event.key === "End") {
        event.preventDefault();
        setHighlightedValue(enabledOptions[enabledOptions.length - 1]?.value ?? null);
        return;
      }
      if (event.key === "Enter" && highlightedValue) {
        event.preventDefault();
        selectOption(highlightedValue);
      }
    };

    return (
      <div className={`relative block w-full ${className}`} ref={rootRef}>
        <span className="text-[13px] font-semibold tracking-tight text-zinc-900" id={labelId}>
          {label}
        </span>
        <button
          aria-controls={isOpen ? listboxId : undefined}
          aria-describedby={errorId}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          aria-invalid={Boolean(error)}
          aria-labelledby={labelId}
          className={`
            mt-1.5 flex h-11 w-full items-center justify-between gap-3 rounded-lg border bg-white px-3 py-2 text-left text-sm text-zinc-900 shadow-sm
            transition-all duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]
            focus:outline-none focus:ring-4
            ${
              error
                ? "border-red-400 focus:border-red-600 focus:ring-red-600/10"
                : "border-zinc-200 hover:border-zinc-300 focus:border-zinc-900 focus:ring-zinc-900/10"
            }
            ${disabled ? "cursor-not-allowed bg-zinc-50 text-zinc-400" : ""}
          `}
          data-field={dataField}
          disabled={disabled}
          onClick={() => setIsOpen((current) => !current)}
          onKeyDown={handleButtonKeyDown}
          ref={setButtonRef}
          role="combobox"
          type="button"
        >
          <span className={`min-w-0 flex-1 truncate ${selectedOption ? "" : "text-zinc-400"}`}>
            {selectedOption?.label ?? placeholder}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={`shrink-0 text-zinc-400 transition ${isOpen ? "rotate-180" : ""}`}
            size={16}
            strokeWidth={2.5}
          />
        </button>
        {name ? <input name={name} type="hidden" value={value} /> : null}
        {isOpen ? (
          <div
            className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-lg border border-zinc-200 bg-white p-1 shadow-2xl shadow-zinc-950/10"
            onKeyDown={handlePanelKeyDown}
          >
            <div
              aria-labelledby={labelId}
              className="max-h-64 overflow-y-auto"
              id={listboxId}
              role="listbox"
            >
              {enabledOptions.map((option) => {
                const isSelected = option.value === value;
                const isHighlighted = option.value === highlightedValue;
                return (
                  <button
                    aria-selected={isSelected}
                    className={`
                      flex min-h-10 w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm font-semibold transition
                      ${
                        isSelected
                          ? "bg-black text-white"
                          : isHighlighted
                            ? "bg-zinc-100 text-zinc-950"
                            : "text-zinc-950 hover:bg-zinc-100"
                      }
                    `}
                    key={option.value}
                    onClick={() => selectOption(option.value)}
                    onMouseEnter={() => setHighlightedValue(option.value)}
                    role="option"
                    type="button"
                  >
                    <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    {isSelected ? <Check aria-hidden="true" className="shrink-0" size={15} /> : null}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        {error && (
          <span className="mt-1.5 block animate-in fade-in slide-in-from-top-1 text-xs font-medium text-red-600" id={errorId}>
            {error}
          </span>
        )}
      </div>
    );
  }
);

Select.displayName = "Select";
