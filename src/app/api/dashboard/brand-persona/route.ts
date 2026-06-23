import { NextRequest, NextResponse } from "next/server";
import { getSessionFromCookie } from "@/utils/auth";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { BrandPersonaEditSchema } from "@/lib/brand-persona/types";
import { buildFullPersona, generateFragment } from "@/lib/brand-persona/fragment";
import { resolveRestaurantForUser } from "@/lib/dashboard/user-restaurant";
import { loadBrandPersonaFromR2 } from "@/lib/brand-persona/r2";

// ─── GET Handler ───────────────────────────────────────────

/**
 * GET /api/dashboard/brand-persona
 *
 * Fetches the current Brand Persona for the authenticated restaurant owner.
 * Resolves the restaurant from the Better Auth session — no query params needed.
 *
 * Returns JSend: { status: "success", data: { persona, restaurantId, slug } }
 */
export async function GET(_request: NextRequest) {
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated" },
      { status: 401 },
    );
  }

  const resolved = await resolveRestaurantForUser();
  if (!resolved) {
    return NextResponse.json(
      { status: "error", message: "Restaurant not linked to your account. Complete onboarding first." },
      { status: 404 },
    );
  }

  const { restaurantId, slug } = resolved;

  const restaurant = await restaurantRepo.findById(restaurantId);
  if (!restaurant) {
    return NextResponse.json(
      { status: "error", message: "Restaurant not found" },
      { status: 404 },
    );
  }

  const persona = restaurant.brandPersonaR2Key
    ? await loadBrandPersonaFromR2(restaurant.brandPersonaR2Key)
    : null;

  return NextResponse.json({
    status: "success",
    data: { persona, restaurantId, slug },
  });
}

// ─── PUT Handler ───────────────────────────────────────────
import { saveBrandPersonaToR2 } from "@/lib/brand-persona/r2";

/**
 * PUT /api/dashboard/brand-persona
 *
 * Saves brand persona edits from the dashboard editor.
 * Writes full document to R2 and updates the fragment in D1.
 * Unlike the onboarding path, this does NOT change onboardingState.
 *
 * Body (JSON):
 *   restaurantId: string          — restaurant ID (validated server-side for ownership)
 *   slug: string                  — restaurant slug
 *   cuisinePhilosophy: string
 *   voice: string
 *   targetCustomer: string[]
 *   neighborhoodCharacter: string
 *   values: string
 *
 * Returns JSend-format: { status, data } | { status, message }
 */

// ─── Helpers ───────────────────────────────────────────────

/** Format-validate that a restaurant ID matches the expected prefix pattern */
function isValidRestaurantId(id: unknown): id is string {
  return typeof id === "string" && /^rest_[a-zA-Z0-9]+$/.test(id);
}

/** Format-validate that a slug is non-empty and safe */
function isValidSlug(slug: unknown): slug is string {
  return typeof slug === "string" && slug.length > 0 && slug.length <= 255 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
}

// ─── PUT Handler ───────────────────────────────────────────

export async function PUT(request: NextRequest) {
  // 1. Auth check
  const session = await getSessionFromCookie();
  if (!session) {
    return NextResponse.json(
      { status: "error", message: "Not authenticated" },
      { status: 401 },
    );
  }

  // 2. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // 3. Validate input
  const parseResult = BrandPersonaEditSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { status: "fail", data: { validation: parseResult.error.flatten() } },
      { status: 400 },
    );
  }

  const personaInput = parseResult.data;
  const bodyObj = body as Record<string, unknown>;
  const restaurantId = bodyObj.restaurantId;
  const slug = bodyObj.slug;

  // 4. Validate restaurantId and slug format (server-side) — prevents ID enumeration and injection
  if (!isValidRestaurantId(restaurantId) || !isValidSlug(slug)) {
    return NextResponse.json(
      { status: "error", message: "Invalid restaurantId or slug format" },
      { status: 400 },
    );
  }

  // SECURITY: Verify the authenticated user owns this restaurant.
  // Uses the same heuristic as resolveRestaurantForUser() since the
  // user→restaurant FK is not yet in the schema.
  const userRestaurant = await resolveRestaurantForUser();
  if (!userRestaurant || userRestaurant.restaurantId !== restaurantId) {
    return NextResponse.json(
      { status: "error", message: "You do not have permission to edit this restaurant's brand persona" },
      { status: 403 },
    );
  }

  // 5. Load existing persona to preserve created_at
  const restaurant = await restaurantRepo.findById(restaurantId);
  if (!restaurant) {
    return NextResponse.json(
      { status: "error", message: "Restaurant not found" },
      { status: 404 },
    );
  }

  const { loadBrandPersonaFromR2 } = await import("@/lib/brand-persona/r2");
  const existingPersona = restaurant.brandPersonaR2Key
    ? await loadBrandPersonaFromR2(restaurant.brandPersonaR2Key)
    : null;

  // 5. Build full persona (preserve original created_at)
  const full = buildFullPersona(
    personaInput,
    slug,
    "dashboard-editor",
    existingPersona?.created_at,
  );

  // 6. Save to R2
  const r2Result = await saveBrandPersonaToR2(slug, full);
  if ("error" in r2Result) {
    console.error("DashboardBrandPersona: R2 save failed", {
      error: r2Result.error,
      restaurantId,
      slug,
    });
    return NextResponse.json(
      { status: "error", message: "Failed to save brand persona." },
      { status: 500 },
    );
  }

  // 7. Generate fragment and update D1
  const fragment = generateFragment(full);
  const fragmentJson = JSON.stringify(fragment);

  const repoResult = await restaurantRepo.updateBrandPersonaFragment(
    restaurantId,
    fragmentJson,
    r2Result.key,
  );

  if (repoResult.type !== "SUCCESS") {
    console.error("DashboardBrandPersona: D1 update failed", {
      error: repoResult,
      restaurantId,
    });
    return NextResponse.json(
      { status: "error", message: "Failed to update brand persona data." },
      { status: 500 },
    );
  }

  // 8. Success
  return NextResponse.json({
    status: "success",
    data: { updatedAt: full.updated_at },
  });
}