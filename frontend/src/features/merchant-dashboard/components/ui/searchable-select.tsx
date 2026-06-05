"use client";

import { Check, ChevronDown, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cx } from "../../lib/dashboard-utils";

export type SearchableSelectOption = {
  value: string;
  label: string;
  description?: string;
  searchText?: string;
  disabled?: boolean;
  icon?: ReactNode;
};

type SearchableSelectProps = {
  label: string;
  value: string;
  options: SearchableSelectOption[];
  onChange: (value: string) => void;
  searchPlaceholder: string;
  emptyText: string;
  placeholder?: string;
  helperText?: string;
  className?: string;
  compact?: boolean;
  disabled?: boolean;
  error?: string;
};

export function SearchableSelect({
  className,
  compact = false,
  disabled = false,
  emptyText,
  error,
  helperText,
  label,
  onChange,
  options,
  placeholder,
  searchPlaceholder,
  value
}: SearchableSelectProps) {
  const id = useId();
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlightedValue, setHighlightedValue] = useState<string | null>(null);

  const selectedOption = options.find((option) => option.value === value);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const filteredOptions = useMemo(() => {
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) => {
      const haystack = [
        option.label,
        option.description,
        option.searchText,
        option.value
      ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }, [normalizedQuery, options]);
  const enabledOptions = useMemo(
    () => filteredOptions.filter((option) => !option.disabled),
    [filteredOptions]
  );

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const nextHighlighted =
      enabledOptions.find((option) => option.value === value) ??
      enabledOptions[0] ??
      null;
    setHighlightedValue(nextHighlighted?.value ?? null);
    const scrollIntoView = () => {
      rootRef.current?.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    };

    window.requestAnimationFrame(() => {
      scrollIntoView();
      searchRef.current?.focus();
    });
    window.setTimeout(scrollIntoView, 260);
  }, [enabledOptions, isOpen, value]);

  useEffect(() => {
    if (!isOpen) {
      setQuery("");
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  const closeAndFocusButton = () => {
    setIsOpen(false);
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  };

  const selectOption = (option: SearchableSelectOption) => {
    if (option.disabled) {
      return;
    }
    onChange(option.value);
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
      const option = enabledOptions.find((item) => item.value === highlightedValue);
      if (option) {
        selectOption(option);
      }
    }
  };

  const listboxId = `${id}-listbox`;
  const labelId = `${id}-label`;
  const helperId = helperText ? `${id}-helper` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [helperId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cx("relative", className)} data-auto-scroll-field ref={rootRef}>
      <label
        className={cx(
          "block",
          compact ? "text-[10px] font-semibold uppercase tracking-wider text-zinc-400" : "text-[13px] font-medium text-zinc-700"
        )}
        id={labelId}
      >
        {label}
      </label>
      <button
        aria-controls={isOpen ? listboxId : undefined}
        aria-describedby={describedBy}
        aria-expanded={isOpen}
        aria-invalid={Boolean(error)}
        aria-labelledby={labelId}
        aria-haspopup="listbox"
        className={cx(
          compact
            ? "mt-1 h-9 rounded-lg px-2.5 focus:ring-2"
            : "mt-2 h-10 rounded-xl px-3 focus:ring-4",
          "flex w-full items-center justify-between gap-3 border bg-white text-left text-[13px] font-normal text-zinc-950 outline-none transition focus:ring-zinc-950/5",
          error ? "border-rose-300 focus:border-rose-500" : "border-zinc-200 focus:border-zinc-950",
          disabled && "cursor-not-allowed bg-zinc-50 text-zinc-400"
        )}
        disabled={disabled}
        onClick={() => setIsOpen((current) => !current)}
        onKeyDown={handleButtonKeyDown}
        ref={buttonRef}
        role="combobox"
        type="button"
      >
        <span className={cx("min-w-0 flex-1 truncate", !selectedOption && "text-zinc-400")}>
          {selectedOption?.label ?? placeholder}
        </span>
        <ChevronDown className={cx("shrink-0 text-zinc-400 transition", isOpen && "rotate-180")} size={16} />
      </button>
      {helperText && (
        <p className="mt-1.5 text-[11px] font-normal leading-relaxed text-zinc-500" id={helperId}>
          {helperText}
        </p>
      )}
      {error && (
        <span className="mt-1 block text-[10px] font-medium leading-snug text-rose-600" id={errorId}>
          {error}
        </span>
      )}
      {isOpen && (
        <div
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl shadow-zinc-950/10"
          onKeyDown={handlePanelKeyDown}
        >
          <div className="border-b border-zinc-100 p-2">
            <div className="flex h-9 items-center gap-2 rounded-xl bg-zinc-50 px-3 ring-1 ring-inset ring-zinc-200 focus-within:bg-white focus-within:ring-zinc-950">
              <Search className="shrink-0 text-zinc-400" size={14} />
              <input
                aria-label={searchPlaceholder}
                className="min-w-0 flex-1 bg-transparent text-[13px] font-normal text-zinc-950 outline-none placeholder:text-zinc-400"
                onChange={(event) => setQuery(event.target.value)}
                placeholder={searchPlaceholder}
                ref={searchRef}
                value={query}
              />
            </div>
          </div>
          <div
            aria-labelledby={labelId}
            className="max-h-64 overflow-y-auto p-1 scrollbar-hide"
            id={listboxId}
            role="listbox"
          >
            {filteredOptions.length === 0 ? (
              <div className="px-3 py-4 text-center text-[12px] font-medium text-zinc-500">{emptyText}</div>
            ) : (
              filteredOptions.map((option) => {
                const isSelected = option.value === value;
                const isHighlighted = option.value === highlightedValue;
                return (
                  <button
                    aria-selected={isSelected}
                    className={cx(
                      "flex min-h-11 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition",
                      isHighlighted && "bg-zinc-100",
                      isSelected && "bg-zinc-950 text-white",
                      !isSelected && "text-zinc-950 hover:bg-zinc-100",
                      option.disabled && "cursor-not-allowed opacity-45"
                    )}
                    disabled={option.disabled}
                    key={option.value}
                    onClick={() => selectOption(option)}
                    onMouseEnter={() => !option.disabled && setHighlightedValue(option.value)}
                    role="option"
                    type="button"
                  >
                    {option.icon && <span className="shrink-0">{option.icon}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{option.label}</span>
                      {option.description && (
                        <span className={cx("mt-0.5 block truncate text-[11px] font-normal", isSelected ? "text-white/70" : "text-zinc-500")}>
                          {option.description}
                        </span>
                      )}
                    </span>
                    {isSelected && <Check className="shrink-0" size={15} />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
