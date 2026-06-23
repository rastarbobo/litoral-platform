"use client";

import { useState } from "react";
import { toast } from "sonner";
import type { SubscriptionTier } from "@/lib/subscription/tiers";

interface SubscriptionTierCardProps {
  tier: SubscriptionTier;
  isCurrentTier: boolean;
  isUpgrade: boolean;
}

/**
 * Tier comparison card rendered per-tier in the subscription page.
 * Highlights current plan, offers "Change Plan" for upgrades,
 * and "Manage Billing" for the current tier.
 */
export function SubscriptionTierCard({
  tier,
  isCurrentTier,
  isUpgrade,
}: SubscriptionTierCardProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleChangePlan = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetTier: tier.key }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        toast.error(body.message ?? "Failed to open billing portal.");
        setIsLoading(false);
        return;
      }

      const { data } = (await res.json()) as { data?: { url?: string } };
      if (data?.url) {
        // External redirect — window.location is the correct approach here
        window.location.href = data.url;
      } else {
        toast.error("Billing portal URL not received.");
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Billing portal error:", err);
      toast.error("An unexpected error occurred.");
      setIsLoading(false);
    }
  };

  return (
    <div
      className={`bg-white border rounded-[12px] p-4 shadow-[0px_4px_12px_rgba(0,0,0,0.05)] transition-shadow hover:shadow-[0px_6px_16px_rgba(0,0,0,0.08)] ${
        isCurrentTier ? "border-[#005bc1]" : "border-[#E5E5E7]"
      }`}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="text-[17px] font-semibold text-[#1a1b1f]">{tier.name}</h3>
          <p className="text-[15px] font-medium text-[#005bc1] mt-0.5">
            {tier.price}
          </p>
        </div>
        {isCurrentTier && (
          <span className="px-2 py-0.5 text-[13px] font-semibold rounded-[6px] bg-[#005bc1]/10 text-[#005bc1]">
            Current Plan
          </span>
        )}
      </div>

      {/* Feature list */}
      <ul className="space-y-1.5 mb-4">
        {tier.features.map((feature) => (
          <li key={feature} className="flex items-start gap-2 text-[15px] text-[#414755]">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#005bc1"
              strokeWidth="2"
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

      {/* CTA */}
      {isCurrentTier ? (
        <p className="text-[13px] text-[#717786] text-center">Your current plan</p>
      ) : isUpgrade ? (
        <button
          type="button"
          onClick={handleChangePlan}
          disabled={isLoading}
          className="w-full px-4 py-[12px] bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[16px] font-semibold rounded-[12px] shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#005bc1] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
        >
          {isLoading ? "Opening Portal…" : "Change Plan"}
        </button>
      ) : (
        <p className="text-[13px] text-[#717786] text-center">
          Contact support to downgrade
        </p>
      )}
    </div>
  );
}