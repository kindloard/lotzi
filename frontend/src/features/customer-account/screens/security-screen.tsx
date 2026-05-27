"use client";

import { KeyRound, LogOut, Mail, Monitor, ShieldCheck, Trash2 } from "lucide-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast/toast-context";
import {
  type AccountActivity,
  changeCustomerPassword,
  confirmCustomerEmailChange,
  deleteCustomerAccount,
  fetchAccountActivity,
  fetchCustomerSessions,
  requestCustomerEmailChange,
  requestDeleteAccount,
  revokeCustomerSession,
  revokeOtherCustomerSessions
} from "../customer-account-api";
import { Button, EmptyState, InlineSkeleton, Panel, SectionError, TextField } from "../components/account-ui";
import { useAccountIdentity } from "../providers/account-identity-provider";
import { accountActivityKey, accountSessionsKey } from "../lib/account-query-keys";
import { errorMessage } from "../lib/account-utils";

export function SecurityScreen() {
  const identity = useAccountIdentity();
  const queryClient = useQueryClient();
  const toast = useToast();
  const sessions = useQuery({ queryKey: accountSessionsKey, queryFn: fetchCustomerSessions });
  const activity = useQuery({ queryKey: accountActivityKey, queryFn: fetchAccountActivity });
  const [passwordDraft, setPasswordDraft] = useState({ currentPassword: "", newPassword: "" });
  const [emailDraft, setEmailDraft] = useState({ currentPassword: "", newEmail: "", otp: "", requested: false });
  const [deleteDraft, setDeleteDraft] = useState({ currentPassword: "", otp: "", requested: false });

  const revokeMutation = useMutation({
    mutationFn: revokeCustomerSession,
    onError: (error) => toast.error(errorMessage(error, "Session could not be revoked.")),
    onSuccess: (data) => {
      if (data.currentSessionRevoked) {
        void identity.logout();
        return;
      }
      void queryClient.invalidateQueries({ queryKey: accountSessionsKey });
      void queryClient.invalidateQueries({ queryKey: accountActivityKey });
      toast.success("Session revoked.");
    }
  });

  const revokeOthersMutation = useMutation({
    mutationFn: revokeOtherCustomerSessions,
    onError: (error) => toast.error(errorMessage(error, "Sessions could not be revoked.")),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: accountSessionsKey });
      void queryClient.invalidateQueries({ queryKey: accountActivityKey });
      toast.success(`${data.revokedCount} sessions signed out.`);
    }
  });

  const passwordMutation = useMutation({
    mutationFn: changeCustomerPassword,
    onError: (error) => toast.error(errorMessage(error, "Password could not be changed.")),
    onSuccess: () => {
      setPasswordDraft({ currentPassword: "", newPassword: "" });
      void queryClient.invalidateQueries({ queryKey: accountSessionsKey });
      void queryClient.invalidateQueries({ queryKey: accountActivityKey });
      toast.success("Password changed.");
    }
  });

  const requestEmailMutation = useMutation({
    mutationFn: requestCustomerEmailChange,
    onError: (error) => toast.error(errorMessage(error, "Email change could not start.")),
    onSuccess: () => {
      setEmailDraft((current) => ({ ...current, requested: true }));
      toast.success("Verification code sent.");
    }
  });

  const confirmEmailMutation = useMutation({
    mutationFn: confirmCustomerEmailChange,
    onError: (error) => toast.error(errorMessage(error, "Email code could not be verified.")),
    onSuccess: (data) => {
      identity.applySessionProfile(data.profile);
      setEmailDraft({ currentPassword: "", newEmail: "", otp: "", requested: false });
      void queryClient.invalidateQueries({ queryKey: accountActivityKey });
      toast.success("Email changed.");
    }
  });

  const deleteRequestMutation = useMutation({
    mutationFn: requestDeleteAccount,
    onError: (error) => toast.error(errorMessage(error, "Delete confirmation could not be sent.")),
    onSuccess: () => {
      setDeleteDraft((current) => ({ ...current, requested: true }));
      toast.success("Deletion code sent to your email.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomerAccount,
    onError: (error) => toast.error(errorMessage(error, "Account could not be deleted.")),
    onSuccess: () => void identity.logout()
  });

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(340px,0.8fr)]">
      <div className="space-y-4">
        <Panel
          title="Active sessions"
          eyebrow="Devices"
          action={
            <Button
              disabled={revokeOthersMutation.isPending}
              icon={LogOut}
              label={revokeOthersMutation.isPending ? "Signing out..." : "Sign out others"}
              onClick={() => revokeOthersMutation.mutate()}
              variant="secondary"
            />
          }
        >
          {sessions.isLoading ? (
            <InlineSkeleton rows={3} />
          ) : sessions.isError ? (
            <SectionError
              compact
              title="Sessions unavailable"
              body="Active sessions could not load."
              onRetry={() => void sessions.refetch()}
            />
          ) : (
            <div className="divide-y divide-zinc-100">
              {sessions.data?.sessions.map((item) => (
                <div className="flex items-center justify-between gap-3 py-3" key={item.id}>
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
                      <Monitor size={17} />
                    </span>
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-900">{item.deviceLabel}</p>
                      <p className="truncate text-xs text-zinc-500">
                        {item.current ? "Current session" : `Last seen ${new Date(item.lastSeenAt).toLocaleDateString()}`}
                      </p>
                    </div>
                  </div>
                  <Button
                    disabled={revokeMutation.isPending}
                    icon={Trash2}
                    label={item.current ? "Sign out" : "Revoke"}
                    onClick={() => revokeMutation.mutate(item.id)}
                    variant="danger"
                  />
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Visible account activity" eyebrow="Trust history">
          {activity.isLoading ? (
            <InlineSkeleton rows={4} />
          ) : activity.isError ? (
            <SectionError
              compact
              title="Activity unavailable"
              body="Account activity could not load."
              onRetry={() => void activity.refetch()}
            />
          ) : (
            <ActivityList activity={activity.data?.activity ?? []} />
          )}
        </Panel>
      </div>

      <div className="space-y-4">
        <Panel title="Change password" eyebrow="Security">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              passwordMutation.mutate(passwordDraft);
            }}
          >
            <TextField
              label="Current password"
              onChange={(value) => setPasswordDraft((current) => ({ ...current, currentPassword: value }))}
              type="password"
              value={passwordDraft.currentPassword}
            />
            <TextField
              label="New password"
              onChange={(value) => setPasswordDraft((current) => ({ ...current, newPassword: value }))}
              type="password"
              value={passwordDraft.newPassword}
            />
            <Button
              disabled={passwordMutation.isPending}
              icon={KeyRound}
              label={passwordMutation.isPending ? "Changing..." : "Change password"}
              type="submit"
            />
          </form>
        </Panel>

        <Panel title="Change email" eyebrow="OTP protected">
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (emailDraft.requested) {
                confirmEmailMutation.mutate({ newEmail: emailDraft.newEmail, otp: emailDraft.otp });
              } else {
                requestEmailMutation.mutate({
                  currentPassword: emailDraft.currentPassword,
                  newEmail: emailDraft.newEmail
                });
              }
            }}
          >
            <TextField
              label="New email"
              onChange={(value) => setEmailDraft((current) => ({ ...current, newEmail: value }))}
              value={emailDraft.newEmail}
            />
            {!emailDraft.requested ? (
              <TextField
                label="Current password"
                onChange={(value) => setEmailDraft((current) => ({ ...current, currentPassword: value }))}
                type="password"
                value={emailDraft.currentPassword}
              />
            ) : (
              <TextField
                label="Verification code"
                onChange={(value) => setEmailDraft((current) => ({ ...current, otp: value }))}
                value={emailDraft.otp}
              />
            )}
            <Button
              disabled={requestEmailMutation.isPending || confirmEmailMutation.isPending}
              icon={Mail}
              label={emailDraft.requested ? "Confirm email" : "Send code"}
              type="submit"
            />
          </form>
        </Panel>

        <Panel title="Delete account" eyebrow="Danger zone">
          <p className="text-sm leading-6 text-zinc-500">
            This soft-deletes your account, minimizes personal data, and preserves historical orders for legal/accounting integrity.
          </p>
          <div className="mt-4 space-y-3">
            {!deleteDraft.requested && (
              <Button
                disabled={deleteRequestMutation.isPending}
                icon={Trash2}
                label={deleteRequestMutation.isPending ? "Sending..." : "Send deletion code"}
                onClick={() => deleteRequestMutation.mutate()}
                variant="danger"
              />
            )}
            {deleteDraft.requested && (
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  deleteMutation.mutate({
                    currentPassword: deleteDraft.currentPassword || undefined,
                    otp: deleteDraft.otp || undefined
                  });
                }}
              >
                <TextField
                  label="Current password"
                  onChange={(value) => setDeleteDraft((current) => ({ ...current, currentPassword: value }))}
                  type="password"
                  value={deleteDraft.currentPassword}
                />
                <TextField
                  label="Deletion code"
                  onChange={(value) => setDeleteDraft((current) => ({ ...current, otp: value }))}
                  value={deleteDraft.otp}
                />
                <Button disabled={deleteMutation.isPending} icon={Trash2} label="Delete account" type="submit" variant="danger" />
              </form>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ActivityList({ activity }: { activity: AccountActivity[] }) {
  if (!activity.length) {
    return <EmptyState compact icon={ShieldCheck} title="No account changes yet" body="Security-sensitive account changes will appear here." />;
  }

  return (
    <div className="divide-y divide-zinc-100">
      {activity.map((item) => (
        <div className="flex items-start gap-3 py-3" key={item.id}>
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
            <ShieldCheck size={14} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900">{item.summary}</p>
            <p className="mt-0.5 text-xs text-zinc-500">
              {new Date(item.createdAt).toLocaleString()} - {item.outcome}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
