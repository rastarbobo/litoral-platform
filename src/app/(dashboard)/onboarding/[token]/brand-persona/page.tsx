import { validateOnboardingToken } from "@/lib/onboarding/tokens";
import { ExpiredLinkCard } from "@/components/onboarding/expired-link-card";
import { BrandPersonaForm } from "@/components/onboarding/brand-persona-form";
import { parseFragmentForPreFill } from "@/lib/brand-persona/fragment";
import type { Metadata } from "next";

/**
 * Brand Persona onboarding step — rendered server-side.
 *
 * Route: /onboarding/[token]/brand-persona
 *
 * 1. Validates the onboarding token.
 * 2. If expired/invalid → renders graceful expired card (no 404).
 * 3. Checks onboardingState is 'brand_persona_pending'.
 * 4. Pre-fills form from D1 fragment if partially completed.
 * 5. Renders the 5-step Brand Persona wizard.
 *
 * All above-fold content is server-rendered per NFR-1 (LCP < 1.5s).
 */

export const metadata: Metadata = {
  title: "Brand Persona — Litoral Agency",
  description: "Tell us about your restaurant's personality so we can create authentic content.",
};

export default async function BrandPersonaPage({
  params,
}: {
  params: { token: string };
}) {
  const { restaurant, error } = await validateOnboardingToken(params.token);

  // Token is expired, already used, or invalid — render graceful card
  if (error || !restaurant) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
        <ExpiredLinkCard />
      </div>
    );
  }

  // Check onboarding state — only allow access when in brand_persona_pending
  if (restaurant.onboardingState !== "brand_persona_pending") {
    // If already completed, redirect or show appropriate message
    if (
      restaurant.onboardingState === "brand_persona_completed" ||
      restaurant.onboardingState === "completed"
    ) {
      return (
        <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
          <div className="flex flex-col items-center justify-center min-h-screen px-4">
            <div className="text-center space-y-4">
              <h1 className="text-[24px] sm:text-[28px] font-bold text-[#1a1b1f]">
                You&apos;re all set!
              </h1>
              <p className="text-[16px] text-[#414755]">
                Your brand persona has already been saved. Continue to the next step.
              </p>
            </div>
          </div>
        </div>
      );
    }
  }

  // Pre-fill from existing fragment
  const preFill = parseFragmentForPreFill(restaurant.brandPersonaFragment);

  // Valid token + correct state — render Brand Persona wizard
  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
      <BrandPersonaForm
        initialValues={preFill ?? undefined}
        token={params.token}
      />
    </div>
  );
}