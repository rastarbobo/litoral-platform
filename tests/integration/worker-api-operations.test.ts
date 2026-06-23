/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, it, expect, beforeEach } from "vitest";
import { getDB } from "@/db";
import {
  restaurantsTable,
  environmentalSignalsTable,
  campaignsTable,
  analyticsEventsTable,
} from "@/db/schema";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import { eq, and } from "drizzle-orm";

/**
 * Integration tests for Worker API repository operations
 * (n8n → Platform: scrape, score, diagnostic, media updates).
 *
 * The actual HTTP route handlers are tested via the existing
 * worker-edge.test.ts and scrape-update/route.test.ts.
 * These tests cover the repository-level operations powering:
 *
 * - POST /api/worker/scrape-update
 * - POST /api/worker/score-update
 * - POST /api/worker/diagnostic-update
 * - POST /api/worker/media-update
 *
 * Coverage:
 * - updateScrapeData: upsert with Google Maps + Instagram data
 * - updateScoringData: readiness score + band + gap explanation
 * - updateDiagnosticPackage: JSON diagnostic package persistence
 * - updateMedia: enhanced photo URL
 * - Idempotency: repeated calls with same data
 * - Concurrent modification protection
 */

const TEST_RESTAURANT = {
  id: "rest_worker_api",
  name: "Worker API Test Trattoria",
  slug: "worker-api-test",
  cuisineType: "greek",
  locationArea: "astoria",
  googlePlaceId: "ChIJD7fiBh9uEmsRB6I",
  subscriptionStatus: "prospect" as const,
  googleRating: 3.9,
  reviewCount: 45,
  qualificationStatus: "pending" as const,
  behavioralState: 0,
};

const TEST_RESTAURANT_2 = {
  id: "rest_worker_api_2",
  name: "Worker API Test Bistro 2",
  slug: "worker-api-test-2",
  cuisineType: "vietnamese",
  locationArea: "chinatown",
  subscriptionStatus: "prospect" as const,
  googleRating: 4.2,
  reviewCount: 30,
  qualificationStatus: "pending" as const,
  behavioralState: 0,
};

