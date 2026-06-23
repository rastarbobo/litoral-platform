import { NextRequest, NextResponse } from "next/server";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { resolveRestaurantForUser } from "@/lib/dashboard/user-restaurant";

/**
 * POST /api/extension/token/clear
 *
 * Clears the extension auth token for the authenticated restaurant.
 * Used when subscription is cancelled (n8n invokes this) or
 * when the owner wants to manually disconnect the extension.
 *
 * Auth: Dual-mode:
 *   - Better Auth session cookie (dashboard user authentication)
 *   - N8N_API_SECRET Bearer token (n8n service-to-service, body: { restaurantId })
 *
 * JSend response.
 */
export async function POST(req: NextRequest) {
  try {
    // Try dashboard session auth first
    const sessionResolved = await resolveRestaurantForUser();
    if (sessionResolved) {
      return handleTokenClear(sessionResolved.restaurantId);
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

      return handleTokenClear(restaurantId);
    }

    return NextResponse.json(
      { status: "error", message: "Authentication required. Please sign in." },
      { status: 401 },
    );
  } catch (err) {
    console.error("Extension token clear: unhandled error", err);
    return NextResponse.json(
      { status: "error", message: "Internal server error" },
      { status: 500 },
    );
  }
}

async function handleTokenClear(restaurantId: string) {
  const result = await restaurantRepo.clearExtensionAuthToken(restaurantId);

  if (result.type === "DATABASE_ERROR") {
    console.error("Extension token clear: DB error", { restaurantId, error: result.message });
    return NextResponse.json(
      { status: "error", message: "Failed to clear extension token. Please try again." },
      { status: 500 },
    );
  }

  return NextResponse.json({
    status: "success",
    data: { cleared: true },
  });
}