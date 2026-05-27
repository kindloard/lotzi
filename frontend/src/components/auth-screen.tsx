"use client";

import { CredentialAuthScreen } from "@/components/auth/credential-auth-screen";
import { OtpScreen } from "@/components/auth/otp-screen";

type AuthMode = "login" | "signup" | "merchant-signup" | "otp";

export function AuthScreen({ mode }: { mode: AuthMode }) {
  if (mode === "otp") {
    return <OtpScreen />;
  }

  return <CredentialAuthScreen mode={mode} />;
}
