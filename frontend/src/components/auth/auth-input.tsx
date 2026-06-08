"use client";

import { ChangeEvent, KeyboardEvent, useId, useState } from "react";
import { AlertCircle, CheckCircle2, Eye, EyeOff } from "lucide-react";
import { PasswordStrengthMeter } from "@/components/auth/password-strength-meter";
import { PasswordStrength } from "@/lib/auth-schemas";

interface AuthInputProps {
  autoComplete: string;
  disabled?: boolean;
  error?: string;
  helperText?: string;
  label: string;
  name: string;
  onBlur: (name: string) => void;
  onChange: (name: string, value: string) => void;
  placeholder: string;
  required?: boolean;
  strength?: PasswordStrength;
  touched?: boolean;
  type?: "email" | "password" | "text";
  value: string;
}

export function AuthInput({
  autoComplete,
  disabled = false,
  error,
  helperText,
  label,
  name,
  onBlur,
  onChange,
  placeholder,
  required = false,
  strength,
  touched = false,
  type = "text",
  value
}: AuthInputProps) {
  const inputId = useId();
  const helperId = `${inputId}-helper`;
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const isPassword = type === "password";
  const inputType = isPassword && showPassword ? "text" : type;
  const hasError = Boolean(error && touched);
  const hasSuccess = Boolean(touched && value && !error);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onChange(name, event.target.value);
  };

  const handleBlur = () => {
    onBlur(name);
  };

  const handleKeyEvent = (event: KeyboardEvent<HTMLInputElement>) => {
    if (isPassword) {
      setCapsLock(event.getModifierState("CapsLock"));
    }
  };

  return (
    <div className="block">
      <label
        className="mb-1.5 block text-[13px] font-medium text-zinc-700"
        htmlFor={inputId}
      >
        {label}
      </label>
      <span className="relative block">
        <input
          aria-describedby={helperText || hasError || capsLock ? helperId : undefined}
          aria-invalid={hasError}
          aria-required={required}
          autoComplete={autoComplete}
          className={`h-10 w-full rounded-xl border bg-zinc-50/50 px-3.5 text-[13px] font-normal text-zinc-900 outline-none transition-all placeholder:text-zinc-400 focus:bg-white focus:ring-4 disabled:cursor-not-allowed disabled:opacity-70 ${
            hasError
              ? "border-rose-300 focus:border-rose-500 focus:ring-rose-500/10"
              : hasSuccess
              ? "border-brand focus:border-brand-strong focus:ring-brand/20"
              : "border-zinc-200 focus:border-zinc-950 focus:ring-zinc-950/5"
          } ${isPassword ? "pr-11" : "pr-9"}`}
          disabled={disabled}
          id={inputId}
          minLength={isPassword ? 8 : undefined}
          name={name}
          onBlur={handleBlur}
          onChange={handleChange}
          onKeyDown={handleKeyEvent}
          onKeyUp={handleKeyEvent}
          placeholder={placeholder}
          required={required}
          type={inputType}
          value={value}
        />
        {isPassword ? (
          <button
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute right-2.5 top-1/2 flex size-7 -translate-y-1/2 items-center justify-center text-zinc-500 transition-colors hover:text-zinc-950 focus:outline-none disabled:pointer-events-none"
            disabled={disabled}
            onClick={() => setShowPassword((current) => !current)}
            type="button"
          >
            {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        ) : hasError ? (
          <AlertCircle
            aria-hidden="true"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-rose-500"
            size={15}
          />
        ) : hasSuccess ? (
          <CheckCircle2
            aria-hidden="true"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-brand-strong"
            size={15}
          />
        ) : null}
      </span>
      {(hasError || helperText || capsLock) && (
        <span
          className={`mt-1.5 block min-h-4 text-[12px] font-normal leading-4 ${
            hasError || capsLock ? "text-rose-600" : "text-zinc-500"
          }`}
          id={helperId}
        >
          {hasError ? error : capsLock ? "Caps Lock is on." : helperText}
        </span>
      )}
      {isPassword && strength && value && <PasswordStrengthMeter strength={strength} />}
    </div>
  );
}
