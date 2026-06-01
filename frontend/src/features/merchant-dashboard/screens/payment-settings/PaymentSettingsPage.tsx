"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Eye, EyeOff, Loader2, Save, Smartphone, Truck, WalletCards, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { ApiError } from "@/lib/api";
import { useMerchantIdentity } from "../../providers/merchant-identity-provider";
import { DashboardButton, Panel } from "../../components/ui/dashboard-ui";
import {
  fetchPaymentSettings,
  testPhonepeConnection,
  updateCodSettings,
  updatePhonepeSettings,
  type PaymentProviderSettings
} from "./payment-settings-api";

interface PhonepeFormState {
  enabled: boolean;
  displayName: string;
  displayPriority: number;
  environment: "SANDBOX" | "PRODUCTION";
  merchantId: string;
  clientId: string;
  clientSecret: string;
  clientVersion: string;
  saltKey: string;
  saltIndex: string;
}

interface CodFormState {
  enabled: boolean;
  displayName: string;
  displayPriority: number;
}

export function PaymentSettingsPage() {
  const identity = useMerchantIdentity();
  const queryClient = useQueryClient();
  const storeId = identity.storeId;
  const [editSecrets, setEditSecrets] = useState(false);
  const [showSecrets, setShowSecrets] = useState(false);
  const [message, setMessage] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [phonepeForm, setPhonepeForm] = useState<PhonepeFormState>(emptyPhonepeForm());
  const [codForm, setCodForm] = useState<CodFormState>({ enabled: false, displayName: "Cash on Delivery", displayPriority: 3 });

  const settingsQuery = useQuery({
    enabled: Boolean(storeId),
    queryKey: ["merchant", "payment-settings", storeId],
    queryFn: () => fetchPaymentSettings(storeId)
  });

  const providers = settingsQuery.data?.providers ?? [];
  const phonepe = useMemo(() => providers.find((provider) => provider.provider === "phonepe"), [providers]);
  const cod = useMemo(() => providers.find((provider) => provider.provider === "cod"), [providers]);
  const cashfree = useMemo(() => providers.find((provider) => provider.provider === "cashfree"), [providers]);

  useEffect(() => {
    if (phonepe) {
      setPhonepeForm(fromPhonepe(phonepe));
      setEditSecrets(false);
      setShowSecrets(false);
    }
    if (cod) {
      setCodForm({
        enabled: cod.enabled,
        displayName: cod.displayName,
        displayPriority: cod.displayPriority
      });
    }
  }, [cod, phonepe]);

  const savePhonepe = useMutation({
    mutationFn: () => updatePhonepeSettings(storeId, {
      enabled: phonepeForm.enabled,
      displayName: phonepeForm.displayName,
      displayPriority: phonepeForm.displayPriority,
      environment: phonepeForm.environment,
      merchantId: phonepeForm.merchantId,
      clientVersion: phonepeForm.clientVersion,
      saltIndex: phonepeForm.saltIndex,
      ...(editSecrets ? {
        clientId: phonepeForm.clientId,
        clientSecret: phonepeForm.clientSecret,
        saltKey: phonepeForm.saltKey
      } : {})
    }),
    onSuccess: async () => {
      setMessage({ tone: "success", text: "PhonePe settings saved." });
      await queryClient.invalidateQueries({ queryKey: ["merchant", "payment-settings", storeId] });
    },
    onError: (error) => setMessage({ tone: "error", text: errorMessage(error, "PhonePe settings could not be saved.") })
  });

  const testPhonepe = useMutation({
    mutationFn: () => testPhonepeConnection(storeId),
    onSuccess: async (result) => {
      setMessage({ tone: result.status === "success" ? "success" : "error", text: result.message });
      await queryClient.invalidateQueries({ queryKey: ["merchant", "payment-settings", storeId] });
    },
    onError: (error) => setMessage({ tone: "error", text: errorMessage(error, "PhonePe test failed.") })
  });

  const saveCod = useMutation({
    mutationFn: () => updateCodSettings(storeId, codForm),
    onSuccess: async () => {
      setMessage({ tone: "success", text: "COD settings saved." });
      await queryClient.invalidateQueries({ queryKey: ["merchant", "payment-settings", storeId] });
    },
    onError: (error) => setMessage({ tone: "error", text: errorMessage(error, "COD settings could not be saved.") })
  });

  const busy = settingsQuery.isLoading || savePhonepe.isPending || testPhonepe.isPending || saveCod.isPending;

  return (
    <div className="space-y-5">
      {message ? (
        <div className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold ${
          message.tone === "success"
            ? "border-emerald-200 bg-emerald-50 text-emerald-800"
            : "border-rose-200 bg-rose-50 text-rose-800"
        }`}>
          {message.tone === "success" ? <CheckCircle2 size={14} /> : <XCircle size={14} />}
          {message.text}
        </div>
      ) : null}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
        <Panel
          eyebrow="Gateway"
          title="PhonePe checkout"
          action={
            <div className="flex gap-2">
              <DashboardButton
                disabled={busy}
                icon={testPhonepe.isPending ? Loader2 : Smartphone}
                label={testPhonepe.isPending ? "Testing" : "Test"}
                onClick={() => testPhonepe.mutate()}
                variant="secondary"
              />
              <DashboardButton
                disabled={busy}
                icon={savePhonepe.isPending ? Loader2 : Save}
                label={savePhonepe.isPending ? "Saving" : "Save"}
                onClick={() => savePhonepe.mutate()}
              />
            </div>
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            <SwitchRow
              checked={phonepeForm.enabled}
              label="Enable PhonePe"
              onChange={(enabled) => setPhonepeForm((form) => ({ ...form, enabled }))}
            />
            <SelectField
              label="Environment"
              onChange={(environment) => setPhonepeForm((form) => ({ ...form, environment: environment as PhonepeFormState["environment"] }))}
              options={["SANDBOX", "PRODUCTION"]}
              value={phonepeForm.environment}
            />
            <TextField
              label="Display name"
              onChange={(displayName) => setPhonepeForm((form) => ({ ...form, displayName }))}
              value={phonepeForm.displayName}
            />
            <NumberField
              label="Priority"
              onChange={(displayPriority) => setPhonepeForm((form) => ({ ...form, displayPriority }))}
              value={phonepeForm.displayPriority}
            />
            <TextField
              label="Merchant ID"
              onChange={(merchantId) => setPhonepeForm((form) => ({ ...form, merchantId }))}
              value={phonepeForm.merchantId}
            />
            <TextField
              label="Client version"
              onChange={(clientVersion) => setPhonepeForm((form) => ({ ...form, clientVersion }))}
              value={phonepeForm.clientVersion}
            />
          </div>

          <div className="mt-5 rounded-xl border border-zinc-200 bg-zinc-50/50 p-4">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">Secrets</p>
                <p className="mt-1 text-xs font-medium text-zinc-600">
                  {phonepe?.configured ? "Credentials are stored encrypted." : "Add credentials before enabling PhonePe."}
                </p>
              </div>
              <div className="flex gap-2">
                <DashboardButton
                  icon={showSecrets ? EyeOff : Eye}
                  label={showSecrets ? "Hide" : "Show"}
                  onClick={() => setShowSecrets((current) => !current)}
                  variant="secondary"
                />
                <DashboardButton
                  label={editSecrets ? "Lock" : "Edit"}
                  onClick={() => setEditSecrets((current) => !current)}
                  variant="secondary"
                />
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <TextField
                disabled={!editSecrets}
                label="Client ID"
                onChange={(clientId) => setPhonepeForm((form) => ({ ...form, clientId }))}
                type={showSecrets ? "text" : "password"}
                value={phonepeForm.clientId}
              />
              <TextField
                disabled={!editSecrets}
                label="Client secret"
                onChange={(clientSecret) => setPhonepeForm((form) => ({ ...form, clientSecret }))}
                type={showSecrets ? "text" : "password"}
                value={phonepeForm.clientSecret}
              />
              <TextField
                disabled={!editSecrets}
                label="Legacy salt key"
                onChange={(saltKey) => setPhonepeForm((form) => ({ ...form, saltKey }))}
                type={showSecrets ? "text" : "password"}
                value={phonepeForm.saltKey}
              />
              <TextField
                label="Legacy salt index"
                onChange={(saltIndex) => setPhonepeForm((form) => ({ ...form, saltIndex }))}
                value={phonepeForm.saltIndex}
              />
            </div>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel eyebrow="Offline" title="Cash on delivery">
            <div className="space-y-4">
              <SwitchRow
                checked={codForm.enabled}
                label="Enable COD"
                onChange={(enabled) => setCodForm((form) => ({ ...form, enabled }))}
              />
              <TextField
                label="Display name"
                onChange={(displayName) => setCodForm((form) => ({ ...form, displayName }))}
                value={codForm.displayName}
              />
              <NumberField
                label="Priority"
                onChange={(displayPriority) => setCodForm((form) => ({ ...form, displayPriority }))}
                value={codForm.displayPriority}
              />
              <DashboardButton
                disabled={busy}
                icon={saveCod.isPending ? Loader2 : Truck}
                label={saveCod.isPending ? "Saving" : "Save COD"}
                onClick={() => saveCod.mutate()}
              />
            </div>
          </Panel>

          <Panel eyebrow="Current" title="Provider status">
            <div className="divide-y divide-zinc-100">
              {[cashfree, phonepe, cod].filter(Boolean).map((provider) => (
                <ProviderRow key={provider!.provider} provider={provider!} />
              ))}
            </div>
          </Panel>
        </div>
      </section>

      <Panel eyebrow="Audit" title="Recent payment setting changes">
        <div className="divide-y divide-zinc-100">
          {(settingsQuery.data?.auditTrail ?? []).length > 0 ? settingsQuery.data!.auditTrail.map((item) => (
            <div className="flex items-center justify-between gap-4 py-3 text-xs" key={item.id}>
              <span className="font-semibold text-zinc-800">{item.action}</span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-400">{new Date(item.createdAt).toLocaleString()}</span>
            </div>
          )) : (
            <p className="py-3 text-xs font-medium text-zinc-500">No payment setting changes yet.</p>
          )}
        </div>
      </Panel>
    </div>
  );
}

function ProviderRow({ provider }: { provider: PaymentProviderSettings }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3">
      <span className="flex items-center gap-2 text-xs font-semibold text-zinc-800">
        <WalletCards size={14} className="text-zinc-500" />
        {provider.displayName}
      </span>
      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
        provider.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-zinc-200 bg-zinc-50 text-zinc-500"
      }`}>
        {provider.enabled ? "Enabled" : "Disabled"}
      </span>
    </div>
  );
}

function SwitchRow({ checked, label, onChange }: { checked: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex h-10 items-center justify-between gap-4 rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-medium text-zinc-800">
      {label}
      <input
        checked={checked}
        className="size-4 accent-zinc-950"
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function TextField({
  disabled,
  label,
  onChange,
  type = "text",
  value
}: {
  disabled?: boolean;
  label: string;
  onChange: (value: string) => void;
  type?: "text" | "password";
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-zinc-700">{label}</span>
      <input
        className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-normal text-zinc-950 outline-none transition placeholder:text-zinc-400 disabled:bg-zinc-100 disabled:text-zinc-400 focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5"
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        type={type}
        value={value}
      />
    </label>
  );
}

function NumberField({ label, onChange, value }: { label: string; onChange: (value: number) => void; value: number }) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-zinc-700">{label}</span>
      <input
        className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-normal text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5"
        min={0}
        onChange={(event) => onChange(Number(event.target.value) || 0)}
        type="number"
        value={value}
      />
    </label>
  );
}

function SelectField({
  label,
  onChange,
  options,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-medium text-zinc-700">{label}</span>
      <select
        className="mt-2 h-10 w-full rounded-xl border border-zinc-200 bg-white px-3 text-[13px] font-normal text-zinc-950 outline-none transition focus:border-zinc-950 focus:ring-4 focus:ring-zinc-950/5"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

function emptyPhonepeForm(): PhonepeFormState {
  return {
    enabled: false,
    displayName: "PhonePe",
    displayPriority: 2,
    environment: "SANDBOX",
    merchantId: "",
    clientId: "",
    clientSecret: "",
    clientVersion: "1",
    saltKey: "",
    saltIndex: ""
  };
}

function fromPhonepe(provider: PaymentProviderSettings): PhonepeFormState {
  return {
    enabled: provider.enabled,
    displayName: provider.displayName,
    displayPriority: provider.displayPriority,
    environment: provider.environment === "PRODUCTION" ? "PRODUCTION" : "SANDBOX",
    merchantId: provider.merchantId ?? "",
    clientId: provider.secrets?.clientId ?? "",
    clientSecret: provider.secrets?.clientSecret ?? "",
    clientVersion: provider.clientVersion ?? "1",
    saltKey: provider.secrets?.saltKey ?? "",
    saltIndex: provider.saltIndex ?? ""
  };
}

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    const body = error.body as { message?: string } | undefined;
    return body?.message ?? error.message;
  }
  return error instanceof Error ? error.message : fallback;
}
