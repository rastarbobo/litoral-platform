import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/utils/auth";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { getStripe } from "@/lib/stripe";
import {
  SUBSCRIPTION_PRICE_IDS,
  CreateCheckoutSessionSchema,
} from "@/lib/stripe/prices";

/**
 * Check if restaurant's email is verified before passing to Stripe.
 * Prevents Stripe Customer creation with unverified emails.
 */
function getVerifiedEmail(session: { user?: { email?: string | null; emailVerified?: Date | null } | undefined }): string | null {
  if (!session.user?.emailVerified) {
    return null;
  }
  return session.user.email ?? null;
}

/**
 * POST /api/checkout/create-session
 *
 * Creates a Stripe Checkout Session for subscription enrollment.
 * Called after the scarcity check (POST /api/checkout/enroll) succeeds.
 *
 * Auth-gated via Better Auth session cookie.
 *
 * Body (JSON):
 *   restaurantId: string   — restaurant to subscribe
 *   tier: "starter" | "pro" | "annual_pro"
 *
 * Returns JSend: { status: "success", data: { url: "https://checkout.stripe.com/..." } }
 */
export async function POST(request: NextRequest) {
  // 1. Auth check
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated" },
      { status: 401 },
    );
  }

  // 2. Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = CreateCheckoutSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        status: "error",
        message: Object.fromEntries(
          parsed.error.issues.map((i) => [i.path.join("."), i.message]),
        ),
      },
      { status: 400 },
    );
  }

  const { restaurantId, tier } = parsed.data;

  // 3. Validate restaurant exists and is still a prospect
  const restaurant = await restaurantRepo.findById(restaurantId);
  if (!restaurant) {
    return NextResponse.json(
      { status: "error", message: "Restaurant not found" },
      { status: 404 },
    );
  }

  if (restaurant.subscriptionStatus !== "prospect") {
    return NextResponse.json(
      {
        status: "error",
        message: `Restaurant is already enrolled (status: ${restaurant.subscriptionStatus})`,
      },
      { status: 409 },
    );
  }

  if (!restaurant.cuisineType || !restaurant.locationArea) {
    return NextResponse.json(
      {
        status: "error",
        message: "Restaurant missing cuisine type or location area",
      },
      { status: 400 },
    );
  }

  // 4. Scarcity check — prevent payment if cuisine/area is already full
  const scarcity = await restaurantRepo.getScarcityForCuisineArea(
    restaurant.cuisineType,
    restaurant.locationArea,
    'saas',
  );
  if (!scarcity.isAvailable) {
    return NextResponse.json(
      {
        status: "error",
        message: `Sorry, the subscription limit has been reached for ${restaurant.cuisineType} cuisine in ${restaurant.locationArea}.`,
      },
      { status: 409 },
    );
  }

  // 5. Verify email is verified before passing to Stripe
  const verifiedEmail = getVerifiedEmail(session);
  if (!verifiedEmail) {
    return NextResponse.json(
      {
        status: "error",
        message: "Email must be verified before proceeding to payment.",
      },
      { status: 403 },
    );
  }

  // 6. Resolve Stripe Price ID
  const priceId = SUBSCRIPTION_PRICE_IDS[tier];
  if (!priceId || priceId === "") {
    return NextResponse.json(
      {
        status: "error",
        message: `Stripe Price ID not configured for tier: ${tier}`,
      },
      { status: 500 },
    );
  }

  // 7. Determine success/cancel URLs
  const origin = new URL(request.url).origin;

  try {
    const checkoutSession = await getStripe().checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${origin}/dashboard?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/dashboard/billing?canceled=true`,
      metadata: {
        restaurantId,
        tier,
      },
      customer_email: verifiedEmail,
    });

    return NextResponse.json({
      status: "success",
      data: { url: checkoutSession.url },
    });
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    return NextResponse.json(
      {
        status: "error",
        message:
          err instanceof Error ? err.message : "Failed to create checkout session",
      },
      { status: 500 },
    );
  }
}