import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { validateOnboardingToken } from "@/lib/onboarding/tokens";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";

/**
 * POST /api/onboarding/confirm
 *
 * Accepts data confirmations/corrections from the onboarding form.
 * Persists corrections to D1, updates onboarding_state, and invalidates
 * the magic link token.
 *
 * Body (JSON):
 *   token: string       — the raw magic link token
 *   name: string         — confirmed restaurant name
 *   location: string     — confirmed location
 *   cuisineType: string  — confirmed cuisine type
 *   corrections?: Record<string, { original: string; corrected: string }>
 *
 * Returns JSend-format: { status, data: { nextStep } } | { status, message }
 */

// ─── Validation Schema ─────────────────────────────────────

const ConfirmOnboardingSchema = z.object({
  token: z.string().min(1, "Token is required"),
  name: z.string().min(1, "Restaurant name is required").max(255),
  location: z.string().min(1, "Location is required").max(255),
  cuisineType: z.string().min(1, "Cuisine type is required").max(100),
  corrections: z
    .record(
      z.object({
        original: z.string(),
        corrected: z.string(),
      }),
    )
    .optional(),
}).transform((data) => ({
  ...data,
  name: data.name.trim(),
  location: data.location.trim(),
  cuisineType: data.cuisineType.trim(),
}));

// ─── Simple in-memory rate limiter (per-IP, per-5-min window) ──
// TODO: Replace with KV-backed rate limiter for production scale
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): { ok: boolean; retryAfter?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 5 * 60 * 1000 });
    return { ok: true };
  }

  if (entry.count >= 10) {
    const retryAfter = Math.ceil((entry.resetAt - now) / 1000);
    return { ok: false, retryAfter };
  }

  entry.count++;
  return { ok: true };
}

// ─── POST Handler ──────────────────────────────────────────

export async function POST(request: NextRequest) {
  // 0. Rate limit
  const clientIp = request.headers.get("x-forwarded-for") ?? "unknown";
  const rateLimitResult = checkRateLimit(clientIp);
  if (!rateLimitResult.ok) {
    return NextResponse.json(
      { status: "error", message: "Rate limit exceeded. Please try again later." },
      { status: 429, headers: { "Retry-After": String(rateLimitResult.retryAfter) } },
    );
  }

  // 1. Parse and validate body
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parseResult = ConfirmOnboardingSchema.safeParse(body);
  if (!parseResult.success) {
    return NextResponse.json(
      { status: "fail", data: { validation: parseResult.error.flatten() } },
      { status: 400 },
    );
  }

  const { token, name, location, cuisineType, corrections } = parseResult.data;

  // 2. Validate token and get restaurant
  const { restaurant, error: tokenError } = await validateOnboardingToken(token);

  if (tokenError || !restaurant) {
    const message = tokenError === "EXPIRED"
      ? "This onboarding link has expired. Please request a new one via Telegram."
      : "Invalid or already-used onboarding link.";
    return NextResponse.json(
      { status: "error", message },
      { status: 400 },
    );
  }

  // 3. Persist corrections via RestaurantRepository
  const result = await restaurantRepo.confirmOnboardingData(restaurant.id, {
    name: name.trim(),
    location: location.trim(),
    cuisineType: cuisineType.trim(),
    corrections,
  });

  if (result.type !== "SUCCESS") {
    console.error("OnboardingTrace: confirmOnboardingData failed", {
      error: result,
      restaurantId: restaurant.id,
    });
    return NextResponse.json(
      { status: "error", message: "Failed to save your details. Please try again." },
      { status: 500 },
    );
  }

  // 4. Success — return next step
  return NextResponse.json({
    status: "success",
    data: { nextStep: "brand-persona" },
  });
}