
import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import { resolveRestaurantForUser } from "@/lib/dashboard/user-restaurant";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { ExtensionTokenDisplay } from "@/components/dashboard/settings/extension-token-display";
import { Card, SectionHeading, SectionSubheading } from "@/components/onboarding/shared";
import type { Metadata } from "next";

/**
 * Dashboard Extension Settings — server-rendered page.
 *
 * Route: /dashboard/settings/extension
 *
 * Displays the extension auth token for the Chrome Extension.
 * The token is generated on first visit (or manual click).
 * Requires an active subscription (active_saas or active_agency).
 */

export const metadata: Metadata = {
  title: "Extension — Litoral Agency",
  description: "Connect the Litoral Agency Chrome Extension.",
};

export default async function ExtensionSettingsPage() {
  const session = await getSessionFromCookie();

  if (!session) {
    return redirect("/");
  }

  const resolved = await resolveRestaurantForUser();

  if (!resolved) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative flex items-center justify-center">
        <Card className="max-w-sm mx-4 text-center">
          <p className="text-[17px] text-[#414755]">
            Complete your onboarding first to access extension settings.
          </p>
        </Card>
      </div>
    );
  }

  const { restaurantId } = resolved;

  // Load subscription status and existing token
  const subscription = await restaurantRepo.getSubscriptionStatus(restaurantId);
  const existingToken = await restaurantRepo.getExtensionAuthToken(restaurantId);

  const isActive = subscription?.status === "active_saas" || subscription?.status === "active_agency";

  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
      <div className="w-full max-w-2xl mx-auto px-4 py-8 sm:py-12">
        <SectionHeading className="mb-2">Chrome Extension</SectionHeading>
        <SectionSubheading className="mb-6">
          Connect the Litoral Agency browser extension to publish campaigns from your own computer.
        </SectionSubheading>

        <ExtensionTokenDisplay
          restaurantId={restaurantId}
          initialToken={existingToken}
          isSubscriptionActive={isActive ?? false}
        />
      </div>
    </div>
  );
}