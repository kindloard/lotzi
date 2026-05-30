"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState, type FormEvent } from "react";
import { useToast } from "@/components/toast/toast-context";
import {
  type CustomerProfile,
  updateCustomerProfile
} from "../customer-account-api";
import { Button, Panel, SectionError, SectionSkeleton, TextField } from "../components/account-ui";
import { useAccountIdentity } from "../providers/account-identity-provider";
import { accountProfileKey } from "../lib/account-query-keys";
import { errorMessage, formatIndianPhoneNumber, isValidIndianPhoneNumber } from "../lib/account-utils";

export function ProfileScreen() {
  const identity = useAccountIdentity();
  return (
    <ProfileForm
      applySessionProfile={identity.applySessionProfile}
      error={identity.profileError}
      loading={identity.profileLoading}
      profile={identity.profile}
      retry={identity.refetchProfile}
    />
  );
}

export function ProfileForm({
  applySessionProfile,
  error,
  loading,
  profile,
  retry
}: {
  applySessionProfile: (profile: CustomerProfile) => void;
  error: unknown;
  loading: boolean;
  profile: CustomerProfile | null;
  retry: () => void;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  useEffect(() => {
    if (!profile) {
      return;
    }
    setFullName(profile.fullName ?? "");
    setPhone(profile.phone ?? "");
    setMarketingOptIn(profile.marketingOptIn);
  }, [profile]);

  const profileMutation = useMutation({
    mutationFn: updateCustomerProfile,
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: accountProfileKey });
      const previous = queryClient.getQueryData<{ apiVersion: "v1"; profile: CustomerProfile }>(accountProfileKey);
      if (previous) {
        queryClient.setQueryData(accountProfileKey, {
          ...previous,
          profile: {
            ...previous.profile,
            ...input,
            fullName: input.fullName ?? previous.profile.fullName,
            marketingOptIn: input.marketingOptIn ?? previous.profile.marketingOptIn,
            phone: input.phone === undefined ? previous.profile.phone : input.phone
          }
        });
      }
      return { previous };
    },
    onError: (mutationError, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(accountProfileKey, context.previous);
      }
      toast.error(errorMessage(mutationError, "Profile could not be saved."));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(accountProfileKey, data);
      applySessionProfile(data.profile);
      toast.success("Profile saved.");
    }
  });

  if (loading) {
    return <SectionSkeleton />;
  }

  if (error || !profile) {
    return <SectionError title="Profile unavailable" body="Profile details could not load." onRetry={retry} />;
  }

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    profileMutation.mutate({
      profileVersion: profile.profileVersion,
      fullName: fullName.trim(),
      marketingOptIn,
      phone: phone.trim() || null
    });
  };

  return (
    <Panel title="Profile details" eyebrow="Identity">
      <div className="flex flex-col gap-8">
        {/* Form Section */}
        <form className="flex max-w-2xl flex-col gap-6" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Full name" onChange={setFullName} value={fullName} />
            <TextField disabled label="Email" onChange={() => undefined} value={profile.email} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2 items-end">
            <TextField
              label="Phone"
              onChange={(val) => setPhone(formatIndianPhoneNumber(val))}
              placeholder="+91 98765 43210"
              value={phone}
            />
            <label className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-800 transition hover:bg-zinc-100">
              <input
                checked={marketingOptIn}
                className="size-4 accent-zinc-950"
                onChange={(event) => setMarketingOptIn(event.target.checked)}
                type="checkbox"
              />
              Receive updates in WhatsApp
            </label>
          </div>
          <div className="flex justify-end pt-2">
            <Button
              disabled={profileMutation.isPending || (phone.length > 0 && !isValidIndianPhoneNumber(phone))}
              label={profileMutation.isPending ? "Saving..." : "Save changes"}
              type="submit"
            />
          </div>
        </form>
      </div>
    </Panel>
  );
}
