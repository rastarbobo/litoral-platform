import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/utils/auth";
import { resolveRestaurantForUser } from "@/lib/dashboard/user-restaurant";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { getStripe } from "@/lib/stripe";

/**
 * Stripe Price ID to Subscription Item ID mapping for tier upgrades.
 * Populated from environment variables. Falls back gracefully if not configured.
 */
interface TierPriceEntry {
  priceId: string;
  subscriptionItemId: string;
}

function getTierPriceMap(): Record<string, TierPriceEntry> {
  return {
    starter: {
      priceId: process.env.STRIPE_STARTER_PRICE_ID ?? "",
      subscriptionItemId: process.env.STRIPE_STARTER_ITEM_ID ?? "",
    },
    pro: {
      priceId: process.env.STRIPE_PRO_PRICE_ID ?? "",
      subscriptionItemId: process.env.STRIPE_PRO_ITEM_ID ?? "",
    },
    annual_pro: {
      priceId: process.env.STRIPE_ANNUAL_PRICE_ID ?? "",
      subscriptionItemId: process.env.STRIPE_ANNUAL_ITEM_ID ?? "",
    },
  };
}

/**
 * POST /api/billing/portal
 *
 * Creates a Stripe Customer Portal session for billing management.
 *
 * Body (optional):
 *   targetTier: string — pre-selects a plan change to this tier
 *     (e.g., "pro", "annual_pro")
 *
 * If no targetTier is provided, creates a generic portal session
 * (manage payment methods, invoices, cancel, etc.).
 *
 * Auth-gated via Better Auth session cookie.
 * Returns JSend: { status: "success", data: { url: "https://billing.stripe.com/..." } }
 */
export async function POST(request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated" },
      { status: 401 },
    );
  }

  // Resolve restaurant from session
  const resolved = await resolveRestaurantForUser();
  if (!resolved) {
    return NextResponse.json(
      {
        status: "error",
        message: "Billing portal requires a linked restaurant. Complete onboarding first.",
      },
      { status: 404 },
    );
  }

  const { restaurantId } = resolved;

  // Fetch subscription details
  const subscription = await restaurantRepo.getSubscriptionStatus(restaurantId);
  if (!subscription?.stripeSubscriptionId) {
    return NextResponse.json(
      {
        status: "error",
        message: "No active Stripe subscription found.",
      },
      { status: 404 },
    );
  }

  const stripeCustomerId = await getStripeCustomerId(restaurantId);
  if (!stripeCustomerId) {
    return NextResponse.json(
      {
        status: "error",
        message: "No Stripe customer linked to this account.",
      },
      { status: 404 },
    );
  }

  // Parse optional targetTier
  let targetTier: string | null = null;
  try {
    const body = (await request.json()) as { targetTier?: string };
    targetTier = body.targetTier ?? null;
  } catch {
    // No body — generic portal session
  }

  const stripe = getStripe();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  const returnUrl = `${baseUrl}/dashboard/settings/subscription`;

  try {
    // Build portal session configuration
    const sessionConfig: Stripe.BillingPortal.SessionCreateParams = {
      customer: stripeCustomerId,
      return_url: returnUrl,
    };

    // If a target tier is specified, pre-select it via flow_data
    if (targetTier) {
      const tierMap = getTierPriceMap();
      const tierEntry = tierMap[targetTier];

      if (tierEntry?.priceId && tierEntry?.subscriptionItemId && subscription.stripeSubscriptionId) {
        sessionConfig.flow_data = {
          type: "subscription_update_confirm" as const,
          subscription_update_confirm: {
            subscription: subscription.stripeSubscriptionId,
            items: [
              {
                id: tierEntry.subscriptionItemId,
                price: tierEntry.priceId,
              },
            ],
          },
        };
      }
    }

    const portalSession =
      await stripe.billingPortal.sessions.create(sessionConfig);

    return NextResponse.json({
      status: "success",
      data: { url: portalSession.url },
    });
  } catch (err) {
    console.error("Billing portal session creation failed:", err);
    return NextResponse.json(
      {
        status: "error",
        message: "Failed to create billing portal session. Please try again.",
      },
      { status: 500 },
    );
  }
}

/**
 * Resolve the Stripe customer ID for a restaurant.
 * Falls back to querying the restaurant record for stripeCustomerId.
 */
async function getStripeCustomerId(
  restaurantId: string,
): Promise<string | null> {
  const restaurant = await restaurantRepo.findById(restaurantId);
  if (!restaurant?.stripeCustomerId) return null;
  return restaurant.stripeCustomerId as string;
}