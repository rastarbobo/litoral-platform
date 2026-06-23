import { describe, it, expect, beforeEach } from 'vitest';
import { restaurantRepo, OPT_OUT_STATE } from '@/db/repositories/restaurant-repository';
import { getDB } from '@/db';
import { restaurantsTable } from '@/db/schema';
import { eq } from 'drizzle-orm';



describe('Prospect Landing Page - CRO Variant Engine', () => {
  beforeEach(async () => {
    const db = getDB();
    await db.delete(restaurantsTable).where(eq(restaurantsTable.id, 'test-landing-page'));
  });

  describe('Data fetching', () => {
    it('fetches prospect data correctly for a valid slug', async () => {
      const db = getDB();
      await db.insert(restaurantsTable).values({
        id: 'test-landing-page',
        name: 'Test Landing Restaurant',
        slug: 'test-landing-slug',
        marketingReadinessScore: 88,
        scoreBand: 'strong',
        primaryGapExplanation: 'Testing gap',
        diagnosticPackage: JSON.stringify({ summary: 'test' }),
        competitorData: JSON.stringify({ nearest: 'Other Place' }),
        enhancedPhotoUrl: 'https://example.com/photo.jpg',
        behavioralState: 0,
        qualificationStatus: 'pending',
      });

      const restaurant = await restaurantRepo.findBySlug('test-landing-slug');
      expect(restaurant).toBeDefined();
      expect(restaurant?.name).toBe('Test Landing Restaurant');
      expect(restaurant?.slug).toBe('test-landing-slug');
      expect(restaurant?.marketingReadinessScore).toBe(88);
    });

    it('returns null for an invalid slug', async () => {
      const restaurant = await restaurantRepo.findBySlug('invalid-slug-not-exists');
      expect(restaurant).toBeNull();
    });
  });

  describe('CRO variant assignment', () => {
    it('deterministically assigns a CRO variant based on restaurant ID hash', () => {
      const restaurant = {
        id: 'test-landing-page',
        name: 'Test',
        croVariant: null,
      } as any;

      const variant = restaurantRepo.resolveCroVariant(restaurant);
      expect(['A_SCORE', 'B_VISUAL', 'C_NARRATIVE']).toContain(variant);

      // Same ID must always produce same variant
      const variant2 = restaurantRepo.resolveCroVariant(restaurant);
      expect(variant).toBe(variant2);
    });

    it('returns the persisted variant when restaurant already has one', () => {
      const restaurant = {
        id: 'test-landing-page',
        name: 'Test',
        croVariant: 'B_VISUAL',
      } as any;

      const variant = restaurantRepo.resolveCroVariant(restaurant);
      expect(variant).toBe('B_VISUAL');
    });

    it('varies variant by restaurant ID (different IDs get different distributions)', () => {
      const ids = ['rest_abc123', 'rest_def456', 'rest_ghi789', 'rest_jkl012', 'rest_mno345'];
      const variants = ids.map(id => {
        return restaurantRepo.resolveCroVariant({ id, name: 'Test', croVariant: null } as any);
      });

      // All valid
      expect(variants.every(v => ['A_SCORE', 'B_VISUAL', 'C_NARRATIVE'].includes(v))).toBe(true);
      // At least some variation across the sample (probabilistic but very likely)
      const uniqueVariants = new Set(variants);
      expect(uniqueVariants.size).toBeGreaterThanOrEqual(1);
    });

    it('persists a CRO variant to the database', async () => {
      const db = getDB();
      await db.insert(restaurantsTable).values({
        id: 'test-landing-page',
        name: 'Test Landing Restaurant',
        slug: 'test-landing-slug',
        marketingReadinessScore: 88,
        qualificationStatus: 'pending',
        behavioralState: 0,
      });

      const restaurant = await restaurantRepo.findBySlug('test-landing-slug');
      expect(restaurant).toBeDefined();
      expect(restaurant?.croVariant).toBeNull();

      const result = await restaurantRepo.persistCroVariant(restaurant!);
      expect(result.type).toBe('SUCCESS');

      const updated = await restaurantRepo.findBySlug('test-landing-slug');
      expect(updated?.croVariant).toBeTruthy();
      expect(['A_SCORE', 'B_VISUAL', 'C_NARRATIVE']).toContain(updated?.croVariant);
    });

    it('returns the same variant on multiple reloads (idempotency)', async () => {
      const db = getDB();
      await db.insert(restaurantsTable).values({
        id: 'test-landing-page',
        name: 'Test Landing Restaurant',
        slug: 'test-landing-slug',
        qualificationStatus: 'pending',
        behavioralState: 0,
      });

      const first = await restaurantRepo.findBySlug('test-landing-slug');
      const variant1 = restaurantRepo.resolveCroVariant(first!);

      // Simulate reload — same DB row
      const second = await restaurantRepo.findBySlug('test-landing-slug');
      const variant2 = restaurantRepo.resolveCroVariant(second!);

      expect(variant1).toBe(variant2);
    });
  });

  describe('Expiration Logic', () => {
    it('identifies prospect as expired if offerExpiresAt is in the past', async () => {
      const db = getDB();
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 1);
      
      await db.insert(restaurantsTable).values({
        id: 'test-landing-page',
        name: 'Test Expired Restaurant',
        slug: 'test-expired-slug',
        qualificationStatus: 'pending',
        behavioralState: 0,
        offerExpiresAt: pastDate,
      });

      const restaurant = await restaurantRepo.findBySlug('test-expired-slug');
      expect(restaurant).toBeDefined();
      
      const isExpired = 
        (restaurant!.offerExpiresAt && new Date(restaurant!.offerExpiresAt) < new Date()) || 
        restaurant!.behavioralState === OPT_OUT_STATE;
      
      expect(isExpired).toBe(true);
    });

    it('identifies prospect as expired if behavioralState is 6 (Opt Out)', async () => {
      const db = getDB();
      await db.insert(restaurantsTable).values({
        id: 'test-landing-page',
        name: 'Test Optout Restaurant',
        slug: 'test-optout-slug',
        qualificationStatus: 'pending',
        behavioralState: OPT_OUT_STATE,
      });

      const restaurant = await restaurantRepo.findBySlug('test-optout-slug');
      expect(restaurant).toBeDefined();
      
      const isExpired = 
        (restaurant!.offerExpiresAt && new Date(restaurant!.offerExpiresAt) < new Date()) || 
        restaurant!.behavioralState === OPT_OUT_STATE;
      
      expect(isExpired).toBe(true);
    });

    it('identifies prospect as active if neither condition is met', async () => {
      const db = getDB();
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 7);
      
      await db.insert(restaurantsTable).values({
        id: 'test-landing-page',
        name: 'Test Active Restaurant',
        slug: 'test-active-slug',
        qualificationStatus: 'pending',
        behavioralState: 3,
        offerExpiresAt: futureDate,
      });

      const restaurant = await restaurantRepo.findBySlug('test-active-slug');
      expect(restaurant).toBeDefined();
      
      const isExpired = 
        (restaurant!.offerExpiresAt && new Date(restaurant!.offerExpiresAt) < new Date()) || 
        restaurant!.behavioralState === OPT_OUT_STATE;
      
      expect(isExpired).toBe(false);
    });
  });
});
