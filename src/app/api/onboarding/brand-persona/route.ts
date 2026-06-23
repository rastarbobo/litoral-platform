import { NextRequest, NextResponse } from "next/server";
import { validateOnboardingToken } from "@/lib/onboarding/tokens";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { BrandPersonaInputSchema } from "@/lib/brand-persona/types";
import { buildFullPersona, generateFragment } from "@/lib/brand-persona/fragment";
import { saveBrandPersonaToR2 } from "@/lib/brand-persona/r2";

/**
 * POST /api/onboarding/brand-persona
 *
 * Accepts brand persona data from the onboarding wizard.
 * Saves the full persona document to R2, generates a condensed fragment
 * (≤500 tokens) for D1, persists both, and advances onboarding state.
 *
 * Body (JSON):
 *   token: string                 — the raw magic link token
 *   cuisinePhilosophy: string     — 1-sentence cuisine description
 *   voice: string                 — selected preset or custom
 *   targetCustomer: string[]      — selected customer segments
 *   neighborhoodCharacter: string — 3-word neighborhood description
 *   values: string                — what people should feel
 *
 * Returns JSend-format: { status, data: { nextStep } } | { status, message }
 */

// ─── POST Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 1. Parse body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  // 2. Validate input — extract token separately, then validate persona fields
  const bodyObj = body as Record<string, unknown>;
  const rawToken = typeof bodyObj.token === "string" ? bodyObj.token.trim() : "";

  const parseResult = BrandPersonaInputSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { status: "fail", data: { validation: parseResult.error.flatten() } },
      { status: 400 },
    );
  }

  const personaInput = parseResult.data;

  // 3. Validate token and get restaurant
  const tokenResult = await validateOnboardingToken(rawToken);

  if (tokenResult.error || !tokenResult.restaurant) {
    const message =
      tokenResult.error === "EXPIRED"
        ? "This onboarding link has expired. Please request a new one via Telegram."
        : "Invalid or already-used onboarding link.";
    return NextResponse.json(
      { status: "error", message },
      { status: 400 },
    );
  }

  const restaurantData = tokenResult.restaurant;
  const slug = restaurantData.slug ?? "";

  if (!slug) {
    return NextResponse.json(
      { status: "error", message: "Restaurant has no slug configured." },
      { status: 400 },
    );
  }

  // 4. Build full persona document
  const full = buildFullPersona(personaInput, slug, "onboarding-wizard");

  // 5. Save to R2 (full document)
  const r2Result = await saveBrandPersonaToR2(slug, full);
  if ("error" in r2Result) {
    console.error("BrandPersonaTrace: R2 save failed", {
      error: r2Result.error,
      restaurantId: restaurantData.id,
      slug,
    });
    return NextResponse.json(
      { status: "error", message: "Failed to save brand persona. Please try again." },
      { status: 500 },
    );
  }

  // 6. Generate fragment and persist to D1
  const fragment = generateFragment(full);
  const fragmentJson = JSON.stringify(fragment);

  const repoResult = await restaurantRepo.saveBrandPersona(
    restaurantData.id,
    fragmentJson,
    r2Result.key,
  );

  if (repoResult.type !== "SUCCESS") {
    console.error("BrandPersonaTrace: D1 save failed", {
      error: repoResult,
      restaurantId: restaurantData.id,
    });
    return NextResponse.json(
      { status: "error", message: "Failed to save brand persona data. Please try again." },
      { status: 500 },
    );
  }

  // 7. Success
  return NextResponse.json({
    status: "success",
    data: { nextStep: "subscription" },
  });
}