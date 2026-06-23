"use client";

import { useState, useCallback } from "react";
import { create } from "zustand";
import { Card } from "@/components/onboarding/shared";
import { SectionHeading, SectionSubheading } from "@/components/onboarding/shared";

// ─── Tier Data ─────────────────────────────────────────────

interface TierInfo {
  id: string;
  name: string;
  price: string;
  priceSuffix: string;
  model: string;
  features: string[];
  highlight?: string;
}

const TIERS: TierInfo[] = [
  {
    id: "starter",
    name: "Starter",
    price: "€29",
    priceSuffix: "/month",
    model: "Credit-based",
    features: [
      "1 credit = 1 image post",
      "3 credits = 1 video post",
      "Chrome Extension publishing",
      "Brand Persona engine",
      "Telegram notifications",
    ],
  },
  {
    id: "pro",
    name: "Pro",
    price: "€79",
    priceSuffix: "/month",
    model: "Unlimited",
    features: [
      "Unlimited posts",
      "Full Architect Engine",
      "Chrome Extension publishing",
      "Results Dashboard",
      "All content formats",
      "Priority support",
    ],
  },
  {
    id: "annual_pro",
    name: "Annual Pro",
    price: "€790",
    priceSuffix: "/year",
    model: "Unlimited annual",
    highlight: "Save 17% — 2 months free",
    features: [
      "All Pro features",
      "2 months free (€66/mo equivalent)",
      "Free Hibernate months (Oct–Feb)",
      "Pre-season booking campaigns",
      "Early-bird priority",
      "Best value",
    ],
  },
];

// ─── Zustand Store ─────────────────────────────────────────

interface TierStore {
  selectedTier: string | null;
  setSelectedTier: (tier: string) => void;
}

const useTierStore = create<TierStore>((set) => ({
  selectedTier: null,
  setSelectedTier: (tier) => set({ selectedTier: tier }),
}));

// ─── Component Props ───────────────────────────────────────

interface SubscriptionTierSelectorProps {
  restaurantId: string;
  onCheckout: (tier: string) => void;
  isCheckingOut: boolean;
  scarcityError: string | null;
}

// ─── Component ─────────────────────────────────────────────

export function SubscriptionTierSelector({
  restaurantId: _restaurantId,
  onCheckout,
  isCheckingOut,
  scarcityError,
}: SubscriptionTierSelectorProps) {
  const { selectedTier, setSelectedTier } = useTierStore();

  return (
    <div className="w-full max-w-4xl mx-auto px-4 py-8 sm:py-12">
      {/* Header */}
      <div className="text-center mb-8 sm:mb-10">
        <SectionHeading className="mb-2">Choose your plan</SectionHeading>
        <SectionSubheading>
          Select the tier that fits your restaurant. You can upgrade anytime.
        </SectionSubheading>
      </div>

      {/* Tier Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 sm:gap-6 mb-8">
        {TIERS.map((tier) => (
          <button
            key={tier.id}
            type="button"
            onClick={() => setSelectedTier(tier.id)}
            className={`text-left w-full transition-all duration-150 ${
              selectedTier === tier.id
                ? "ring-2 ring-[#005bc1]"
                : "hover:ring-1 hover:ring-[#D1D1D6]"
            }`}
          >
            <Card
              className={`h-full flex flex-col ${
                selectedTier === tier.id
                  ? "bg-[rgba(0,91,193,0.03)] border-[#005bc1]"
                  : ""
              }`}
            >
              {/* Tier Name & Price */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-1">
                  <h3 className="text-[22px] font-semibold leading-[28px] text-[#1a1b1f]">
                    {tier.name}
                  </h3>
                  {tier.highlight && (
                    <span className="text-[11px] font-semibold leading-[14px] tracking-[0.05em] uppercase text-[#0070eb] bg-[#0070eb]/8 px-2 py-0.5 rounded-[6px]">
                      Best value
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-[34px] font-bold leading-[41px] tracking-[-0.02em] text-[#1a1b1f]">
                    {tier.price}
                  </span>
                  <span className="text-[15px] leading-[20px] text-[#717786]">
                    {tier.priceSuffix}
                  </span>
                </div>
                {tier.highlight && (
                  <p className="text-[13px] leading-[18px] text-[#0070eb] mt-1">
                    {tier.highlight}
                  </p>
                )}
                <p className="text-[13px] leading-[18px] text-[#717786] mt-0.5">
                  {tier.model}
                </p>
              </div>

              {/* Divider */}
              <div className="h-px bg-[#E5E5E7] mb-4" />

              {/* Feature List */}
              <ul className="space-y-2.5 flex-1">
                {tier.features.map((feature) => (
                  <li
                    key={feature}
                    className="flex items-start gap-2 text-[15px] leading-[20px] text-[#414755]"
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="#005bc1"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="mt-0.5 shrink-0"
                      aria-hidden="true"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                    {feature}
                  </li>
                ))}
              </ul>
            </Card>
          </button>
        ))}
      </div>

      {/* Error State */}
      {scarcityError && (
        <div className="mb-6 p-4 bg-[#ffdad6] border border-[#ba1a1a] rounded-[12px] text-[15px] leading-[20px] text-[#ba1a1a]">
          <p className="font-semibold">One Per Town Limit Reached</p>
          <p className="mt-1">{scarcityError}</p>
        </div>
      )}

      {/* CTA */}
      <div className="text-center">
        <button
          type="button"
          disabled={!selectedTier || isCheckingOut}
          onClick={() => selectedTier && onCheckout(selectedTier)}
          className="w-full sm:w-auto px-8 py-[14px] bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[17px] font-semibold rounded-[12px] shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#005bc1] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isCheckingOut
            ? "Redirecting to Stripe..."
            : selectedTier
              ? `Continue to Payment — ${
                  TIERS.find((t) => t.id === selectedTier)?.name ?? ""
                }`
              : "Select a plan to continue"}
        </button>
      </div>
    </div>
  );
}