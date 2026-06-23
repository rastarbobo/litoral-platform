/**
 * Reactivation Engine — Story 7.5 (Task 4.2)
 *
 * Determines the target operational mode when a restaurant
 * reactivates from Hibernate. Used by both the API route and
 * Stripe webhook handler.
 */

import { OPERATIONAL_MODE } from "@/db/schema";
import type { OperationalMode } from "@/db/schema";

/**
 * Determine the appropriate operational mode for a reactivated restaurant.
 *
 * Seasonal mapping:
 *   Nov–Dec → local_seo_guardian (off-season maintenance)
 *   Jan–Feb → pre_season_booking  (early-bird campaigns)
 *   Mar–Oct → peak_season         (full campaign generation)
 *
 * @param currentMonth — 1-indexed month (January = 1)
 * @returns The target operational mode (never returns 'hibernate')
 */
export function determineTargetMode(currentMonth: number): Exclude<OperationalMode, "hibernate"> {
  if (currentMonth >= 11) {
    // November or December
    return OPERATIONAL_MODE.LOCAL_SEO_GUARDIAN as Exclude<OperationalMode, "hibernate">;
  }
  if (currentMonth <= 2) {
    // January or February
    return OPERATIONAL_MODE.PRE_SEASON_BOOKING as Exclude<OperationalMode, "hibernate">;
  }
  // March through October
  return OPERATIONAL_MODE.PEAK_SEASON as Exclude<OperationalMode, "hibernate">;
}

/**
 * Get a human-readable description of the target mode.
 */
export function describeTargetMode(mode: OperationalMode): string {
  switch (mode) {
    case OPERATIONAL_MODE.PEAK_SEASON:
      return "Peak Season — full campaign generation resumed";
    case OPERATIONAL_MODE.LOCAL_SEO_GUARDIAN:
      return "Off-Season Guardian — maintenance mode (1-2 posts/week, review protection)";
    case OPERATIONAL_MODE.PRE_SEASON_BOOKING:
      return "Pre-Season Booking — early-bird campaigns active";
    case OPERATIONAL_MODE.HIBERNATE:
      return "Hibernate — subscription paused";
    default:
      return "Active";
  }
}