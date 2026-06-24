/**
 * Asset Suspension Service — Story 7.5 (Task 5.1, 5.2)
 *
 * Manages R2 asset access suspension and restoration for
 * hibernated/cancelled restaurants. Suspension is reversible —
 * data is NEVER deleted.
 */

import { restaurantRepo } from "@/db/repositories/restaurant-repository";


/**
 * Suspend R2 access for a restaurant.
 *
 * - Clears the extension auth token (blocks GBP publishing)
 * - Invalidates signed URL access through the extension
 * - Logs the suspension event
 * - Does NOT delete any R2 objects
 *
 * @returns true if suspension succeeded, false otherwise
 */
async function suspendR2Access(restaurantId: string): Promise<boolean> {
  console.info("AssetSuspension: suspending R2 access", { restaurantId });

  const result = await restaurantRepo.suspendR2Access(restaurantId);

  if ("type" in result && result.type === "DATABASE_ERROR") {
    console.error("AssetSuspension: failed to suspend R2 access", {
      restaurantId,
      message: result.message,
    });
    return false;
  }

  console.info("AssetSuspension: R2 access suspended", {
    restaurantId,
    success: result.success,
  });

  return result.success;
}

/**
 * Restore R2 access for a reactivated restaurant.
 *
 * - Generates a new extension auth token
 * - Re-enables signed URL generation
 * - Logs the restoration event
 *
 * @returns The new token string, or null on failure
 */
export async function restoreR2Access(restaurantId: string): Promise<string | null> {
  console.info("AssetSuspension: restoring R2 access", { restaurantId });

  const result = await restaurantRepo.restoreR2Access(restaurantId);

  if ("type" in result && result.type === "DATABASE_ERROR") {
    console.error("AssetSuspension: failed to restore R2 access", {
      restaurantId,
      message: result.message,
    });
    return null;
  }

  console.info("AssetSuspension: R2 access restored", {
    restaurantId,
    tokenPrefix: result.token.substring(0, 8),
  });

  return result.token;
}

/**
 * Full hibernate transition: suspend access, update status, store eligibility.
 * Used by Stripe webhook handler for subscription cancellation/pause.
 *
 * @returns true if the full transition succeeded
 */
export async function transitionToHibernate(restaurantId: string): Promise<boolean> {
  console.info("AssetSuspension: transitioning to hibernate", { restaurantId });

  // 1. Suspend R2 access
  const suspended = await suspendR2Access(restaurantId);
  if (!suspended) {
    console.warn("AssetSuspension: R2 suspension failed, continuing with hibernate transition", {
      restaurantId,
    });
  }

  // 2. Update D1 to hibernate status
  const result = await restaurantRepo.updateSubscriptionToHibernate(restaurantId);

  if (result.type === "NO_OP") {
    console.info("AssetSuspension: restaurant already in hibernate", { restaurantId });
    return true;
  }

  if (result.type === "DATABASE_ERROR") {
    console.error("AssetSuspension: failed to update subscription status", {
      restaurantId,
      message: result.message,
    });
    return false;
  }

  // 3. Compute and persist reactivation eligibility
  await restaurantRepo.persistReactivationEligibility(restaurantId);

  console.info("AssetSuspension: hibernate transition complete", { restaurantId });
  return true;
}