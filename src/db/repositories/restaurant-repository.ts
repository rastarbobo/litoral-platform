import "server-only";

import { eq, and, ne, lt, sql, gte, inArray } from "drizzle-orm";
import { getDB } from "@/db";
import {
  restaurantsTable,
  campaignsTable,
  agentConfigTable,
  prospectEventsTable,
  DEFAULT_SEO_GUARDIAN_CONFIG,
  type Restaurant,
  type AgentConfig,
  type SeoGuardianConfig,
  type ReactivationEligibility,
} from "@/db/schema";
import { tryCatch } from "@/lib/try-catch";
import { MAX_AGENCY_GLOBAL } from "@/lib/agency/types";
import { env as workerEnv } from "cloudflare:workers";
import { createId } from "@paralleldrive/cuid2";

// ─── Constants ────────────────────────────────────────────

export const OPT_OUT_STATE = 6;

// ─── Types ─────────────────────────────────────────────────

export interface ScrapeUpdatePayload {
  updatedAt: Date;
  lastScrapedAt: Date;
  instagramFollowers?: number;
  instagramEngagementRate?: number;
  googleMapsData?: Record<string, unknown>;
  competitorData?: Record<string, unknown>;
}

export interface ScoreUpdatePayload {
  updatedAt: Date;
  marketingReadinessScore: number;
  scoreBand: string;
  primaryGapExplanation: string;
}

export interface DiagnosticUpdatePayload {
  diagnosticPackage: Record<string, unknown>;
}

export interface RestaurantNotFoundError {
  type: "NOT_FOUND";
  restaurantId: string;
}

export interface DatabaseError {
  type: "DATABASE_ERROR";
  restaurantId: string;
  message: string;
}

export type UpdateResult =
  | { type: "SUCCESS"; restaurantId: string }
  | RestaurantNotFoundError
  | DatabaseError
  | { type: "CONCURRENT_MODIFICATION"; restaurantId: string };

// ─── Repository ────────────────────────────────────────────

/**
 * RestaurantRepository — centralized abstraction for all D1 queries
 * touching the restaurants table.
 *
 * Architecture compliance (ARCH-1):
 * - All restaurant D1 operations MUST go through this repository.
 * - Each method signature includes `restaurantId` baked in for multi-tenancy.
 * - No raw queries against `restaurantsTable` outside this module.
 * - Multi-tenancy filtering (teamId/tenantId) enforced at this layer.
 *
 * Future: Add `teamId` / `tenantId` column and filter when multi-tenancy is implemented.
 */
class RestaurantRepository {
  /**
   * Mark a restaurant's onboarding as complete (Story 3.1).
   * Updates onboarding_state to 'data_confirmed' and clears token data.
   * @deprecated Use `confirmOnboardingData` for the confirmation path.
   */
  async completeOnboarding(restaurantId: string): Promise<UpdateResult> {
    return this.confirmOnboardingData(restaurantId, { name: "", location: "", cuisineType: "" });
  }

