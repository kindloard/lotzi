"use client";

import { Check, Home, MapPin, Plus, Save, Trash2, X } from "lucide-react";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast/toast-context";
import {
  type AddressInput,
  type CustomerAddress,
  createCustomerAddress,
  deleteCustomerAddress,
  fetchCustomerAddresses,
  setDefaultCustomerAddress
} from "../customer-account-api";
import { Button, EmptyState, Panel, SectionError, SectionSkeleton, TextField } from "../components/account-ui";
import { accountAddressesKey } from "../lib/account-query-keys";
import { errorMessage } from "../lib/account-utils";

export function AddressesScreen() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: accountAddressesKey, queryFn: () => fetchCustomerAddresses() });
  const [formOpen, setFormOpen] = useState(false);

  const createMutation = useMutation({
    mutationFn: createCustomerAddress,
    onMutate: async (input) => optimisticAddressCreate(queryClient, input),
    onError: (error, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData(accountAddressesKey, context.previous);
      }
      toast.error(errorMessage(error, "Address could not be added."));
    },
    onSuccess: (data) => {
      queryClient.setQueryData(accountAddressesKey, (current: { apiVersion: "v1"; addresses: CustomerAddress[] } | undefined) => ({
        apiVersion: "v1",
        addresses: upsertAddress(current?.addresses ?? [], data.address)
      }));
      setFormOpen(false);
      toast.success("Address added.");
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteCustomerAddress,
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: accountAddressesKey });
      const previous = queryClient.getQueryData<{ apiVersion: "v1"; addresses: CustomerAddress[] }>(accountAddressesKey);
      queryClient.setQueryData(accountAddressesKey, {
        apiVersion: "v1",
        addresses: (previous?.addresses ?? []).filter((address) => address.id !== id)
      });
      return { previous };
    },
    onError: (error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(accountAddressesKey, context.previous);
      }
      toast.error(errorMessage(error, "Address could not be removed."));
    },
    onSuccess: () => toast.success("Address removed.")
  });

  const defaultMutation = useMutation({
    mutationFn: setDefaultCustomerAddress,
    onError: (error) => toast.error(errorMessage(error, "Default address could not be changed.")),
    onSuccess: (data) => {
      queryClient.setQueryData(accountAddressesKey, (current: { apiVersion: "v1"; addresses: CustomerAddress[] } | undefined) => ({
        apiVersion: "v1",
        addresses: (current?.addresses ?? []).map((address) => ({ ...address, isDefault: address.id === data.address.id }))
      }));
      toast.success("Default address updated.");
    }
  });

  if (query.isLoading) {
    return <SectionSkeleton />;
  }

  if (query.isError) {
    return (
      <SectionError
        title="Addresses could not load"
        body="Retry to load saved delivery addresses."
        onRetry={() => void query.refetch()}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          icon={formOpen ? X : Plus}
          label={formOpen ? "Close" : "Add address"}
          onClick={() => setFormOpen((value) => !value)}
        />
      </div>
      {formOpen && <AddressForm disabled={createMutation.isPending} onSubmit={(input) => createMutation.mutate(input)} />}
      {query.data?.addresses.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {query.data.addresses.map((address) => (
            <AddressCard
              address={address}
              key={address.id}
              onDelete={() => deleteMutation.mutate(address.id)}
              onSetDefault={() => defaultMutation.mutate(address.id)}
            />
          ))}
        </div>
      ) : (
        <EmptyState icon={Home} title="No saved addresses" body="Add a delivery address to speed up checkout and order tracking." />
      )}
    </div>
  );
}

function AddressForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (input: AddressInput) => void }) {
  const [draft, setDraft] = useState<AddressInput>({
    city: "",
    deliveryInstructions: "",
    isDefault: true,
    label: "Home",
    line1: "",
    line2: "",
    pincode: "",
    recipientName: "",
    recipientPhone: "",
    state: ""
  });
  const set = (key: keyof AddressInput, value: string | boolean) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Panel title="Add delivery address" eyebrow="Address book">
      <form
        className="grid gap-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(draft);
        }}
      >
        <TextField label="Label" onChange={(value) => set("label", value)} value={draft.label ?? ""} />
        <TextField label="Recipient name" onChange={(value) => set("recipientName", value)} value={draft.recipientName ?? ""} />
        <TextField label="Recipient phone" onChange={(value) => set("recipientPhone", value)} value={draft.recipientPhone ?? ""} />
        <TextField label="Pincode" onChange={(value) => set("pincode", value)} value={draft.pincode} />
        <TextField className="md:col-span-2" label="Address line 1" onChange={(value) => set("line1", value)} value={draft.line1} />
        <TextField className="md:col-span-2" label="Address line 2" onChange={(value) => set("line2", value)} value={draft.line2 ?? ""} />
        <TextField label="City" onChange={(value) => set("city", value)} value={draft.city} />
        <TextField label="State" onChange={(value) => set("state", value)} value={draft.state} />
        <TextField
          className="md:col-span-2"
          label="Delivery instructions"
          onChange={(value) => set("deliveryInstructions", value)}
          value={draft.deliveryInstructions ?? ""}
        />
        <label className="flex min-h-11 items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 px-3 text-sm font-semibold text-zinc-800">
          <input
            checked={Boolean(draft.isDefault)}
            className="size-4 accent-zinc-950"
            onChange={(event) => set("isDefault", event.target.checked)}
            type="checkbox"
          />
          Set as default address
        </label>
        <div className="md:col-span-2">
          <Button disabled={disabled} icon={Save} label={disabled ? "Saving..." : "Save address"} type="submit" />
        </div>
      </form>
    </Panel>
  );
}

function AddressCard({
  address,
  onDelete,
  onSetDefault
}: {
  address: CustomerAddress;
  onDelete: () => void;
  onSetDefault: () => void;
}) {
  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-zinc-950">{address.label ?? "Address"}</h2>
            {address.isDefault && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800">
                Default
              </span>
            )}
          </div>
          <p className="mt-2 text-sm font-medium text-zinc-700">
            {address.recipientName ?? "Recipient"} {address.recipientPhone ? `- ${address.recipientPhone}` : ""}
          </p>
          <p className="mt-1 text-sm leading-6 text-zinc-500">
            {[address.line1, address.line2, address.city, address.state, address.pincode].filter(Boolean).join(", ")}
          </p>
          {address.deliveryInstructions && <p className="mt-2 text-xs text-zinc-500">{address.deliveryInstructions}</p>}
        </div>
        <MapPin className="shrink-0 text-zinc-400" size={20} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {!address.isDefault && <Button icon={Check} label="Set default" onClick={onSetDefault} variant="secondary" />}
        <Button icon={Trash2} label="Remove" onClick={onDelete} variant="danger" />
      </div>
    </article>
  );
}

async function optimisticAddressCreate(queryClient: QueryClient, input: AddressInput) {
  await queryClient.cancelQueries({ queryKey: accountAddressesKey });
  const previous = queryClient.getQueryData<{ apiVersion: "v1"; addresses: CustomerAddress[] }>(accountAddressesKey);
  const optimistic: CustomerAddress = {
    addressVersion: 1,
    city: input.city,
    createdAt: new Date().toISOString(),
    deliveryInstructions: input.deliveryInstructions ?? null,
    id: `optimistic-${Date.now()}`,
    isDefault: input.isDefault ?? false,
    label: input.label ?? null,
    latitude: input.latitude ?? null,
    line1: input.line1,
    line2: input.line2 ?? null,
    longitude: input.longitude ?? null,
    pincode: input.pincode,
    recipientName: input.recipientName ?? null,
    recipientPhone: input.recipientPhone ?? null,
    state: input.state,
    updatedAt: new Date().toISOString()
  };
  queryClient.setQueryData(accountAddressesKey, {
    apiVersion: "v1",
    addresses: [optimistic, ...(previous?.addresses ?? [])]
  });
  return { previous };
}

function upsertAddress(addresses: CustomerAddress[], next: CustomerAddress) {
  const withoutOptimistic = addresses.filter((address) => !address.id.startsWith("optimistic-") && address.id !== next.id);
  return [next, ...withoutOptimistic].sort((left, right) => Number(right.isDefault) - Number(left.isDefault));
}
