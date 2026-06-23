"use client";

import { useState, useCallback } from "react";
import { SubscriptionTierSelector } from "./subscription-tier-selector";

/**
 * Client-side wrapper for the subscription page that handles the checkout flow:
 * 1. Calls POST /api/checkout/enroll for scarcity check
 * 2. Calls POST /api/checkout/create-session for Stripe redirect
 */

interface SubscriptionCheckoutWrapperProps {
  restaurantId: string;
}

export function SubscriptionCheckoutWrapper({
  restaurantId,
}: SubscriptionCheckoutWrapperProps) {
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [scarcityError, setScarcityError] = useState<string | null>(null);

  const handleCheckout = useCallback(
    async (tier: string) => {
      setIsCheckingOut(true);
      setScarcityError(null);

      try {
        // Step 1: Scarcity check via POST /api/checkout/enroll
        const enrollRes = await fetch("/api/checkout/enroll", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurantId, tier: "saas" }),
        });

        if (!enrollRes.ok && enrollRes.status === 409) {
          const body = await enrollRes.json();
          setScarcityError(
            body.message ?? "One Per Town limit reached for this area.",
          );
          setIsCheckingOut(false);
          return;
        }

        // Step 2: Create Stripe Checkout Session
        const sessionRes = await fetch("/api/checkout/create-session", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ restaurantId, tier }),
        });

        if (!sessionRes.ok) {
          const body = await sessionRes.json();
          setScarcityError(
            body.message ?? "Failed to create checkout session. Please try again.",
          );
          setIsCheckingOut(false);
          return;
        }

        const { data } = await sessionRes.json();

        // Step 3: Redirect to Stripe Checkout
        if (data?.url) {
          window.location.href = data.url;
        } else {
          setScarcityError("Checkout URL not received. Please try again.");
          setIsCheckingOut(false);
        }
      } catch (err) {
        console.error("Checkout flow error:", err);
        setScarcityError("An unexpected error occurred. Please try again.");
        setIsCheckingOut(false);
      }
    },
    [restaurantId],
  );

  return (
    <SubscriptionTierSelector
      restaurantId={restaurantId}
      onCheckout={handleCheckout}
      isCheckingOut={isCheckingOut}
      scarcityError={scarcityError}
    />
  );
}