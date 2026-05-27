"use client";

import { Clock3, CreditCard, Heart, Sparkles } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Panel } from "../components/account-ui";

export function WishlistScreen() {
  return (
    <PlaceholderPanel
      action="Explore nearby shops"
      body="Saved products will appear here once wishlist storage is enabled."
      icon={Heart}
      title="Wishlist"
    />
  );
}

export function PaymentsScreen() {
  return (
    <PlaceholderPanel
      action="Payment vault coming soon"
      body="Cards and UPI handles are not stored yet. Checkout remains secure without saved payment tokens."
      icon={CreditCard}
      title="Saved payment methods"
    />
  );
}

export function RecentScreen() {
  return (
    <PlaceholderPanel
      action="Browse marketplace"
      body="Product viewing history will appear here after the catalog tracking service is connected."
      icon={Clock3}
      title="Recently viewed"
    />
  );
}

export function RecommendationsScreen() {
  return (
    <PlaceholderPanel
      action="Fresh picks coming soon"
      body="Recommendations will use order and wishlist signals once the recommendation pipeline is ready."
      icon={Sparkles}
      title="Personalized recommendations"
    />
  );
}

export function PlaceholderPanel({
  action,
  body,
  icon: Icon,
  title
}: {
  action: string;
  body: string;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <Panel title={title} eyebrow="Coming ready">
      <div className="flex min-h-[320px] items-center justify-center text-center">
        <div>
          <span className="mx-auto flex size-14 items-center justify-center rounded-lg bg-zinc-100 text-zinc-700">
            <Icon size={24} />
          </span>
          <h2 className="mt-4 text-lg font-semibold text-zinc-950">{title}</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-500">{body}</p>
          <span className="mt-5 inline-flex rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-600">
            {action}
          </span>
        </div>
      </div>
    </Panel>
  );
}
