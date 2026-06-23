import { NextRequest, NextResponse } from "next/server";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { resolveRestaurantForUser } from "@/lib/dashboard/user-restaurant";

// ── Basic per-isolate rate limiter (dashboard path only) ───
const RATE_LIMIT_WINDOW_MS = 5_000; // 5 s between dashboard requests
const rateTimestamps = new Map<string, number>();

function isRateLimited(restaurantId: string): boolean {
  const last = rateTimestamps.get(restaurantId);
  if (!last) return false;
  return Date.now() - last < RATE_LIMIT_WINDOW_MS;
}

function recordRateLimit(restaurantId: string) {
  rateTimestamps.set(restaurantId, Date.now());
  // Simple periodic cleanup (every ~1000 entries)
  if (rateTimestamps.size > 1000) {
    const cutoff = Date.now() - RATE_LIMIT_WINDOW_MS * 2;
    for (const [id, ts] of rateTimestamps) {
      if (ts < cutoff) rateTimestamps.delete(id);
    }
  }
}

/**
 * POST /api/extension/token/generate
 *
 * Generates (or returns existing) an extension auth token for the authenticated restaurant.
 * Used by the dashboard Settings → Extension page.
 *
 * Query params:
 *   ?force=true  — regenerate even if a token already exists (for token rotation)
 *
 * Auth: Dual-mode:
 *   - Better Auth session cookie (dashboard user authentication)
 *   - N8N_API_SECRET Bearer token (n8n service-to-service, body: { restaurantId, restaurantSlug })
 *
 * JSend response.
 */
export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const forceRegenerate = url.searchParams.get("force") === "true";

    // Try dashboard session auth first
    const sessionResolved = await resolveRestaurantForUser();
    if (sessionResolved) {
      return handleTokenGeneration(sessionResolved.restaurantId, forceRegenerate, false);
    }

    // Fallback: n8n service-to-service auth
    const authHeader = req.headers.get("authorization");
    const n8nSecret = process.env.N8N_API_SECRET;

    if (authHeader && n8nSecret && authHeader === `Bearer ${n8nSecret}`) {
      const body = (await req.json().catch(() => ({}))) as { restaurantId?: string; restaurantSlug?: string };
      let restaurantId = body.restaurantId;

      // Fallback: resolve by slug if restaurantId not supplied
      if (!restaurantId && body.restaurantSlug) {
        const restaurant = await restaurantRepo.findBySlug(body.restaurantSlug);
        restaurantId = restaurant?.id;
      }

      if (!restaurantId) {
        return NextResponse.json(
          { status: "error", message: "Missing restaurantId (or restaurantSlug) for service-to-service request" },
          { status: 400 },
        );
      }

      return handleTokenGeneration(restaurantId, forceRegenerate, true);
    }

    return NextResponse.json(
      { status: "error", message: "Authentication required. Please sign in." },
      { status: 401 },
    );
  } catch (err) {
    console.error("Extension token generate: unhandled error", err);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}

async function handleTokenGeneration(restaurantId: string, forceRegenerate: boolean, skipRateLimit: boolean = false) {
  // Verify the restaurant has an active subscription
  const subscription = await restaurantRepo.getSubscriptionStatus(restaurantId);
  if (!subscription) {
    return NextResponse.json(
      { status: "error", message: "Restaurant not found." },
      { status: 404 },
    );
  }

  const isActive = subscription.status === "active_saas" || subscription.status === "active_agency";
  if (!isActive) {
    return NextResponse.json(
      { status: "error", message: "Extension requires an active subscription. Please subscribe first." },
      { status: 403 },
    );
  }

  // Rate-limit dashboard-initiated requests only
  if (!skipRateLimit) {
    if (isRateLimited(restaurantId)) {
      return NextResponse.json(
        { status: "error", message: "Please wait a moment before generating another token." },
        { status: 429 },
      );
    }
    recordRateLimit(restaurantId);
  }

  let result;
  if (forceRegenerate) {
    result = await restaurantRepo.regenerateExtensionAuthToken(restaurantId);
  } else {
    result = await restaurantRepo.generateExtensionAuthToken(restaurantId);
  }

  if (result.type === "DATABASE_ERROR") {
    console.error("Extension token generate: DB error", { restaurantId, error: result.message });
    return NextResponse.json(
      { status: "error", message: "Failed to generate extension token. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "success",
    data: { extensionAuthToken: result.token },
  });
}