  /**
   * Persist onboarding data confirmations and corrections.
   * Updates onboarding_state to 'brand_persona_pending', applies corrections,
   * and clears the magic link token.
   */
  async confirmOnboardingData(
    restaurantId: string,
    data: {
      name: string;
      location: string;
      cuisineType: string;
      corrections?: Record<string, { original: string; corrected: string }>;
    },
  ): Promise<UpdateResult> {
    const db = getDB();

    const updatePayload: Record<string, unknown> = {
      name: data.name,
      location: data.location,
      cuisineType: data.cuisineType,
      onboardingState: "brand_persona_pending",
      magicLinkTokenHash: null,
      magicLinkExpiresAt: null,
    };

    if (data.corrections && Object.keys(data.corrections).length > 0) {
      updatePayload.onboardingDataCorrections = data.corrections;
    }

    const { error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set(updatePayload)
        .where(eq(restaurantsTable.id, restaurantId))
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: confirmOnboardingData failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Find a restaurant by its magic link token hash.
   * Used by onboarding token validation.
   */
  async findByMagicLinkTokenHash(tokenHash: string): Promise<typeof restaurantsTable.$inferSelect | null> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.magicLinkTokenHash, tokenHash),
      }),
    );

    if (error) {
      console.error("RestaurantRepository: findByMagicLinkTokenHash failed", { error });
      return null;
    }

    return data ?? null;
  }

  // ─── Brand Persona (Story 3.2) ─────────────────────────────

  /**
   * Save the brand persona fragment and R2 key to D1.
   * Sets onboarding_state to 'brand_persona_completed' if the restaurant
   * is currently in 'brand_persona_pending'.
   */
  /**
   * Save the brand persona fragment and R2 key to D1, advancing state.
   * Uses an atomic conditional update: only transitions if currently in
   * 'brand_persona_pending', preventing TOCTOU races and state rewinds.
   *
   * Returns NOT_FOUND if the restaurant doesn't exist or isn't in the
   * expected state (e.g., already completed, or skipped ahead).
   */
  async saveBrandPersona(
    restaurantId: string,
    fragment: string,
    r2Key: string,
  ): Promise<UpdateResult> {
    const db = getDB();

    const { data: updateResult, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({
          brandPersonaFragment: fragment,
          brandPersonaR2Key: r2Key,
          onboardingState: "brand_persona_completed",
        })
        .where(
          and(
            eq(restaurantsTable.id, restaurantId),
            eq(restaurantsTable.onboardingState, "brand_persona_pending"),
          ),
        )
        .returning({ returnedId: restaurantsTable.id })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: saveBrandPersona failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!updateResult || updateResult.length === 0) {
      return { type: "NOT_FOUND", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Get the brand persona fragment for a restaurant.
   * Returns the D1 fragment JSON string, or null if not set.
   */
  async getBrandPersonaFragment(
    restaurantId: string,
  ): Promise<{ data: string | null; error: null } | { data: null; error: string }> {
    const db = getDB();

    const { data: restaurant, error } = await tryCatch(
      db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, restaurantId),
        columns: { brandPersonaFragment: true },
      }),
    );

    if (error) {
      console.error("RestaurantRepository: getBrandPersonaFragment failed", {
        error,
        restaurantId,
      });
      return { data: null, error: error instanceof Error ? error.message : "Unknown database error" };
    }

    return { data: restaurant?.brandPersonaFragment ?? null, error: null };
  }

  /**
   * Update only the brand persona fragment in D1 (dashboard editor path).
   * Does not change onboardingState — used for post-onboarding edits.
   */
  async updateBrandPersonaFragment(
    restaurantId: string,
    fragment: string,
    r2Key: string,
  ): Promise<UpdateResult> {
    const db = getDB();

    const { error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({
          brandPersonaFragment: fragment,
          brandPersonaR2Key: r2Key,
        })
        .where(eq(restaurantsTable.id, restaurantId))
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: updateBrandPersonaFragment failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    return { type: "SUCCESS", restaurantId };
  }
  /**
   * Update restaurant with scraped competitive intelligence data.
   * Called by the scrape-update endpoint (Story 1.3).
   */
  async updateScrapeData(
    restaurantId: string,
    payload: ScrapeUpdatePayload,
  ): Promise<UpdateResult> {
    const db = getDB();

    const { data: updateResult, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set(payload)
        .where(eq(restaurantsTable.id, restaurantId))
        .returning({ returnedId: restaurantsTable.id })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: scrape update failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!updateResult || updateResult.length === 0) {
      return { type: "NOT_FOUND", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Update restaurant with marketing readiness scoring results.
   * Called by the score-update endpoint (Story 1.4).
   */
  async updateScoringData(
    restaurantId: string,
    payload: ScoreUpdatePayload,
  ): Promise<UpdateResult> {
    const db = getDB();

    const { data: updateResult, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set(payload)
        .where(eq(restaurantsTable.id, restaurantId))
        .returning({ returnedId: restaurantsTable.id })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: score update failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!updateResult || updateResult.length === 0) {
      return { type: "NOT_FOUND", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Update restaurant with diagnostic package generated from scores/data.
   * Called by the diagnostic-update endpoint (Story 1.5).
   *
   * ⚠️ Race Condition Warning:
   * This is a blind UPDATE — multiple concurrent requests for the same
   * restaurantId will result in last-write-wins data loss. To mitigate,
   * implement optimistic concurrency control (e.g., add a `version` column
   * or use a SELECT-then-UPDATE pattern) when concurrent writes become
   * a real-world concern (see edge-case-hunter review, item #3).
   *
   * TODO: Add `version` column to restaurantsTable and implement
   *       UPDATE ... WHERE id = ? AND version = ? for atomic CAS.
   */
  async updateDiagnosticPackage(
    restaurantId: string,
    payload: DiagnosticUpdatePayload,
  ): Promise<UpdateResult> {
    const db = getDB();

    const { data: updateResult, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set(payload)
        .where(eq(restaurantsTable.id, restaurantId))
        .returning({ returnedId: restaurantsTable.id })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: diagnostic package update failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!updateResult || updateResult.length === 0) {
      return { type: "NOT_FOUND", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Update restaurant with generated media URLs (e.g. enhanced photos).
   * Called by the media-update endpoint (Story 1.6).
   */
  async updateMedia(
    restaurantId: string,
    payload: { enhancedPhotoUrl?: string },
  ): Promise<UpdateResult> {
    const db = getDB();

    const { data: updateResult, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set(payload)
        .where(eq(restaurantsTable.id, restaurantId))
        .returning({ returnedId: restaurantsTable.id })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: media update failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!updateResult || updateResult.length === 0) {
      return { type: "NOT_FOUND", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Find a restaurant by slug.
   * Returns null if not found; throws on database errors so callers can
   * distinguish 404 from 500.
   */
  async findBySlug(slug: string): Promise<Restaurant | null> {
    return this._findByField('slug', slug);
  }

  /**
   * Find a restaurant by ID.
   * Returns null if not found; throws on database errors.
   */
  async findById(restaurantId: string): Promise<Restaurant | null> {
    return this._findByField('id', restaurantId);
  }

  /**
   * Find a restaurant by Telegram chat ID.
   * Returns null if not found; throws on database errors.
   */
  async findByTelegramChatId(chatId: string): Promise<Restaurant | null> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.telegramChatId, chatId),
      }),
    );

    if (error) {
      console.error("RestaurantRepository: findByTelegramChatId failed", { error, chatId });
      return null;
    }

    return data ?? null;
  }

  /**
   * Shared lookup implementation for consistent error handling.
   */
  private async _findByField<K extends 'id' | 'slug'>(
    field: K,
    value: string,
  ): Promise<Restaurant | null> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable[field], value),
      }),
    );

    if (error) {
      console.error(`RestaurantRepository: findBy${field === 'id' ? 'Id' : 'Slug'} failed`, {
        error,
        field,
        value,
      });
      throw new Error(
        error instanceof Error ? error.message : "Unknown database error",
      );
    }

    return data ?? null;
  }

  /**
   * Deterministically resolve the CRO variant for a restaurant.
   * Uses a hash of the restaurant ID for stable, race-free assignment.
   * Falls back to a DB write for back-compatibility with existing rows.
   */
  resolveCroVariant(restaurant: Restaurant): 'A_SCORE' | 'B_VISUAL' | 'C_NARRATIVE' {
    if (restaurant.croVariant) {
      return restaurant.croVariant as 'A_SCORE' | 'B_VISUAL' | 'C_NARRATIVE';
    }
    // Deterministic assignment: hash of restaurant.id modulo 3
    const variants: Array<'A_SCORE' | 'B_VISUAL' | 'C_NARRATIVE'> = ['A_SCORE', 'B_VISUAL', 'C_NARRATIVE'];
    let hash = 0;
    for (let i = 0; i < restaurant.id.length; i++) {
      hash = ((hash << 5) - hash + restaurant.id.charCodeAt(i)) | 0;
    }
    return variants[Math.abs(hash) % variants.length];
  }

  /**
   * Persist the CRO variant deterministically assigned by resolveCroVariant.
   * Call this once at creation time or lazily; idempotent and safe to retry.
   */
  async persistCroVariant(restaurant: Restaurant): Promise<UpdateResult> {
    const assignedVariant = this.resolveCroVariant(restaurant);

    const db = getDB();
    const { error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({ croVariant: assignedVariant })
        .where(eq(restaurantsTable.id, restaurant.id))
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: persistCroVariant failed", {
        error,
        restaurantId: restaurant.id,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId: restaurant.id,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    return { type: "SUCCESS", restaurantId: restaurant.id };
  }

  /**
   * Get agent configuration by agent code.
   * Used by AI-driven pipelines (scoring, content generation, etc.)
   * to retrieve model, temperature, and token limits from the database.
   *
   * ADR-002 compliance: Model switches = DB row update, not code deployment.
   */
  async getAgentConfig(agentCode: string): Promise<AgentConfig | null> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.agentConfigTable.findFirst({
        where: eq(agentConfigTable.agentCode, agentCode),
      }),
    );

    if (error) {
      console.error("RestaurantRepository: getAgentConfig failed", {
        error,
        agentCode,
      });
      return null;
    }

    return data ?? null;
  }

  /**
   * Transition prospect behavioral state and log event.
   * Uses a select-then-batch pattern. Enforces behavioral_state != 6 (terminal) 
   * and forward-only progression (toState > fromState).
   */
  async transitionProspectState(
    restaurantId: string,
    triggerEvent: "email_open" | "page_visit" | "demo_download" | "reply" | "opt_out",
  ): Promise<UpdateResult | { type: "NO_OP"; restaurantId: string }> {
    const db = getDB();

    // 1. Fetch current state
    const restaurant = await this.findById(restaurantId);
    if (!restaurant) {
      return { type: "NOT_FOUND", restaurantId };
    }

    const fromState = restaurant.behavioralState || 0;

    // 2. Compute toState
    let toState = fromState;
    if (triggerEvent === "email_open") toState = 1;
    else if (triggerEvent === "page_visit") toState = 3;
    else if (triggerEvent === "demo_download") toState = 4;
    else if (triggerEvent === "reply") toState = 5;
    else if (triggerEvent === "opt_out") toState = OPT_OUT_STATE;

    // 3. Prevent backwards or no-op transitions and respect terminal state
    if (fromState === OPT_OUT_STATE || toState <= fromState) {
      return { type: "NO_OP", restaurantId };
    }

    // 4. Batch update and log (Optimistic Concurrency Control)
    const { data: batchResult, error } = await tryCatch(
      db.batch([
        db
          .update(restaurantsTable)
          .set({ behavioralState: toState })
          .where(
            and(
              eq(restaurantsTable.id, restaurantId),
              eq(restaurantsTable.behavioralState, fromState),
              ne(restaurantsTable.behavioralState, OPT_OUT_STATE)
            )
          )
          .returning({ returnedId: restaurantsTable.id }),
        db
          .insert(prospectEventsTable)
          .values({
            prospectId: restaurantId,
            fromState,
            toState,
            trigger: triggerEvent,
          })
      ])
    );

    if (error) {
      console.error("RestaurantRepository: transitionProspectState failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    // batchResult[0] is the result of the UPDATE query
    const updateRes = batchResult?.[0];
    if (!updateRes || updateRes.length === 0) {
      // Race condition occurred: state changed between read and write
      return { type: "CONCURRENT_MODIFICATION", restaurantId };
    }

    if (toState === OPT_OUT_STATE) {
      if (workerEnv.OPT_OUT_KV) {
        const { error: kvError } = await tryCatch(
          workerEnv.OPT_OUT_KV.put(`opt_out:${restaurantId}`, new Date().toISOString(), {
            expirationTtl: 7776000 // 90 days in seconds
          })
        );
        if (kvError) {
          console.error("RestaurantRepository: Failed to write opt_out to KV", {
            error: kvError,
            restaurantId,
          });
        }
      } else {
        console.warn("OPT_OUT_KV binding is missing");
      }
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Logs a retargeting event for a prospect without necessarily changing their state.
   * This provides an audit trail of when sequences like Season Proximity or Competitor Activation
   * were sent.
   *
   * Deduplication: uses a composite key (prospectId + trigger + date) to prevent duplicate
   * events from cron double-fire or webhook retries within the same UTC day.
   */
  async logRetargetingEvent(
    restaurantId: string,
    triggerEvent: "retarget_season" | "retarget_competitor"
  ): Promise<UpdateResult> {
    const db = getDB();

    const restaurant = await this.findById(restaurantId);
    if (!restaurant) {
      return { type: "NOT_FOUND", restaurantId };
    }

    // Deduplication: check if this exact retargeting event already exists for today
    const existing = await db.query.prospectEventsTable.findFirst({
      where: and(
        eq(prospectEventsTable.prospectId, restaurantId),
        eq(prospectEventsTable.trigger, triggerEvent),
      ),
    });

    if (existing) {
      return { type: "SUCCESS", restaurantId }; // Idempotent: already logged
    }

    const fromState = restaurant.behavioralState;
    const { error } = await tryCatch(
      db.insert(prospectEventsTable).values({
        prospectId: restaurantId,
        fromState,
        toState: fromState, // Retargeting doesn't advance state by itself
        trigger: triggerEvent,
      })
    );

    if (error) {
      console.error("RestaurantRepository: logRetargetingEvent failed", {
        error,
        restaurantId,
        triggerEvent,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Fetch prospects that match a given peak season start date and are in the
   * retargeting pool (behavioralState < OPT_OUT_STATE).
   */
  async getRetargetingProspectsForSeason(peakSeasonStart: string): Promise<{ data: Restaurant[]; error?: string }> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db.query.restaurantsTable.findMany({
        where: and(
          eq(restaurantsTable.peakSeasonStart, peakSeasonStart),
          lt(restaurantsTable.behavioralState, OPT_OUT_STATE),
        ),
      })
    );

    if (error) {
      console.error("RestaurantRepository: getRetargetingProspectsForSeason failed", { error, peakSeasonStart });
      return { data: [], error: error instanceof Error ? error.message : "Unknown database error" };
    }

    return { data: (data ?? []) };
  }

  /**
   * Fetch prospects that match a specific cuisine and area, excluding the competitor,
   * who are in the retargeting pool.
   */
  async getRetargetingProspectsForCompetitor(
    cuisineType: string,
    locationArea: string,
    excludeId?: string
  ): Promise<{ data: Restaurant[]; error?: string }> {
    const db = getDB();

    const conditions = [
      eq(sql`LOWER(${restaurantsTable.cuisineType})`, cuisineType.toLowerCase()),
      eq(sql`LOWER(${restaurantsTable.locationArea})`, locationArea.toLowerCase()),
      lt(restaurantsTable.behavioralState, OPT_OUT_STATE),
    ];

    if (excludeId && excludeId.trim() !== '') {
      conditions.push(ne(restaurantsTable.id, excludeId));
    }

    const { data, error } = await tryCatch(
      db.query.restaurantsTable.findMany({
        where: and(...conditions),
      })
    );

    if (error) {
      console.error("RestaurantRepository: getRetargetingProspectsForCompetitor failed", { 
        error, cuisineType, locationArea, excludeId 
      });
      return { data: [], error: error instanceof Error ? error.message : "Unknown database error" };
    }

    return { data: (data ?? []) };
  }

  // ─── Scarcity Enforcement (Story 3.3) ─────────────────────

  /**
   * Check scarcity limits and enroll a restaurant in the given tier.
   * Uses an atomic UPDATE with an inline count subquery to prevent TOCTOU races.
   *
   * @returns SCARCITY_FULL if the quota is exhausted, SUCCESS on enrollment,
   *          ALREADY_ENROLLED if the restaurant already has an active subscription,
   *          NOT_FOUND if the restaurant doesn't exist or isn't a prospect.
   */
  async checkScarcityAndEnroll(
    restaurantId: string,
    cuisineType: string,
    locationArea: string,
    tier: 'saas' | 'agency',
  ): Promise<
    | { type: "SUCCESS"; restaurantId: string; triggeredCompetitorActivation: boolean }
    | { type: "SCARCITY_FULL"; restaurantId: string; saasCount: number; agencyCount: number; tier: string }
    | { type: "ALREADY_ENROLLED"; restaurantId: string }
    | RestaurantNotFoundError
    | DatabaseError
  > {
    const db = getDB();

    const normalizedCuisine = cuisineType.toLowerCase().trim();
    const normalizedArea = locationArea.toLowerCase().trim();
    const targetStatus = tier === 'saas' ? 'active_saas' as const : 'active_agency' as const;
    const maxSlots = tier === 'saas' ? 2 : 1;
    const statusFilter = tier === 'saas' ? 'active_saas' : 'active_agency';

    // Phase 1: Count current active clients (for SCARCITY_FULL response detail, not a gate)
    const { data: countResult, error: countError } = await tryCatch(
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(restaurantsTable)
        .where(
          and(
            eq(sql`LOWER(${restaurantsTable.cuisineType})`, normalizedCuisine),
            eq(sql`LOWER(${restaurantsTable.locationArea})`, normalizedArea),
            eq(restaurantsTable.subscriptionStatus, statusFilter),
          ),
        )
        .execute(),
    );

    if (countError) {
      console.error("RestaurantRepository: scarcity count failed", {
        error: countError,
        restaurantId,
        cuisineType: normalizedCuisine,
        locationArea: normalizedArea,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: countError instanceof Error ? countError.message : "Unknown database error",
      };
    }

    const currentCount = countResult?.[0]?.count ?? 0;

    // Phase 2: Atomic enrollment — count subquery inside UPDATE eliminates TOCTOU race.
    // The subquery runs at UPDATE time inside the DB, so the count cannot be stale.
    const { error: updateError } = await tryCatch(
      // Use raw D1 binding because the Drizzle ORM D1 driver does not expose .execute() for
      // arbitrary UPDATE statements — only for query-builder chains (select/insert/update/delete).
      db.$client
        .prepare(
          `UPDATE restaurants
           SET subscription_status = ?1
           WHERE id = ?2
             AND subscription_status = 'prospect'
             AND (
               SELECT COUNT(*)
               FROM restaurants r2
               WHERE LOWER(r2.cuisine_type) = ?3
                 AND LOWER(r2.location_area) = ?4
                 AND r2.subscription_status = ?5
             ) < ?6
             AND LOWER(cuisine_type) = ?3
             AND LOWER(location_area) = ?4`
        )
        .bind(targetStatus, restaurantId, normalizedCuisine, normalizedArea, statusFilter, String(maxSlots))
        .run(),
    );

    if (updateError) {
      console.error("RestaurantRepository: scarcity enroll failed", {
        error: updateError,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: updateError instanceof Error ? updateError.message : "Unknown database error",
      };
    }

    // Verify the update happened (idempotency / not-found / scarcity-full)
    const { data: existing } = await tryCatch(
      db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, restaurantId),
        columns: { subscriptionStatus: true },
      }),
    );

    if (existing?.subscriptionStatus === targetStatus) {
      // Enrollment succeeded — determine if this was the 2nd SaaS for retargeting
      const triggeredCompetitorActivation =
        tier === 'saas' && currentCount === 1; // was 1 before our update, now 2
      return { type: "SUCCESS", restaurantId, triggeredCompetitorActivation };
    }

    if (existing && existing.subscriptionStatus !== 'prospect') {
      return { type: "ALREADY_ENROLLED", restaurantId };
    }

    // Either not found or scarcity full — determine which
    if (currentCount >= maxSlots) {
      // Fetch cross-tier counts for the complete response
      const { data: crossTierResult } = await tryCatch(
        db
          .select({
            saasCount: sql<number>`SUM(CASE WHEN subscription_status = 'active_saas' THEN 1 ELSE 0 END)`,
            agencyCount: sql<number>`SUM(CASE WHEN subscription_status = 'active_agency' THEN 1 ELSE 0 END)`,
          })
          .from(restaurantsTable)
          .where(
            and(
              eq(sql`LOWER(${restaurantsTable.cuisineType})`, normalizedCuisine),
              eq(sql`LOWER(${restaurantsTable.locationArea})`, normalizedArea),
            ),
          )
          .execute(),
      );

      return {
        type: "SCARCITY_FULL",
        restaurantId,
        saasCount: crossTierResult?.[0]?.saasCount ?? 0,
        agencyCount: crossTierResult?.[0]?.agencyCount ?? 0,
        tier,
      };
    }

    return { type: "NOT_FOUND", restaurantId };
  }

  /**
   * Get the scarcity state for a cuisine/area combination.
   * Used by the public API to surface availability on the landing page.
   *
   * @param tier — when provided, returns per-tier availability in `isAvailable`
   *   (e.g. `isAvailable` will be `false` for SaaS even if Agency has space).
   */
  async getScarcityForCuisineArea(
    cuisineType: string,
    locationArea: string,
    tier?: 'saas' | 'agency',
  ): Promise<{
    saasCount: number;
    agencyCount: number;
    maxSaas: number;
    maxAgency: number;
    isAvailable: boolean;
  }> {
    const db = getDB();
    const normalizedCuisine = cuisineType.toLowerCase().trim();
    const normalizedArea = locationArea.toLowerCase().trim();

    const [{ data: saasResult }, { data: agencyResult }] = await Promise.all([
      tryCatch(
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(restaurantsTable)
          .where(
            and(
              eq(sql`LOWER(${restaurantsTable.cuisineType})`, normalizedCuisine),
              eq(sql`LOWER(${restaurantsTable.locationArea})`, normalizedArea),
              eq(restaurantsTable.subscriptionStatus, 'active_saas'),
            ),
          )
          .execute(),
      ),
      tryCatch(
        db
          .select({ count: sql<number>`COUNT(*)` })
          .from(restaurantsTable)
          .where(
            and(
              eq(sql`LOWER(${restaurantsTable.cuisineType})`, normalizedCuisine),
              eq(sql`LOWER(${restaurantsTable.locationArea})`, normalizedArea),
              eq(restaurantsTable.subscriptionStatus, 'active_agency'),
            ),
          )
          .execute(),
      ),
    ]);

    const saasCount = saasResult?.[0]?.count ?? 0;
    const agencyCount = agencyResult?.[0]?.count ?? 0;
    const maxSaas = 2;
    const maxAgency = 1;

    // Per-tier availability: only consider the requested tier
    const isAvailable = tier
      ? (tier === 'saas' ? saasCount < maxSaas : agencyCount < maxAgency)
      : (saasCount < maxSaas || agencyCount < maxAgency);

    return {
      saasCount,
      agencyCount,
      maxSaas,
      maxAgency,
      isAvailable,
    };
  }

  // ─── Stripe Subscription (Story 3.4) ─────────────────────

  /**
   * Enroll a restaurant after successful Stripe Checkout payment.
   * Atomic conditional UPDATE: only transitions from 'prospect' → 'active_saas'.
   * Stores Stripe customer and subscription IDs for billing management.
   */
  async enrollViaStripeCheckout(
    restaurantId: string,
    tier: string,
    stripeCustomerId: string,
    stripeSubscriptionId: string,
  ): Promise<{
      type: "SUCCESS"; restaurantId: string
    } | {
      type: "ALREADY_ENROLLED"; restaurantId: string
    } | RestaurantNotFoundError
    | DatabaseError
  > {
    const db = getDB();

    const { data: updateResult, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({
          subscriptionStatus: "active_saas",
          subscriptionTier: tier,
          stripeCustomerId,
          stripeSubscriptionId,
        })
        .where(
          and(
            eq(restaurantsTable.id, restaurantId),
            eq(restaurantsTable.subscriptionStatus, "prospect"),
          ),
        )
        .returning({ returnedId: restaurantsTable.id })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: enrollViaStripeCheckout failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!updateResult || updateResult.length === 0) {
      // Check if already enrolled (idempotency)
      const existing = await this.findById(restaurantId);
      if (existing && existing.subscriptionStatus !== "prospect") {
        return { type: "ALREADY_ENROLLED", restaurantId };
      }
      return { type: "NOT_FOUND", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Get subscription details for a restaurant.
   * Returns null if the restaurant has no active subscription (prospect or not found).
   */
  async getSubscriptionStatus(
    restaurantId: string,
  ): Promise<{
    tier: string | null;
    status: string;
    stripeSubscriptionId: string | null;
    currentPeriodEnd: number | null;
  } | null> {
    const restaurant = await this.findById(restaurantId);
    if (!restaurant) return null;

    return {
      tier: restaurant.subscriptionTier ?? null,
      status: restaurant.subscriptionStatus ?? "prospect",
      stripeSubscriptionId: restaurant.stripeSubscriptionId ?? null,
      currentPeriodEnd: restaurant.subscriptionCurrentPeriodEnd ?? null,
    };
  }

  // ─── Agency Tier Capacity (Story 3.5) ─────────────────────

  /**
   * Check global Agency Tier capacity (max MAX_AGENCY_GLOBAL) and enroll if space available.
   * Uses an atomic UPDATE with an inline count subquery — same pattern as checkScarcityAndEnroll.
   *
   * @returns AGENCY_CAPACITY_FULL if the global quota is exhausted, SUCCESS on enrollment,
   *          ALREADY_ENROLLED if the restaurant already has an active subscription,
   *          NOT_FOUND if the restaurant doesn't exist or isn't a prospect.
   */
  async checkAgencyCapacityAndEnroll(
    restaurantId: string,
  ): Promise<
    | { type: "SUCCESS"; restaurantId: string }
    | { type: "AGENCY_CAPACITY_FULL"; restaurantId: string; agencyCount: number }
    | { type: "ALREADY_ENROLLED"; restaurantId: string }
    | RestaurantNotFoundError
    | DatabaseError
  > {
    const db = getDB();

    // Phase 1: Count current active Agency clients (for response detail, not a gate)
    const { data: countResult, error: countError } = await tryCatch(
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.subscriptionStatus, 'active_agency'))
        .execute(),
    );

    if (countError) {
      console.error("RestaurantRepository: agency capacity count failed", {
        error: countError,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: countError instanceof Error ? countError.message : "Unknown database error",
      };
    }

    const currentCount = countResult?.[0]?.count ?? 0;

    // Phase 2: Atomic enrollment — inline count subquery inside UPDATE eliminates TOCTOU race.
    // The subquery runs at UPDATE time inside the DB, so the count cannot be stale.
    const { error: updateError } = await tryCatch(
      db.$client
        .prepare(
          `UPDATE restaurants
           SET subscription_status = 'active_agency'
           WHERE id = ?1
             AND subscription_status = 'prospect'
             AND (
               SELECT COUNT(*)
               FROM restaurants r2
               WHERE r2.subscription_status = 'active_agency'
             ) < ?2`
        )
        .bind(restaurantId, String(MAX_AGENCY_GLOBAL))
        .run(),
    );

    if (updateError) {
      console.error("RestaurantRepository: agency capacity enroll failed", {
        error: updateError,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: updateError instanceof Error ? updateError.message : "Unknown database error",
      };
    }

    // Phase 3: Verify the update happened (idempotency / not-found / scarcity-full)
    const { data: existing } = await tryCatch(
      db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, restaurantId),
        columns: { subscriptionStatus: true },
      }),
    );

    if (existing?.subscriptionStatus === 'active_agency') {
      return { type: "SUCCESS", restaurantId };
    }

    if (existing && existing.subscriptionStatus !== 'prospect') {
      return { type: "ALREADY_ENROLLED", restaurantId };
    }

    // Either not found or agency capacity full — determine which
    if (currentCount >= MAX_AGENCY_GLOBAL) {
      return {
        type: "AGENCY_CAPACITY_FULL",
        restaurantId,
        agencyCount: currentCount,
      };
    }

    return { type: "NOT_FOUND", restaurantId };
  }

  /**
   * Get the global Agency Tier capacity state.
   * @throws Error on database failure — callers must handle.
   */
  async getAgencyCapacityState(): Promise<{
    agencyCount: number;
    maxAgency: number;
    isAvailable: boolean;
  }> {
    const db = getDB();

    const { data: countResult, error } = await tryCatch(
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.subscriptionStatus, 'active_agency'))
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: getAgencyCapacityState failed", { error });
      throw new Error(error instanceof Error ? error.message : "Failed to query agency capacity");
    }

    const agencyCount = countResult?.[0]?.count ?? 0;

    return {
      agencyCount,
      maxAgency: MAX_AGENCY_GLOBAL,
      isAvailable: agencyCount < MAX_AGENCY_GLOBAL,
    };
  }

  // ─── Extension Auth Token Methods (Story 5.6) ────────────

  /**
   * Retrieve the current extension auth token for a restaurant.
   * Returns null if no token has been provisioned.
   */
  async getExtensionAuthToken(restaurantId: string): Promise<string | null> {
    const { data, error } = await tryCatch(
      getDB()
        .select({ extensionAuthToken: restaurantsTable.extensionAuthToken })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.id, restaurantId)),
    );

    if (error || !data || data.length === 0) return null;
    return data[0].extensionAuthToken ?? null;
  }

  /**
   * Generate a new extension auth token.
   * Idempotent: if a token already exists, returns the existing one.
   *
   * Uses an atomic UPDATE ... WHERE ... IS NULL to eliminate TOCTOU races.
   * Falls back to a SELECT if another request won the race.
   */
  async generateExtensionAuthToken(restaurantId: string): Promise<{ token: string } | DatabaseError> {
    const token = `ext_${createId()}`;
    const db = getDB();

    // Atomic write: only succeeds if no token currently exists
    const { data: result, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({ extensionAuthToken: token })
        .where(
          and(
            eq(restaurantsTable.id, restaurantId),
            sql`${restaurantsTable.extensionAuthToken} IS NULL`,
          ),
        )
        .returning({ extensionAuthToken: restaurantsTable.extensionAuthToken })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: generateExtensionAuthToken failed", { error, restaurantId });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Failed to generate extension auth token",
      };
    }

    // Race won: we were first to write — return our token
    if (result && result.length > 0) {
      return { token: result[0].extensionAuthToken };
    }

    // No row updated — token already exists or restaurant not found
    const existing = await this.getExtensionAuthToken(restaurantId);
    if (existing) {
      return { token: existing };
    }

    return {
      type: "DATABASE_ERROR",
      restaurantId,
      message: "Restaurant not found or unable to generate token",
    };
  }

  /**
   * Force-regenerate an extension auth token (invalidates old one).
   * Used for token rotation when an owner suspects compromise (AC 4).
   *
   * After writing, reads back the DB value so the caller always receives
   * the current active token (mitigates last-write-wins race).
   */
  async regenerateExtensionAuthToken(restaurantId: string): Promise<{ token: string } | DatabaseError> {
    const token = `ext_${createId()}`;
    const db = getDB();

    const { error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({ extensionAuthToken: token })
        .where(eq(restaurantsTable.id, restaurantId)),
    );

    if (error) {
      console.error("RestaurantRepository: regenerateExtensionAuthToken failed", { error, restaurantId });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Failed to regenerate extension auth token",
      };
    }

    // Read back from DB to return the current canonical value
    const current = await this.getExtensionAuthToken(restaurantId);
    return { token: current ?? token };
  }

  /**
   * Clear the extension auth token (set to NULL in D1).
   * Used when subscription is cancelled (AC 5) or administrative deprovisioning.
   *
   * Verifies the restaurant exists by using RETURNING.
   */
  async clearExtensionAuthToken(restaurantId: string): Promise<{ success: boolean } | DatabaseError> {
    const db = getDB();

    const { data: result, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({ extensionAuthToken: null })
        .where(eq(restaurantsTable.id, restaurantId))
        .returning({ id: restaurantsTable.id })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: clearExtensionAuthToken failed", { error, restaurantId });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Failed to clear extension auth token",
      };
    }

    // No row updated → restaurant did not exist
    return { success: (result ?? []).length > 0 };
  }

  /**
   * Get the last operator P1 alert timestamp for a restaurant.
   * Returns null if never alerted.
   */
  async getLastOperatorAlertAt(restaurantId: string): Promise<Date | null> {
    const { data, error } = await tryCatch(
      getDB()
        .select({ lastOperatorAlertAt: restaurantsTable.lastOperatorAlertAt })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.id, restaurantId))
        .execute(),
    );

    if (error || !data || data.length === 0) return null;
    return data[0].lastOperatorAlertAt ?? null;
  }

  /**

  /**
   * Update the last offline alert timestamp for a restaurant.
   * Used by the extension offline monitor (Story 6.5) for alert throttling.
   *
   * @deprecated Use checkAndUpdateLastOfflineAlertAt for atomic throttle logic.
   */
  async updateLastOfflineAlertAt(restaurantId: string): Promise<UpdateResult> {
    const db = getDB();

    const { error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({ lastOfflineAlertAt: new Date() })
        .where(eq(restaurantsTable.id, restaurantId))
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: updateLastOfflineAlertAt failed", { error, restaurantId });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Failed to update offline alert timestamp",
      };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Atomically check and update the last offline alert timestamp.
   *
   * Uses a conditional UPDATE (WHERE last_offline_alert_at IS NULL OR
   * last_offline_alert_at < threshold) to eliminate TOCTOU races.
   * Two parallel cron runs for the same restaurant cannot both pass
   * the throttle check because the UPDATE is atomic.
   *
   * @returns true if the timestamp was updated (caller should send the alert).
   */
  async checkAndUpdateLastOfflineAlertAt(restaurantId: string): Promise<boolean> {
    const db = getDB();
    const now = new Date();
    const throttleHours = 24;
    const threshold = Date.now() - throttleHours * 60 * 60 * 1000;

    const { data, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({ lastOfflineAlertAt: now })
        .where(
          and(
            eq(restaurantsTable.id, restaurantId),
            sql`${restaurantsTable.lastOfflineAlertAt} IS NULL OR ${restaurantsTable.lastOfflineAlertAt} < ${threshold}`,
          ),
        )
        .returning({ id: restaurantsTable.id })
        .execute(),
    );


    if (error) {
      console.error("RestaurantRepository: checkAndUpdateLastOfflineAlertAt failed", {
        error,
        restaurantId,
      });
      return false;
    }

    return data !== undefined && data.length > 0;
  }

  // ─── Guardian Mode (Story 7.3) ─────────────────────────

  /**
   * Atomically update the operational mode for a restaurant.
   * ADR-003 compliance: uses state-precondition check to prevent race conditions.
   *
   * @param restaurantId - Restaurant to update
   * @param newMode - Target mode
   * @param expectedMode - Current mode precondition (e.g., must be in peak_season to transition to guardian)
   * @returns SUCCESS if the update happened, NO_OP if the precondition wasn't met
   */
  async updateOperationalMode(
    restaurantId: string,
    newMode: "peak_season" | "local_seo_guardian" | "pre_season_booking" | "hibernate",
    expectedMode?: "peak_season" | "local_seo_guardian" | "pre_season_booking" | "hibernate",
  ): Promise<UpdateResult | { type: "NO_OP"; restaurantId: string }> {
    const db = getDB();
    const now = new Date();

    const setPayload: Record<string, unknown> = {
      operationalMode: newMode,
      modeChangedAt: now,
    };

    if (newMode === "local_seo_guardian") {
      setPayload.guardianModeSince = now;
      setPayload.peakSeasonEndDetectedAt = now;
    }

    const conditions = expectedMode
      ? and(
          eq(restaurantsTable.id, restaurantId),
          eq(restaurantsTable.operationalMode, expectedMode),
        )
      : eq(restaurantsTable.id, restaurantId);

    const { data: result, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set(setPayload)
        .where(conditions)
        .returning({ id: restaurantsTable.id }),
    );

    if (error) {
      console.error("RestaurantRepository: updateOperationalMode failed", {
        error,
        restaurantId,
        newMode,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!result || result.length === 0) {
      return { type: "NO_OP", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Get all restaurants in a specific operational mode.
   * Used by the Seasonal Detector and Guardian Report Generator.
   */
  async getRestaurantsByMode(
    mode: "peak_season" | "local_seo_guardian" | "pre_season_booking" | "hibernate",
  ): Promise<{ data: Restaurant[]; error?: string }> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .select()
        .from(restaurantsTable)
        .where(eq(restaurantsTable.operationalMode, mode)),
    );

    if (error) {
      console.error("RestaurantRepository: getRestaurantsByMode failed", { error, mode });
      return { data: [], error: error instanceof Error ? error.message : "Unknown database error" };
    }

    return { data: data ?? [] };
  }

  /**
   * Get the SEO Guardian config for a restaurant, falling back to defaults.
   */
  async getSeoGuardianConfig(restaurantId: string): Promise<{
    config: SeoGuardianConfig;
  } | null> {
    const db = getDB();

    const { data } = await tryCatch(
      db
        .select({ seoGuardianConfig: restaurantsTable.seoGuardianConfig })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.id, restaurantId)),
    );

    if (!data || data.length === 0) return null;

    const config = (data[0].seoGuardianConfig as SeoGuardianConfig) ?? DEFAULT_SEO_GUARDIAN_CONFIG;

    return { config };
  }

  /**
   * Atomically check and update the last operator P1 alert timestamp.
   *
   * Same atomic update pattern as checkAndUpdateLastOfflineAlertAt but with
   * a 6-hour throttle for operator escalations.
   *
   * @returns true if the timestamp was updated (caller should send the P1 alert).
   */
  async checkAndUpdateLastOperatorAlertAt(restaurantId: string): Promise<boolean> {
    const db = getDB();
    const now = new Date();
    const throttleHours = 6;
    const threshold = Date.now() - throttleHours * 60 * 60 * 1000;

    const { data, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({ lastOperatorAlertAt: now })
        .where(
          and(
            eq(restaurantsTable.id, restaurantId),
            sql`${restaurantsTable.lastOperatorAlertAt} IS NULL OR ${restaurantsTable.lastOperatorAlertAt} < ${threshold}`,
          ),
        )
        .returning({ id: restaurantsTable.id })
        .execute(),
    );

    if (error) {
      console.error("RestaurantRepository: checkAndUpdateLastOperatorAlertAt failed", {
        error,
        restaurantId,
      });
      return false;
    }

    return data !== undefined && data.length > 0;
  }

  // ─── Hibernate Tier (Story 7.5) ─────────────────────────

  /**
   * Atomically update subscription status to hibernate.
   * ADR-003 compliance: only transitions from active_saas or active_agency.
   * Sets subscriptionStatus, operationalMode, hibernateSince, and modeChangedAt
   * in a single atomic update.
   */
  async updateSubscriptionToHibernate(restaurantId: string): Promise<
    | { type: "SUCCESS"; restaurantId: string }
    | { type: "NO_OP"; restaurantId: string }
    | RestaurantNotFoundError
    | DatabaseError
  > {
    const db = getDB();
    const now = new Date();

    const { data: result, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({
          subscriptionStatus: "hibernate",
          operationalMode: "hibernate",
          hibernateSince: now,
          modeChangedAt: now,
        })
        .where(
          and(
            eq(restaurantsTable.id, restaurantId),
            inArray(restaurantsTable.subscriptionStatus, ["active_saas", "active_agency"]),
          ),
        )
        .returning({ id: restaurantsTable.id }),
    );

    if (error) {
      console.error("RestaurantRepository: updateSubscriptionToHibernate failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!result || result.length === 0) {
      return { type: "NO_OP", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Reactivate a restaurant from hibernate status.
   * Atomically transitions back to the appropriate subscription status
   * and operational mode. Only succeeds if currently in hibernate.
   *
   * @param targetMode — the operational mode to transition into (determined by current month)
   */
  async reactivateFromHibernate(
    restaurantId: string,
    targetMode: "peak_season" | "local_seo_guardian" | "pre_season_booking",
  ): Promise<
    | { type: "SUCCESS"; restaurantId: string }
    | { type: "NO_OP"; restaurantId: string }
    | RestaurantNotFoundError
    | DatabaseError
  > {
    const db = getDB();
    const now = new Date();

    const { data: result, error } = await tryCatch(
      db
        .update(restaurantsTable)
        .set({
          subscriptionStatus: "active_saas",
          operationalMode: targetMode,
          modeChangedAt: now,
          hibernateSince: null,
        })
        .where(
          and(
            eq(restaurantsTable.id, restaurantId),
            eq(restaurantsTable.subscriptionStatus, "hibernate"),
          ),
        )
        .returning({ id: restaurantsTable.id }),
    );

    if (error) {
      console.error("RestaurantRepository: reactivateFromHibernate failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        restaurantId,
        message: error instanceof Error ? error.message : "Unknown database error",
      };
    }

    if (!result || result.length === 0) {
      return { type: "NO_OP", restaurantId };
    }

    return { type: "SUCCESS", restaurantId };
  }

  /**
   * Compute reactivation eligibility for a restaurant.
   * Summarizes what assets exist so the owner knows what they'll get back.
   */
  async computeReactivationEligibility(
    restaurantId: string,
  ): Promise<ReactivationEligibility> {
    const db = getDB();
    const GRACE_PERIOD_DAYS = 90;
    const gracePeriodEnds = new Date(
      Date.now() + GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000,
    );

    // Count campaigns
    const { data: campaignCount } = await tryCatch(
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(campaignsTable)
        .where(eq(campaignsTable.restaurantId, restaurantId)),
    );

    // Get last campaign date
    const { data: lastCampaign } = await tryCatch(
      db
        .select({ createdAt: campaignsTable.createdAt })
        .from(campaignsTable)
        .where(eq(campaignsTable.restaurantId, restaurantId))
        .orderBy(sql`created_at DESC`)
        .limit(1),
    );

    // Get restaurant metadata
    const { data: restaurant } = await tryCatch(
      db
        .select({
          brandPersonaFragment: restaurantsTable.brandPersonaFragment,
          r2AssetCount: sql<number>`0`, // Proxy until R2 count endpoint is implemented
          r2TotalSizeBytes: sql<number>`0`,
        })
        .from(restaurantsTable)
        .where(eq(restaurantsTable.id, restaurantId)),
    );

    const campaignsGenerated = campaignCount?.[0]?.count as number ?? 0;
    const hasBrandPersona = !!restaurant?.[0]?.brandPersonaFragment;

    // Determine connected platforms from campaign data
    const { data: platforms } = await tryCatch(
      db
        .selectDistinct({ platform: campaignsTable.platforms })
        .from(campaignsTable)
        .where(eq(campaignsTable.restaurantId, restaurantId)),
    );

    const connectedPlatforms: string[] = [];
    if (platforms) {
      for (const p of platforms) {
        if (p.platform) {
          const split = p.platform.split(",");
          for (const s of split) {
            const trimmed = s.trim();
            if (trimmed && !connectedPlatforms.includes(trimmed)) {
              connectedPlatforms.push(trimmed);
            }
          }
        }
      }
    }

    return {
      campaignsGenerated,
      lastCampaignAt:
        lastCampaign && lastCampaign.length > 0 && lastCampaign[0].createdAt
          ? new Date(lastCampaign[0].createdAt as number).toISOString()
          : null,
      r2AssetCount: restaurant?.[0]?.r2AssetCount as number ?? 0,
      r2TotalSizeBytes: restaurant?.[0]?.r2TotalSizeBytes as number ?? 0,
      hasBrandPersona,
      connectedPlatforms,
      eligibleForReactivation: true, // Data is never purged during hibernate
      reactivationGracePeriodEnds: gracePeriodEnds.toISOString(),
    };
  }

  /**
   * Persist reactivation eligibility snapshot to D1.
   * Called during hibernate transition so dashboard can show it instantly.
   */
  async persistReactivationEligibility(restaurantId: string): Promise<void> {
    const eligibility = await this.computeReactivationEligibility(restaurantId);
    const db = getDB();

    await tryCatch(
      db
        .update(restaurantsTable)
        .set({ reactivationEligibility: eligibility })
        .where(eq(restaurantsTable.id, restaurantId)),
    );
  }

  /**
   * Suspend R2 access for a restaurant by clearing extension auth token.
   * Does NOT delete R2 objects — data preservation is the whole point of hibernate.
   * Reuses existing `clearExtensionAuthToken()` method.
   */
  async suspendR2Access(restaurantId: string): Promise<{ success: boolean } | DatabaseError> {
    // Clearing the extension auth token effectively suspends GB publishing
    // and R2 signed URL access through the extension
    return this.clearExtensionAuthToken(restaurantId);
  }

  /**
   * Restore R2 access by generating a new extension auth token.
   * Called during reactivation.
   */
  async restoreR2Access(restaurantId: string): Promise<{ token: string } | DatabaseError> {
    return this.generateExtensionAuthToken(restaurantId);
  }

  /**
   * Find all Annual Pro restaurants that should enter hibernation.
   * Used by the Annual Pro Hibernate Manager Worker cron.
   */
  async getAnnualProClientsForHibernation(): Promise<{ data: Restaurant[]; error?: string }> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .select()
        .from(restaurantsTable)
        .where(
          and(
            eq(restaurantsTable.subscriptionTier, "annual_pro"),
            inArray(restaurantsTable.subscriptionStatus, ["active_saas", "active_agency"]),
          ),
        ),
    );

    if (error) {
      console.error("RestaurantRepository: getAnnualProClientsForHibernation failed", { error });
      return { data: [], error: error instanceof Error ? error.message : "Unknown database error" };
    }

    return { data: data ?? [] };
  }

  /**
   * Find all hibernated Annual Pro restaurants ready for reactivation.
   * Used by the Annual Pro Reactivation Manager Worker cron.
   */
  async getHibernatingAnnualProClients(): Promise<{ data: Restaurant[]; error?: string }> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .select()
        .from(restaurantsTable)
        .where(
          and(
            eq(restaurantsTable.subscriptionTier, "annual_pro"),
            eq(restaurantsTable.subscriptionStatus, "hibernate"),
          ),
        ),
    );

    if (error) {
      console.error("RestaurantRepository: getHibernatingAnnualProClients failed", { error });
      return { data: [], error: error instanceof Error ? error.message : "Unknown database error" };
    }

    return { data: data ?? [] };
  }
}

// ─── Singleton Export ──────────────────────────────────────

/** Single shared instance of RestaurantRepository */
export const restaurantRepo = new RestaurantRepository();
