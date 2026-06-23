import { validateOnboardingToken } from "@/lib/onboarding/tokens";
import { ExpiredLinkCard } from "@/components/onboarding/expired-link-card";
import { PreFilledOnboardingForm } from "@/components/onboarding/pre-filled-form";
import type { Metadata } from "next";

/**
 * Onboarding page — rendered server-side.
 *
 * Route: /onboarding/[token]
 *
 * 1. Validates the magic link token.
 * 2. If expired/invalid → renders graceful expired card (no 404).
 * 3. If valid → renders pre-filled onboarding form with restaurant data.
 *
 * All above-fold content is server-rendered per NFR-1 (LCP < 1.5s).
 */

export const metadata: Metadata = {
  title: "Onboarding — Litoral Agency",
  description: "Confirm your restaurant details to get started with Litoral Agency.",
};

export default async function OnboardingPage({ params }: { params: { token: string } }) {
  const { restaurant, error } = await validateOnboardingToken(params.token);

  // Token is expired, already used, or invalid — render graceful card
  if (error || !restaurant) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
        <ExpiredLinkCard />
      </div>
    );
  }

  // Valid token — render pre-filled onboarding form
  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
      <PreFilledOnboardingForm restaurant={restaurant} token={params.token} />
    </div>
  );
}
