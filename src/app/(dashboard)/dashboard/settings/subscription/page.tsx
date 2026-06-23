import { Suspense } from "react";
import { getSessionFromCookie } from "@/utils/auth";
import { resolveRestaurantForUser } from "@/lib/dashboard/user-restaurant";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { Card, SectionHeading, SectionSubheading } from "@/components/onboarding/shared";
import { SUBSCRIPTION_TIERS, TIER_LABELS, isUpgrade } from "@/lib/subscription/tiers";
import { SubscriptionManageClient } from "./client";
import { SubscriptionTierCard } from "./tier-card";
import { SubscriptionSkeleton } from "@/components/dashboard/settings/subscription-skeleton";
import { TierSync } from "./tier-sync";
import { PlanUpdatedBanner } from "./plan-updated-banner";
import type { Metadata } from "next";

/**
 * Subscription management page — rendered server-side.
 *
 * Route: /dashboard/settings/subscription
 *
 * Displays current subscription tier, status badge, next billing date,
 * and tier comparison cards with upgrade/downgrade logic.
 */

export const metadata: Metadata = {
  title: "Subscription — Litoral Agency",
  description: "Manage your Litoral Agency subscription.",
};

/** Map internal subscription status to human-readable label */
function formatStatusLabel(status: string | null): string {
  switch (status) {
    case "active_saas":
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "prospect":
    default:
      return "No active subscription";
  }
}

function formatDate(timestamp: number | null): string {
  if (!timestamp) return "N/A";
  try {
    return new Date(timestamp * 1000).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "N/A";
  }
}

export default async function SubscriptionPage() {
  const session = await getSessionFromCookie();
  if (!session) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative flex items-center justify-center">
        <Card className="max-w-sm mx-4 text-center">
          <p className="text-[17px] text-[#414755]">
            Please sign in to manage your subscription.
          </p>
        </Card>
      </div>
    );
  }

  // Resolve restaurant from the authenticated session
  const resolved = await resolveRestaurantForUser();

  if (!resolved) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative flex items-center justify-center">
        <Card className="max-w-sm mx-4 text-center">
          <p className="text-[17px] text-[#414755]">
            Complete your onboarding first to manage your subscription.
          </p>
        </Card>
      </div>
    );
  }

  const { restaurantId } = resolved;

  // Load subscription status from repository
  const subscription = await restaurantRepo.getSubscriptionStatus(restaurantId);
  const isActive = subscription?.status !== "prospect" && subscription?.status !== null;
  const currentTier = subscription?.tier ?? null;
  const tierLabel = currentTier ? (TIER_LABELS[currentTier] ?? currentTier) : null;

  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
      <TierSync currentTier={currentTier} />
      <PlanUpdatedBanner currentTier={currentTier} />
      <div className="w-full max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <SectionHeading className="mb-2">Subscription</SectionHeading>
        <SectionSubheading className="mb-6">
          Manage your plan, billing, and payment methods.
        </SectionSubheading>

        <Suspense fallback={<SubscriptionSkeleton />}>
        {/* Current Plan Summary */}
        <Card>
          <div className="space-y-4">
            <div>
              <p className="text-[13px] font-semibold leading-[16px] tracking-[0.05em] uppercase text-[#717786] mb-1">
                Current Plan
              </p>
              <div className="flex items-center justify-between">
                <p className="text-[17px] font-semibold text-[#1a1b1f]">
                  {tierLabel ?? "Free"}
                </p>
                <span
                  className={`px-2 py-0.5 text-[13px] font-semibold rounded-[6px] ${
                    isActive
                      ? "bg-[#0070eb]/10 text-[#0070eb]"
                      : "bg-gray-100 text-gray-500"
                  }`}
                >
                  {isActive ? "Active" : "Inactive"}
                </span>
              </div>
            </div>

            <div className="h-px bg-[#E5E5E7]" />

            {/* Billing Info */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-[13px] font-semibold leading-[16px] tracking-[0.05em] uppercase text-[#717786] mb-1">
                  Next Billing Date
                </p>
                <p className="text-[17px] text-[#1a1b1f]">
                  {formatDate(subscription?.currentPeriodEnd ?? null)}
                </p>
              </div>
              <div>
                <p className="text-[13px] font-semibold leading-[16px] tracking-[0.05em] uppercase text-[#717786] mb-1">
                  Status
                </p>
                <p className="text-[17px] text-[#1a1b1f]">
                  {formatStatusLabel(subscription?.status)}
                </p>
              </div>
            </div>
          </div>
        </Card>

        {/* Tier Comparison */}
        <div className="mt-6 space-y-3">
          <p className="text-[13px] font-semibold leading-[16px] tracking-[0.05em] uppercase text-[#717786] px-1">
            Available Plans
          </p>

          {SUBSCRIPTION_TIERS.map((tier) => (
            <SubscriptionTierCard
              key={tier.key}
              tier={tier}
              isCurrentTier={currentTier === tier.key}
              isUpgrade={isUpgrade(currentTier, tier.key)}
            />
          ))}
        </div>

        {/* Generic Manage Billing (for non-upgrade scenarios) */}
        <div className="mt-6">
          <SubscriptionManageClient />
        </div>
      </Suspense>
      </div>
    </div>
  );
}