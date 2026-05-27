"use client";

import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { AuthInput } from "@/components/auth/auth-input";
import { AuthSubmitButton } from "@/components/auth/auth-submit-button";
import { useToast } from "@/components/toast/toast-context";
import { confirmPasswordReset, requestPasswordReset } from "@/lib/auth-api";
import {
  createResetConfirmSchema,
  createResetRequestSchema,
  passwordStrength,
  zodFieldErrors
} from "@/lib/auth-schemas";

type ResetValues = {
  email: string;
  password: string;
  confirmPassword: string;
};

type ResetField = keyof ResetValues;
type ResetErrors = Partial<Record<ResetField, string>>;
type ResetTouched = Partial<Record<ResetField, boolean>>;

const initialValues: ResetValues = {
  email: "",
  password: "",
  confirmPassword: ""
};

export function ResetPasswordForm() {
  const search = useSearchParams();
  const t = useTranslations("auth");
  const schemaT = useCallback(
    (key: string, values?: Record<string, number | string>) => t(key as never, values as never),
    [t]
  );
  const toast = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [values, setValues] = useState(initialValues);
  const [touched, setTouched] = useState<ResetTouched>({});
  const [loading, setLoading] = useState(false);
  const hasToken = Boolean(token);
  const strength = useMemo(() => passwordStrength(values.password), [values.password]);
  const errors = useMemo<ResetErrors>(() => {
    const result = hasToken
      ? createResetConfirmSchema(schemaT).safeParse({
          password: values.password,
          confirmPassword: values.confirmPassword
        })
      : createResetRequestSchema(schemaT).safeParse({ email: values.email });
    return result.success
      ? {}
      : zodFieldErrors(result.error, ["email", "password", "confirmPassword"]);
  }, [hasToken, schemaT, values.confirmPassword, values.email, values.password]);

  useEffect(() => {
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const nextToken = hashParams.get("token") ?? search.get("token");
    if (nextToken) {
      setToken(nextToken);
      window.history.replaceState(null, "", window.location.pathname);
    }
  }, [search]);

  const updateField = (name: string, value: string) => {
    setValues((current) => ({ ...current, [name]: value }));
  };

  const touchField = (name: string) => {
    setTouched((current) => ({ ...current, [name]: true }));
  };

  const touchRequired = () => {
    setTouched((current) => ({
      ...current,
      ...(hasToken
        ? { password: true, confirmPassword: true }
        : { email: true })
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    touchRequired();

    if (Object.keys(errors).length > 0) {
      toast.warning(t("toast.validationFailed"));
      return;
    }

    setLoading(true);
    try {
      if (token) {
        await confirmPasswordReset({
          token,
          newPassword: values.password
        });
        toast.success(t("reset.newPasswordSuccess"));
        setValues(initialValues);
        setToken(null);
      } else {
        const email = createResetRequestSchema(schemaT).parse({ email: values.email }).email;
        await requestPasswordReset(email);
        toast.success(t("reset.requestSuccess"));
      }
    } catch {
      toast.error(t("toast.loginFailed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col px-7 pb-6 pt-8 sm:pb-7 sm:pt-9">
      <Link
        aria-label={t("login.submit")}
        className="flex size-11 items-center justify-center rounded-[14px] bg-slate-100 text-slate-950 transition hover:bg-slate-200 focus:outline-none focus:ring-4 focus:ring-slate-950/5"
        href="/auth/login"
        prefetch
      >
        <ArrowLeft size={18} strokeWidth={2.8} />
      </Link>

      <div className="flex flex-1 flex-col justify-center py-8">
        <div className="text-center">
          <h1 className="text-[28px] font-black leading-[1.08] text-slate-950 [font-weight:950]">
            {hasToken ? t("reset.newPasswordTitle") : t("reset.requestTitle")}
          </h1>
          <p className="mx-auto mt-3 max-w-[280px] text-[13px] font-extrabold leading-5 text-slate-600 [font-weight:850]">
            {hasToken ? t("reset.newPasswordDescription") : t("reset.requestDescription")}
          </p>
        </div>

        <form className="mt-7 flex flex-col" noValidate onSubmit={handleSubmit}>
          <fieldset className="space-y-3.5" disabled={loading}>
            {hasToken ? (
              <>
                <AuthInput
                  autoComplete="new-password"
                  error={errors.password}
                  label={t("fields.password.label")}
                  name="password"
                  onBlur={touchField}
                  onChange={updateField}
                  placeholder={t("fields.password.placeholder")}
                  required
                  strength={strength}
                  touched={touched.password}
                  type="password"
                  value={values.password}
                />
                <AuthInput
                  autoComplete="new-password"
                  error={errors.confirmPassword}
                  label={t("fields.confirmPassword.label")}
                  name="confirmPassword"
                  onBlur={touchField}
                  onChange={updateField}
                  placeholder={t("fields.confirmPassword.placeholder")}
                  required
                  touched={touched.confirmPassword}
                  type="password"
                  value={values.confirmPassword}
                />
              </>
            ) : (
              <AuthInput
                autoComplete="email"
                error={errors.email}
                label={t("fields.email.label")}
                name="email"
                onBlur={touchField}
                onChange={updateField}
                placeholder={t("fields.email.placeholder")}
                required
                touched={touched.email}
                type="email"
                value={values.email}
              />
            )}
          </fieldset>

          <AuthSubmitButton
            disabled={loading}
            label={hasToken ? t("reset.newPasswordSubmit") : t("reset.requestSubmit")}
            loading={loading}
            loadingLabel={hasToken ? t("reset.newPasswordSubmitting") : t("reset.requestSubmitting")}
          />
        </form>
      </div>

      <p className="pb-1 text-center text-[13px] font-extrabold text-slate-700 [font-weight:850]">
        {t("signup.haveAccount")}{" "}
        <Link
          className="font-black text-slate-950 transition hover:text-slate-700 focus:outline-none focus:ring-4 focus:ring-slate-950/5"
          href="/auth/login"
          prefetch
        >
          {t("login.submit")}
        </Link>
      </p>
    </div>
  );
}
