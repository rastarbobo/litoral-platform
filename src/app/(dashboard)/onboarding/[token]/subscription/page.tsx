import { validateOnboardingToken } from "@/lib/onboarding/tokens";
import { ExpiredLinkCard } from "@/components/onboarding/expired-link-card";
import { SubscriptionCheckoutWrapper } from "@/components/onboarding/subscription-checkout-wrapper";
import type { Metadata } from "next";

/**
 * Subscription tier selection page — rendered server-side.
 *
 * Route: /onboarding/[token]/subscription
 *
 * 1. Validates the magic link token.
 * 2. If expired/invalid → renders graceful expired card.
 * 3. If valid & brand persona completed → renders tier selection UI.
 *
 * All above-fold content is server-rendered per NFR-1 (LCP < 1.5s).
 */

export const metadata: Metadata = {
  title: "Choose Your Plan — Litoral Agency",
  description: "Select the subscription tier that fits your restaurant.",
};

export default async function SubscriptionPage({
  params,
}: {
  params: { token: string };
}) {
  const { restaurant, error } = await validateOnboardingToken(params.token);

  // Token is expired, already used, or invalid
  if (error || !restaurant) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
        <ExpiredLinkCard />
      </div>
    );
  }

  // Ensure Brand Persona has been completed before subscription step
  if (restaurant.onboardingState !== "brand_persona_completed") {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
        <ExpiredLinkCard />
      </div>
    );
  }

  // If already subscribed, show a completion state
  if (
    restaurant.subscriptionStatus &&
    restaurant.subscriptionStatus !== "prospect"
  ) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative flex items-center justify-center">
        <div className="bg-white border border-[#E5E5E7] rounded-[12px] p-8 max-w-sm mx-4 shadow-[0px_4px_12px_rgba(0,0,0,0.05)] text-center">
          <div className="w-12 h-12 bg-[#0070eb]/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#005bc1"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h2 className="text-[20px] font-semibold text-[#1a1b1f] mb-1">
            You&apos;re all set!
          </h2>
          <p className="text-[15px] text-[#414755]">
            Your subscription is active. Head to the dashboard to get started.
          </p>
        </div>
      </div>
    );
  }

  // Render the tier selection UI (client component handles interactivity)
  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
      <SubscriptionCheckoutWrapper restaurantId={restaurant.id} />
    </div>
  );
}