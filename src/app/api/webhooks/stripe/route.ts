import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { getCloudflareContext } from "@/utils/cloudflare-context";

/**
 * POST /api/webhooks/stripe
 *
 * Stripe webhook handler. Processes checkout.session.completed events
 * to complete restaurant enrollment after successful payment.
 *
 * Signature verification via stripe.webhooks.constructEvent().
 * KV deduplication (stripe_event:{id}, 7-day TTL) prevents double-processing.
 *
 * NOT auth-gated — authenticated via Stripe signature header.
 */
export async function POST(request: NextRequest) {
  const signature = request.headers.get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("STRIPE_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      { status: "error", message: "Webhook secret not configured" },
      { status: 500 },
    );
  }

  // 1. Read raw body for signature verification
  const rawBody = await request.text();

  let event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json(
      { status: "error", message: "Invalid signature" },
      { status: 400 },
    );
  }

  // 2. Deduplication via KV
  const dedupeKey = `stripe_event:${event.id}`;
  const { env } = await getCloudflareContext();
  const stripeKV = env.STRIPE_KV as KVNamespace | undefined;

  // Check if already processed
  if (stripeKV) {
    const existing = await stripeKV.get(dedupeKey);
    if (existing !== null) {
      console.log(`Stripe webhook: duplicate event ${event.id} — skipping`);
      return NextResponse.json({ received: true });
    }
  }

  // 3. Handle event types
  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const { restaurantId, tier } = (session.metadata ?? {}) as {
          restaurantId?: string;
          tier?: string;
        };

        // Robust ID extraction: handle both string IDs and expanded Stripe objects
        const stripeCustomerId = extractStripeId(session.customer);
        const stripeSubscriptionId = extractStripeId(session.subscription);

        if (!restaurantId) {
          console.error(
            `Stripe webhook: checkout.session.completed missing restaurantId in metadata — session: ${session.id}`,
          );
          await markEventProcessed(stripeKV, dedupeKey);
          return NextResponse.json({ received: true });
        }

        if (!stripeCustomerId || !stripeSubscriptionId) {
          console.error(
            `Stripe webhook: checkout.session.completed missing customer/subscription IDs — session: ${session.id}`,
          );
          await markEventProcessed(stripeKV, dedupeKey);
          return NextResponse.json({ received: true });
        }

        // Call repository to enroll the restaurant
        const result = await restaurantRepo.enrollViaStripeCheckout(
          restaurantId,
          tier ?? "starter",
          stripeCustomerId,
          stripeSubscriptionId,
        );

        // Track if enrollment succeeded so we can conditionally fire competitor activation
        const enrollmentSucceeded = result.type === "SUCCESS";

        if (enrollmentSucceeded) {
          // Check if this enrollment filled the 2nd SaaS slot (specifically this one)
          if (tier !== "agency") {
            const restaurant = await restaurantRepo.findById(restaurantId);
            if (restaurant?.cuisineType && restaurant.locationArea) {
              const preEnrollmentScarcity = await restaurantRepo.getScarcityForCuisineArea(
                restaurant.cuisineType,
                restaurant.locationArea,
                "saas",
              );
              // If saasCount is now 2 (i.e., this enrollment was the one that filled the slot), trigger
              if (preEnrollmentScarcity && preEnrollmentScarcity.saasCount === 2) {
                const origin = new URL(request.url).origin;
                const competitorWebhook = fetch(`${origin}/api/checkout/competitor-activated`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ restaurantId }),
                });

                // Use Promise.allSettled for non-blocking side effects per Story 3.3 pattern
                await Promise.allSettled([
                  markEventProcessed(stripeKV, dedupeKey),
                  competitorWebhook.catch((err) => {
                    console.error(
                      "Competitor activation webhook fire-and-forget failed (stripe webhook)",
                      { error: err, restaurantId },
                    );
                  }),
                ]);
                return NextResponse.json({ received: true });
              }
            }
          }
        } else if (result.type === "NOT_FOUND" || result.type === "ALREADY_ENROLLED") {
          console.warn(
            `Stripe webhook: enrollment result ${result.type} for restaurant ${restaurantId} — session: ${session.id}`,
          );
        }

        await markEventProcessed(stripeKV, dedupeKey);
        return NextResponse.json({ received: true });
      }

      case "checkout.session.expired":
      case "checkout.session.async_payment_failed": {
        const session = event.data.object;
        const { restaurantId } = (session.metadata ?? {}) as {
          restaurantId?: string;
        };
        console.info(
          `Stripe webhook: ${event.type} — session: ${session.id}, restaurant: ${restaurantId ?? "unknown"}`,
        );
        await markEventProcessed(stripeKV, dedupeKey);
        return NextResponse.json({ received: true });
      }

      default:
        // Unhandled event type — log and acknowledge
        console.info(`Stripe webhook: unhandled event type ${event.type}`);
        return NextResponse.json({ received: true });
    }
  } catch (err) {
    console.error(`Stripe webhook: error processing event ${event.id}:`, err);
    return NextResponse.json(
      { status: "error", message: "Internal error processing webhook" },
      { status: 500 },
    );
  }
}

/** Write KV dedup key with 7-day TTL (fire-and-forget). */
async function markEventProcessed(
  kv: KVNamespace | undefined,
  key: string,
): Promise<void> {
  if (!kv) return;
  try {
    await kv.put(key, "1", { expirationTtl: 604800 });
  } catch (err) {
    console.error(`Failed to mark Stripe event as processed in KV: ${key}`, err);
  }
}

/** Helper: robustly extract a Stripe ID from either a string or an expanded Stripe object. */
function extractStripeId(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value && typeof value === "object" && "id" in value) {
    return (value as { id?: string }).id ?? "";
  }
  return "";
}