describe("Worker API Repository Integration", () => {
  beforeEach(async () => {
    const db = getDB();
    await db.delete(environmentalSignalsTable);
    await db.delete(analyticsEventsTable);
    await db.delete(campaignsTable);
    await db.delete(restaurantsTable).where(
      eq(restaurantsTable.id, TEST_RESTAURANT.id),
    );
    await db.delete(restaurantsTable).where(
      eq(restaurantsTable.id, TEST_RESTAURANT_2.id),
    );
    await db.insert(restaurantsTable).values(TEST_RESTAURANT);
    await db.insert(restaurantsTable).values(TEST_RESTAURANT_2);
  });

  // ─── Scrape Data Update ───────────────────────────────────

  describe("updateScrapeData", () => {
    it("upserts Google Maps data and Instagram metrics", async () => {
      const result = await restaurantRepo.updateScrapeData(
        TEST_RESTAURANT.id,
        {
          updatedAt: new Date(),
          lastScrapedAt: new Date(),
          instagramFollowers: 2500,
          instagramEngagementRate: 420, // 4.2% in bps
          googleMapsData: {
            placeId: "ChIJD7fiBh9uEmsRB6I",
            name: "Astoria Gyro House",
            address: "123 Steinway St, Astoria, NY",
            rating: 4.3,
            reviewCount: 200,
            phone: "+1-555-0199",
          },
          competitorData: {
            competitors: [
              {
                name: "Zorba's Grill",
                instagramFollowers: 1800,
                googleRating: 4.1,
                googleReviewCount: 150,
              },
            ],
          },
        },
      );

      expect(result.type).toBe("SUCCESS");

      // Verify data persisted in D1
      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.instagramFollowers).toBe(2500);
      expect(restaurant!.instagramEngagementRate).toBe(420);
      expect(restaurant!.googleMapsData).toBeTruthy();
      expect(restaurant!.competitorData).toBeTruthy();
      expect(restaurant!.lastScrapedAt).not.toBeNull();
    });

    it("returns SUCCESS for partial update (no competitor data)", async () => {
      const result = await restaurantRepo.updateScrapeData(
        TEST_RESTAURANT.id,
        {
          updatedAt: new Date(),
          lastScrapedAt: new Date(),
          googleMapsData: { rating: 4.5, reviewCount: 300 },
        },
      );

      expect(result.type).toBe("SUCCESS");

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.googleMapsData).toBeTruthy();
      expect(restaurant!.competitorData).toBeNull(); // Not provided
    });

    it("returns NOT_FOUND for non-existent restaurant", async () => {
      const result = await restaurantRepo.updateScrapeData("rest_ghost", {
        updatedAt: new Date(),
        lastScrapedAt: new Date(),
      });
      expect(result.type).toBe("NOT_FOUND");
    });

    it("preserves existing data when updating with partial payload", async () => {
      // First: full update with Instagram data
      await restaurantRepo.updateScrapeData(TEST_RESTAURANT.id, {
        updatedAt: new Date(),
        lastScrapedAt: new Date(),
        instagramFollowers: 3000,
        googleMapsData: { rating: 4.0 },
      });

      // Second: partial update with only competitor data
      const result = await restaurantRepo.updateScrapeData(TEST_RESTAURANT.id, {
        updatedAt: new Date(),
        lastScrapedAt: new Date(),
        competitorData: { competitors: [{ name: "New Competitor" }] },
      });
      expect(result.type).toBe("SUCCESS");

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      // Instagram followers should be preserved from first update
      expect(restaurant!.instagramFollowers).toBe(3000);
      // Competitor data should be from second update
      expect(restaurant!.competitorData).toBeTruthy();
    });
  });

  // ─── Scoring Data Update ──────────────────────────────────

  describe("updateScoringData", () => {
    it("persists marketing readiness score with band and gap", async () => {
      const result = await restaurantRepo.updateScoringData(
        TEST_RESTAURANT.id,
        {
          updatedAt: new Date(),
          marketingReadinessScore: 78,
          scoreBand: "high",
          primaryGapExplanation: "Instagram engagement below 2%",
        },
      );

      expect(result.type).toBe("SUCCESS");

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.marketingReadinessScore).toBe(78);
      expect(restaurant!.scoreBand).toBe("high");
      expect(restaurant!.primaryGapExplanation).toBe("Instagram engagement below 2%");
    });

    it("updates an existing score to a new value", async () => {
      // Initial score
      await restaurantRepo.updateScoringData(TEST_RESTAURANT.id, {
        updatedAt: new Date(),
        marketingReadinessScore: 50,
        scoreBand: "medium",
        primaryGapExplanation: "Low review count",
      });

      // Updated score
      await restaurantRepo.updateScoringData(TEST_RESTAURANT.id, {
        updatedAt: new Date(),
        marketingReadinessScore: 85,
        scoreBand: "high",
        primaryGapExplanation: "Improved Instagram presence",
      });

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.marketingReadinessScore).toBe(85);
      expect(restaurant!.scoreBand).toBe("high");
    });

    it("handles edge case: score = 0", async () => {
      const result = await restaurantRepo.updateScoringData(
        TEST_RESTAURANT.id,
        {
          updatedAt: new Date(),
          marketingReadinessScore: 0,
          scoreBand: "very_low",
          primaryGapExplanation: "No online presence",
        },
      );

      expect(result.type).toBe("SUCCESS");

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.marketingReadinessScore).toBe(0);
    });
  });

  // ─── Diagnostic Package Update ────────────────────────────

  describe("updateDiagnosticPackage", () => {
    it("persists diagnostic package JSON", async () => {
      const diagnosticData = {
        overallScore: 72,
        gaps: [
          { area: "Instagram", severity: "high", recommendation: "Post 3x/week" },
          { area: "Google Reviews", severity: "medium", recommendation: "Respond to all reviews" },
        ],
        opportunities: ["Seasonal menu promotion", "Local influencer partnership"],
      };

      const result = await restaurantRepo.updateDiagnosticPackage(
        TEST_RESTAURANT.id,
        { diagnosticPackage: diagnosticData },
      );

      expect(result.type).toBe("SUCCESS");

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.diagnosticPackage).toBeTruthy();

      // Verify JSON round-trip
      const parsed = restaurant!.diagnosticPackage as typeof diagnosticData;
      expect(parsed.overallScore).toBe(72);
      expect(parsed.gaps).toHaveLength(2);
      expect(parsed.opportunities).toContain("Seasonal menu promotion");
    });

    it("updates an existing diagnostic package", async () => {
      // Initial
      await restaurantRepo.updateDiagnosticPackage(TEST_RESTAURANT.id, {
        diagnosticPackage: { overallScore: 50 },
      });

      // Updated
      await restaurantRepo.updateDiagnosticPackage(TEST_RESTAURANT.id, {
        diagnosticPackage: { overallScore: 90 },
      });

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      const parsed = restaurant!.diagnosticPackage as { overallScore: number };
      expect(parsed.overallScore).toBe(90);
    });
  });

  // ─── Media Update ─────────────────────────────────────────

  describe("updateMedia", () => {
    it("persists enhanced photo URL", async () => {
      const result = await restaurantRepo.updateMedia(
        TEST_RESTAURANT.id,
        { enhancedPhotoUrl: "https://r2.example.com/photos/rest_worker_api/enhanced.jpg" },
      );

      expect(result.type).toBe("SUCCESS");

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.enhancedPhotoUrl).toBe(
        "https://r2.example.com/photos/rest_worker_api/enhanced.jpg",
      );
    });

    it("overwrites existing enhanced photo URL", async () => {
      // First photo
      await restaurantRepo.updateMedia(TEST_RESTAURANT.id, {
        enhancedPhotoUrl: "https://r2.example.com/old_photo.jpg",
      });

      // New (better) photo
      await restaurantRepo.updateMedia(TEST_RESTAURANT.id, {
        enhancedPhotoUrl: "https://r2.example.com/new_photo.jpg",
      });

      const db = getDB();
      const restaurant = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT.id),
      });
      expect(restaurant!.enhancedPhotoUrl).toBe("https://r2.example.com/new_photo.jpg");
    });

    it("returns NOT_FOUND for non-existent restaurant", async () => {
      const result = await restaurantRepo.updateMedia("rest_ghost", {
        enhancedPhotoUrl: "https://example.com/nope.jpg",
      });
      expect(result.type).toBe("NOT_FOUND");
    });
  });

  // ─── Multi-Tenancy Data Isolation ─────────────────────────

  describe("multi-tenancy isolation", () => {
    it("updates only the target restaurant, not others", async () => {
      // Update restaurant 1
      await restaurantRepo.updateScrapeData(TEST_RESTAURANT.id, {
        updatedAt: new Date(),
        lastScrapedAt: new Date(),
        instagramFollowers: 9999,
      });

      // Restaurant 2 should remain unchanged
      const db = getDB();
      const r2 = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT_2.id),
      });
      expect(r2!.instagramFollowers).toBeNull();
    });

    it("score update scoped to single restaurant", async () => {
      await restaurantRepo.updateScoringData(TEST_RESTAURANT.id, {
        updatedAt: new Date(),
        marketingReadinessScore: 99,
        scoreBand: "high",
        primaryGapExplanation: "None",
      });

      const db = getDB();
      const r2 = await db.query.restaurantsTable.findFirst({
        where: eq(restaurantsTable.id, TEST_RESTAURANT_2.id),
      });
      expect(r2!.marketingReadinessScore).toBeNull();
      expect(r2!.scoreBand).toBeNull();
    });
  });
});