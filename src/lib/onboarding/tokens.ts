import "server-only";

import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { tryCatch } from "@/lib/try-catch";
import { env as workerEnv } from "cloudflare:workers";

// ─── Constants ────────────────────────────────────────────

/** Default TTL for magic links: 7 days in hours */
const DEFAULT_TTL_HOURS = 168;

// ─── Types ─────────────────────────────────────────────────

/** Result shape for generateOnboardingMagicLink */
interface GenerateTokenResult {
  token: string;
  onboardingUrl: string;
}

/** Result shape for validateOnboardingToken */
interface ValidateOnboardingTokenResult {
  /** The restaurant record when token is valid */
  restaurant: typeof restaurantsTable.$inferSelect | null;
  /** Non-null when token is expired or invalid */
  error?: "EXPIRED" | "INVALID" | "NOT_FOUND";
}

// ─── Helpers ───────────────────────────────────────────────

/**
 * Hash a token string using SHA-256.
 * Uses the Web Crypto API (available in Cloudflare Workers).
 */
export async function sha256Hash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Generate a cryptographically random token using crypto.randomUUID().
 * Returns the raw token (unhashed) for inclusion in the magic link URL.
 */
function generateToken(): string {
  return crypto.randomUUID();
}

/**
 * Get the TTL in hours from environment variable or default.
 */
function getTtlHours(): number {
  const envTtl = (workerEnv as unknown as Record<string, unknown>).ONBOARDING_MAGIC_LINK_TTL_HOURS as string | undefined;
  if (envTtl) {
    const parsed = parseInt(envTtl, 10);
    if (!isNaN(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TTL_HOURS;
}

/**
 * Build the full onboarding URL for a token.
 */
function buildOnboardingUrl(token: string): string {
  const baseUrl = ((workerEnv as unknown as Record<string, unknown>).NEXT_PUBLIC_APP_URL as string | undefined) ?? "https://litoral.agency";
  return `${baseUrl}/onboarding/${token}`;
}

// ─── Token Operations ──────────────────────────────────────

/**
 * Generate a magic link token for a restaurant and store the hash in D1.
 *
 * Usage:
 *   const result = await generateOnboardingMagicLink("tasca-do-pescador");
 *   if (result.error) { // handle error, see @returns below }
 *   // result.token -> raw token for the URL
 *   // result.onboardingUrl -> full URL to send to prospect
 *
 * @param restaurantSlug - The slug of the restaurant to onboard.
 * @returns The raw token and onboarding URL, or error details.
 */
export async function generateOnboardingMagicLink(
  restaurantSlug: string,
): Promise<{ data: GenerateTokenResult; error: null } | { data: null; error: string }> {
  // Input validation
  if (typeof restaurantSlug !== "string" || restaurantSlug.trim() === "") {
    return { data: null, error: "restaurantSlug must be a non-empty string" };
  }

  const token = generateToken();
  let tokenHash: string;
  try {
    tokenHash = await sha256Hash(token);
  } catch (e) {
    return {
      data: null,
      error: `Failed to hash token: ${e instanceof Error ? e.message : "Unknown error"}`,
    };
  }

  const ttlHours = getTtlHours();
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);
  const onboardingUrl = buildOnboardingUrl(token);

  const db = getDB();

  const { error } = await tryCatch(
    db
      .update(restaurantsTable)
      .set({
        onboardingState: "magic_link_sent",
        magicLinkTokenHash: tokenHash,
        magicLinkExpiresAt: expiresAt,
      })
      .where(eq(restaurantsTable.slug, restaurantSlug))
      .execute(),
  );

  if (error) {
    console.error("generateOnboardingMagicLink: D1 update failed", { error, restaurantSlug });
    return { data: null, error: error instanceof Error ? error.message : "Database error" };
  }

  return {
    data: { token, onboardingUrl },
    error: null,
  };
}

/**
 * Validate an onboarding magic link token.
 *
 * Hashes the incoming token and looks up the restaurant by the hash.
 * If found and not expired, returns the restaurant record.
 * On success, the token is invalidated (single-use).
 *
 * @param rawToken - The raw token from the URL.
 * @returns The restaurant record or an error code.
 */
export async function validateOnboardingToken(
  rawToken: string,
): Promise<ValidateOnboardingTokenResult> {
  // Input validation
  if (typeof rawToken !== "string" || rawToken.trim() === "") {
    return { restaurant: null, error: "INVALID" };
  }

  const tokenHash = await sha256Hash(rawToken.trim());
  const db = getDB();
  const now = new Date();

  // ── Atomic consume: UPDATE + RETURNING to prevent TOCTOU race ──
  // Other concurrent requests with the same token will find no rows
  // because this UPDATE nullifies the token hash in a single statement.
  // Only consumes non-expired tokens (magicLinkExpiresAt >= now).
  const { data: updatedRows, error: consumeError } = await tryCatch(
    db
      .update(restaurantsTable)
      .set({
        magicLinkTokenHash: null,
        magicLinkExpiresAt: null,
      })
      .where(
        and(
          eq(restaurantsTable.magicLinkTokenHash, tokenHash),
          // Only consume non-expired tokens (D1 compares integer timestamps)
          sql`${restaurantsTable.magicLinkExpiresAt} IS NOT NULL AND ${restaurantsTable.magicLinkExpiresAt} >= ${Math.floor(now.getTime() / 1000)}`,
        ),
      )
      .returning()
      .execute(),
  );

  if (consumeError) {
    console.error("validateOnboardingToken: atomic consume failed", { error: consumeError });
    return { restaurant: null, error: "INVALID" };
  }

  // No rows updated → token was invalid, already consumed, or expired
  if (!updatedRows || updatedRows.length === 0) {
    // Distinguish expired vs consumed: look up by hash without consuming
    const { data: expiredCheck } = await tryCatch(
      db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.magicLinkTokenHash, tokenHash),
      }),
    );
    if (expiredCheck) {
      // Token exists but wasn't consumed → must have been expired
      return { restaurant: null, error: "EXPIRED" };
    }
    return { restaurant: null, error: "INVALID" };
  }

  const restaurant = updatedRows[0];

  return { restaurant, error: undefined };
}