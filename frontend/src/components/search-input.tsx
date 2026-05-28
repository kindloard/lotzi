"use client";

import { Search } from "lucide-react";
import { useEffect, useState, useRef } from "react";

export function SearchInput({
  initialValue,
  shopName,
  onSearch,
}: {
  initialValue?: string | null;
  shopName: string;
  onSearch: (value: string) => void;
}) {
  const [value, setValue] = useState(initialValue ?? "");
  const [isFocused, setIsFocused] = useState(false);
  
  // Use a ref to store the latest onSearch callback to avoid dependency loops
  const onSearchRef = useRef(onSearch);
  useEffect(() => {
    onSearchRef.current = onSearch;
  }, [onSearch]);

  // Update local value if initialValue changes externally
  useEffect(() => {
    if (initialValue !== undefined && initialValue !== null) {
      setValue(initialValue);
    }
  }, [initialValue]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      // Only trigger if the value has actually changed from the initial value
      if (value !== (initialValue ?? "")) {
        onSearchRef.current(value);
      }
    }, 500); // 500ms debounce
    return () => window.clearTimeout(timer);
  }, [value, initialValue]);

  return (
    <label 
      className={`relative flex min-h-12 flex-1 items-center rounded-full border transition-all duration-200 ${
        isFocused 
          ? "border-indigo-500 bg-white shadow-[0_0_0_4px_rgba(99,102,241,0.1)]" 
          : "border-slate-300 bg-white shadow-[0_2px_8px_-3px_rgba(0,0,0,0.05)] hover:border-slate-400"
      }`}
    >
      <span className="sr-only">Search products in {shopName}</span>
      <Search className={`pointer-events-none absolute left-4 transition-colors ${isFocused ? 'text-indigo-500' : 'text-slate-400'}`} size={20} />
      <input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        placeholder={`Search ${shopName}...`}
        className="h-12 w-full rounded-full bg-transparent pl-12 pr-4 text-sm font-semibold text-slate-900 outline-none placeholder:text-slate-500"
      />
    </label>
  );
}
