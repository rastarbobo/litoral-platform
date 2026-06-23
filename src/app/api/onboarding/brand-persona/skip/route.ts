import { NextRequest, NextResponse } from "next/server";
import { validateOnboardingToken } from "@/lib/onboarding/tokens";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";

/**
 * POST /api/onboarding/brand-persona/skip
 *
 * Advances onboarding state past brand_persona when the user clicks "Skip for now".
 * Does not save any persona data — only advances state so the user doesn't get
 * stuck in brand_persona_pending on subsequent visits.
 *
 * Body (JSON):
 *   token: string — the raw magic link token
 *
 * Returns JSend-format: { status, data: { nextStep } } | { status, message }
 */

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

  const bodyObj = body as Record<string, unknown>;
  const rawToken = typeof bodyObj.token === "string" ? bodyObj.token.trim() : "";

  if (!rawToken) {
    return NextResponse.json(
      { status: "error", message: "Missing token" },
      { status: 400 },
    );
  }

  // 2. Validate token and get restaurant
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

  // 3. Skip brand persona: advance to brand_persona_completed without saving data
  const repoResult = await restaurantRepo.saveBrandPersona(
    restaurantData.id,
    "", // empty fragment — persona was skipped
    "", // empty R2 key — no persona document saved
  );

  if (repoResult.type !== "SUCCESS") {
    console.error("BrandPersonaSkip: state advance failed", {
      error: repoResult,
      restaurantId: restaurantData.id,
    });
    return NextResponse.json(
      { status: "error", message: "Failed to advance onboarding. Please try again." },
      { status: 500 },
    );
  }

  // 4. Success
  return NextResponse.json({
    status: "success",
    data: { nextStep: "subscription" },
  });
}