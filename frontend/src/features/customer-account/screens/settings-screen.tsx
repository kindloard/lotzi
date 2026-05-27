"use client";

import { Settings } from "lucide-react";
import { PlaceholderPanel } from "./placeholder-screen";
import { ProfileForm } from "./profile-screen";
import { useAccountIdentity } from "../providers/account-identity-provider";

export function SettingsScreen() {
  const identity = useAccountIdentity();

  return (
    <div className="space-y-4">
      <ProfileForm
        applySessionProfile={identity.applySessionProfile}
        error={identity.profileError}
        loading={identity.profileLoading}
        profile={identity.profile}
        retry={identity.refetchProfile}
      />
      <PlaceholderPanel
        action="Granular controls coming soon"
        body="Transactional notifications stay enabled. Marketing preferences are controlled in your profile details."
        icon={Settings}
        title="Notification preferences"
      />
    </div>
  );
}
