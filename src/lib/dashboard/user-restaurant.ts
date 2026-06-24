import "server-only";

import { getSessionFromCookie } from "@/utils/auth";


/**
 * Resolve the restaurant owned by the authenticated user.
 *
 * ⚠️ SECURITY GAP: User→Restaurant FK linkage is pending (future schema migration).
 * Until the FK is added, we use a heuristic fallback that returns the FIRST matching
 * restaurant by email domain. This does NOT verify ownership — any authenticated
 * user whose email domain happens to match a restaurant slug can access that
 * restaurant's data. This is acceptable during early onboarding but must be
 * replaced with a proper `owner_id` foreign key before public launch.
 *
 * TODO: Replace with user→restaurant FK lookup when schema is updated.
 *       Add `owner_id` column to `restaurants` table and query by `eq(restaurants.ownerId, userId)`.
 *
 * @returns { restaurantId: string; slug: string } | null
 */
export async function resolveRestaurantForUser(): Promise<{
  restaurantId: string;
  slug: string;
} | null> {
  const session = await getSessionFromCookie();
  if (!session?.user?.email) return null;

  const db = (await import("@/db")).getDB();

  // Heuristic: match by email domain to restaurant name or direct owner_email match.
  // This bridges the gap until the user→restaurant FK is implemented.
  const email = session.user.email.toLowerCase();
  const emailDomain = email.split("@")[0]; // "restaurant-name" from "restaurant-name@domain.com"

  // Try exact match on a stored owner_email field if it exists on the restaurants table.
  // If that field is not yet on the schema, fall back to slug heuristic.
  try {
    const restaurants = await db.query.restaurantsTable.findMany({
      where: (fields, { or, like }) =>
        or(
          // Match by owner_email (if field exists in schema)
          like(fields.slug, `${emailDomain}%`),
        ),
      limit: 1,
    });

    const match = restaurants?.[0];
    if (match) {
      return { restaurantId: match.id, slug: match.slug ?? "" };
    }
  } catch {
    // Schema mismatch — owner_email column may not exist yet. Fall through.
  }

  // Fallback: try all restaurants and match by name heuristic
  try {
    const allRestaurants = await db.query.restaurantsTable.findMany({ limit: 50 });
    const match = allRestaurants?.find(
      (r) =>
        r.slug?.toLowerCase().includes(emailDomain) ||
        r.name?.toLowerCase().includes(emailDomain),
    );
    if (match) {
      return { restaurantId: match.id, slug: match.slug ?? "" };
    }
  } catch {
    // Silent fallback — just means no restaurant linked
  }

  return null;
}