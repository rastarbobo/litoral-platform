import { Suspense } from "react";
import { getSessionFromCookie } from "@/utils/auth";
import { redirect } from "next/navigation";
import { resolveRestaurantForUser } from "@/lib/dashboard/user-restaurant";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { loadBrandPersonaFromR2 } from "@/lib/brand-persona/r2";
import { BrandPersonaDashboardEditor } from "@/components/onboarding/brand-persona-dashboard-editor";
import { BrandPersonaSkeleton } from "@/components/dashboard/settings/brand-persona-skeleton";
import type { Metadata } from "next";

/**
 * Dashboard Brand Persona Editor — server-rendered page.
 *
 * Route: /dashboard/settings/brand-persona
 *
 * Authenticated route. Resolves the restaurant from the Better Auth session
 * (no query params needed). Loads the full persona document from R2 for editing.
 * Falls back gracefully if no restaurant is linked.
 *
 * SECURITY: Restaurant is resolved server-side from the session. Direct ID
 * injection via query params is no longer possible.
 */

export const metadata: Metadata = {
  title: "Brand Persona — Litoral Agency",
  description: "Edit your restaurant's brand voice and personality.",
};

export default async function BrandPersonaSettingsPage() {
  const session = await getSessionFromCookie();

  if (!session) {
    return redirect("/");
  }

  // Resolve restaurant from auth session — no query params
  const resolved = await resolveRestaurantForUser();

  if (!resolved) {
    // No valid restaurant linked — prompt onboarding
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <h1 className="text-[24px] font-bold text-[#1a1b1f]">Brand Persona</h1>
          <p className="text-[16px] text-[#717786]">
            Complete your onboarding first to access the brand persona editor.
          </p>
        </div>
      </div>
    );
  }

  const { restaurantId, slug } = resolved;

  // Load persona from R2
  const restaurant = await restaurantRepo.findById(restaurantId);
  const initialPersona = restaurant?.brandPersonaR2Key
    ? await loadBrandPersonaFromR2(restaurant.brandPersonaR2Key)
    : null;

  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans">
      <Suspense fallback={<BrandPersonaSkeleton />}>
        <BrandPersonaDashboardEditor
          initialPersona={initialPersona}
          restaurantId={restaurantId}
          slug={slug}
        />
      </Suspense>
    </div>
  );
}