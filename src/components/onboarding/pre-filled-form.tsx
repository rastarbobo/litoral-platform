"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, PrimaryButton, TextInput, VerifiedBadge, SectionHeading, SectionSubheading } from "@/components/onboarding/shared";
import type { Restaurant } from "@/db/schema";

/**
 * Onboarding data confirmation form.
 *
 * Displays pre-filled restaurant data (name, location, cuisine type,
 * social accounts) and allows the owner to confirm or correct.
 * On submit, sends corrections to the API and transitions to the
 * next step (Brand Persona — Story 3.2).
 */
export function PreFilledOnboardingForm({
  restaurant,
  token,
}: {
  restaurant: Restaurant;
  token: string;
}) {
  const router = useRouter();
  const [name, setName] = useState(restaurant.name ?? "");
  const [location, setLocation] = useState(restaurant.location ?? "");
  const [cuisineType, setCuisineType] = useState(restaurant.cuisineType ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // Pre-fill social accounts from existing data
  // TODO: Move instagramHandle to a dedicated column (see schema.md#social-accounts)
  const instagramHandle = restaurant.googleMapsData
    ? (restaurant.googleMapsData as Record<string, unknown>).instagramHandle as string | undefined
    : undefined;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setServerError(null);

    // Build corrections — only include fields that differ from originals
    const corrections: Record<string, { original: string; corrected: string }> = {};
    if (name !== (restaurant.name ?? "")) {
      corrections.name = { original: restaurant.name ?? "", corrected: name };
    }
    if (location !== (restaurant.location ?? "")) {
      corrections.location = { original: restaurant.location ?? "", corrected: location };
    }
    if (cuisineType !== (restaurant.cuisineType ?? "")) {
      corrections.cuisineType = { original: restaurant.cuisineType ?? "", corrected: cuisineType };
    }

    try {
      const res = await fetch(`/api/onboarding/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          name,
          location,
          cuisineType,
          corrections: Object.keys(corrections).length > 0 ? corrections : undefined,
        }),
      });

      const body = (await res.json()) as { status?: string; message?: string; data?: { nextStep?: string } };

      if (!res.ok || body.status === "error") {
        setServerError(body.message ?? "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }

      // Redirect to next step (Brand Persona — handled by Story 3.2)
      const nextStep = body.data?.nextStep ?? "brand-persona";
      router.push(`/onboarding/${token}/${nextStep}`);
    } catch {
      setServerError("Network error. Please check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col items-center pt-8 px-4 md:px-8 w-full max-w-xl mx-auto font-sans">
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <SectionHeading>Welcome, {restaurant.name}</SectionHeading>
          <SectionSubheading>
            We&apos;ve pre-filled your details from our research. Just confirm
            they&apos;re correct or fix anything that needs updating.
          </SectionSubheading>
        </div>

        {/* Pre-filled Form Card */}
        <Card className="w-full">
          <form onSubmit={handleSubmit} className="flex flex-col gap-6">
            <TextInput
              label="Restaurant Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              placeholder="Your restaurant name"
            />

            <TextInput
              label="Location (Town/City)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              required
              placeholder="e.g., Nazaré"
            />

            <TextInput
              label="Cuisine Type"
              value={cuisineType}
              onChange={(e) => setCuisineType(e.target.value)}
              required
              placeholder="e.g., Seafood, Traditional"
            />

            {/* Linked Accounts */}
            <div className="space-y-2">
              <p className="text-[15px] font-medium text-[#1a1b1f]">
                Linked Accounts
              </p>
              <div className="flex flex-wrap gap-2">
                <VerifiedBadge
                  platform="Google Maps"
                  isConnected={!!restaurant.googlePlaceId}
                  handle={restaurant.googlePlaceId ? `Verified (${restaurant.googleRating}★)` : undefined}
                />
                <VerifiedBadge
                  platform="Instagram"
                  isConnected={!!instagramHandle}
                  handle={instagramHandle}
                />
              </div>
            </div>

            {/* Server error */}
            {serverError && (
              <div className="p-3 bg-[#ffdad6] border border-[#ba1a1a]/20 rounded-[8px] text-[15px] text-[#ba1a1a]">
                {serverError}
              </div>
            )}

            {/* Submit */}
            <PrimaryButton type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Saving..." : "Confirm & Continue"}
            </PrimaryButton>
          </form>
        </Card>

        {/* Footer note */}
        <p className="text-center text-[13px] text-[#717786]">
          By continuing, you agree to Litoral Agency&apos;s Terms of Service.
        </p>
      </div>
    </div>
  );
}