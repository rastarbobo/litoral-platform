"use client";

import React from "react";
import Link from "next/link";
import { ChevronRight, User, CreditCard, Paintbrush, Puzzle } from "lucide-react";
import { useDashboardStore } from "@/store/dashboard-store";
import { TIER_LABELS } from "@/lib/subscription/tiers";

/**
 * Settings View — iOS-style grouped list navigation.
 * Rows link to existing pages: Brand Persona, Subscription, Template Preferences.
 * All links resolve restaurant context server-side — no query params needed.
 *
 * Story 5.5: Dynamically shows store-driven context like "Last updated"
 * and current tier name, persisting across tab switches.
 */
export function SettingsView() {
  const personaUpdatedAt = useDashboardStore((s) => s.personaUpdatedAt);
  const lastKnownTier = useDashboardStore((s) => s.lastKnownTier);

  // Format relative time for persona "last updated" subtitle
  const personaSubtitle = buildPersonaSubtitle(personaUpdatedAt);
  const subscriptionSubtitle = buildSubscriptionSubtitle(lastKnownTier);

  return (
    <div className="flex flex-col gap-4">
      {/* Account group */}
      <SettingsGroup
        title="Account"
        items={[
          {
            label: "Brand Persona",
            Icon: User,
            href: "/dashboard/settings/brand-persona",
            description: personaSubtitle,
          },
          {
            label: "Subscription",
            Icon: CreditCard,
            href: "/dashboard/settings/subscription",
            description: subscriptionSubtitle,
          },
        ]}
      />

      {/* Preferences group */}
      <SettingsGroup
        title="Preferences"
        items={[
          {
            label: "Template Preferences",
            Icon: Paintbrush,
            href: "/dashboard/settings/template-preferences",
            description: "Choose your preferred visual styles",
          },
        ]}
      />

      {/* Publishing group */}
      <SettingsGroup
        title="Publishing"
        items={[
          {
            label: "Chrome Extension",
            Icon: Puzzle,
            href: "/dashboard/settings/extension",
            description: "Connect the browser extension for social publishing",
          },
        ]}
      />
    </div>
  );
}

// ── Subtitle Builders ─────────────────────────────────────

function buildPersonaSubtitle(updatedAt: number | null): string {
  if (!updatedAt) return "Edit your restaurant's voice and personality";

  const diffMs = Date.now() - updatedAt;
  const diffMin = Math.floor(diffMs / 60000);

  if (diffMin < 1) return "Last updated: just now";
  if (diffMin < 60) return `Last updated: ${diffMin} min ago`;
  const diffHrs = Math.floor(diffMin / 60);
  if (diffHrs < 24) return `Last updated: ${diffHrs}h ago`;
  const diffDays = Math.floor(diffHrs / 24);
  return `Last updated: ${diffDays}d ago`;
}

function buildSubscriptionSubtitle(tier: string | null): string {
  if (!tier) return "Manage your plan and billing";
  const label = TIER_LABELS[tier] ?? tier;
  return `Current: ${label} — Manage your plan and billing`;
}

// ── Settings Group ─────────────────────────────────────

interface SettingsItem {
  label: string;
  Icon: React.ElementType;
  href: string;
  description: string;
}

function SettingsGroup({
  title,
  items,
}: {
  title: string;
  items: SettingsItem[];
}) {
  return (
    <section>
      {/* Section header — Label-Caps */}
      <h2
        className="px-4 py-2 text-[12px] font-semibold uppercase tracking-[0.05em] text-[#717786]"
        style={{ fontFamily: "Inter, sans-serif", lineHeight: "16px" }}
      >
        {title}
      </h2>

      <div className="mx-4 bg-white rounded-xl border border-[#E5E5E7] shadow-[0px_4px_12px_rgba(0,0,0,0.05)] overflow-hidden">
        {items.map((item, index) => (
          <SettingsRow
            key={item.label}
            item={item}
            isLast={index === items.length - 1}
          />
        ))}
      </div>
    </section>
  );
}

// ── Settings Row ─────────────────────────────────────────

function SettingsRow({
  item,
}: {
  item: SettingsItem;
  isLast: boolean;
}) {
  const { label, href, description } = item;

  return (
    <Link
      href={href}
      className="flex items-center gap-3 px-4 py-3 active:bg-[#eeedf3] touch-manipulation
                 border-b border-[#E5E5E7] last:border-b-0"
    >
      <div className="flex-1 min-w-0">
        <p
          className="text-[17px] font-normal text-[#1a1b1f] leading-[22px]"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {label}
        </p>
        <p
          className="text-[13px] text-[#717786] mt-0.5 leading-[18px]"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          {description}
        </p>
      </div>
      <ChevronRight className="w-5 h-5 text-[#717786] shrink-0" />
    </Link>
  );
}