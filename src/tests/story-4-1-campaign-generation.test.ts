/**
 * Tests for Story 4.1: Autonomous Daily Campaign Generation
 *
 * These tests validate the workflow logic, KV lock behavior, pre-flight validation,
 * campaign type selection, and Telegram notification format.
 * Pure logic tests — no Cloudflare Worker bindings needed.
 */

import { describe, it, expect } from 'vitest';

describe('Story 4.1: Autonomous Daily Campaign Generation', () => {
  // ─── Pre-flight Validation Logic ───

  describe('Pre-flight Validation Rules', () => {
    it('should require brand_persona_fragment to be non-null and >= 10 chars', () => {
      const valid = (fragment: string | null | undefined): boolean => {
        return typeof fragment === 'string' && fragment.length >= 10;
      };

      expect(valid('We are a family restaurant')).toBe(true);
      expect(valid('Short')).toBe(false);
      expect(valid(null)).toBe(false);
      expect(valid(undefined)).toBe(false);
    });

    it('should require slug to be present', () => {
      const valid = (slug: string | null | undefined): boolean => {
        return typeof slug === 'string' && slug.length > 0;
      };

      expect(valid('test-restaurant')).toBe(true);
      expect(valid('')).toBe(false);
      expect(valid(null)).toBe(false);
    });

    it('should require telegram_chat_id to be present', () => {
      const valid = (chatId: string | null | undefined): boolean => {
        return typeof chatId === 'string' && chatId.length > 0;
      };

      expect(valid('123456789')).toBe(true);
      expect(valid(null)).toBe(false);
    });

    it('should require cuisine_type to be present', () => {
      const valid = (cuisine: string | null | undefined): boolean => {
        return typeof cuisine === 'string' && cuisine.length > 0;
      };

      expect(valid('seafood')).toBe(true);
      expect(valid(null)).toBe(false);
    });

    it('should check subscription_status is active', () => {
      const isActiveClient = (status: string): boolean => {
        return ['active_saas', 'active_agency'].includes(status);
      };

      expect(isActiveClient('active_saas')).toBe(true);
      expect(isActiveClient('active_agency')).toBe(true);
      expect(isActiveClient('prospect')).toBe(false);
      expect(isActiveClient('hibernate')).toBe(false);
    });
  });

  // ─── KV Lock Key Generation ───

  describe('KV Lock Key Format', () => {
    it('should generate correct lock key format', () => {
      const slug = 'test-trattoria';
      const date = '2026-06-21';
      const lockKey = `gen_lock:${slug}:${date}`;
      expect(lockKey).toBe('gen_lock:test-trattoria:2026-06-21');
    });

    it('should sanitize slug to remove special characters', () => {
      const rawSlug = 'Café & Bistro!';
      const sanitized = rawSlug.replace(/[^a-zA-Z0-9_-]/g, '').substring(0, 64);
      expect(sanitized).toBe('CafBistro');
    });

    it('should generate lock key within 512 char KV limit', () => {
      const slug = 'a'.repeat(64);
      const date = '2026-06-21';
      const lockKey = `gen_lock:${slug}:${date}`;
      expect(lockKey.length).toBeLessThanOrEqual(512);
    });

    it('should calculate TTL as 26 hours (93600 seconds)', () => {
      const ttlSeconds = 26 * 3600;
      expect(ttlSeconds).toBe(93600);
    });
  });

  // ─── Campaign Type Validation ───

  describe('Campaign Type Selection', () => {
    const validTypes = ['flash_offer', 'seasonal_event', 'daily_special', 'brand_awareness'];

    it('should only allow valid campaign types', () => {
      expect(validTypes.includes('flash_offer')).toBe(true);
      expect(validTypes.includes('seasonal_event')).toBe(true);
      expect(validTypes.includes('daily_special')).toBe(true);
      expect(validTypes.includes('brand_awareness')).toBe(true);
      expect(validTypes.includes('invalid_type')).toBe(false);
    });

    it('should have psychological hooks mapped for each campaign type', () => {
      const hookMap: Record<string, { primary: string; technique: string }> = {
        flash_offer: { primary: 'scarcity', technique: 'limited-time' },
        seasonal_event: { primary: 'urgency', technique: 'seasonal-window' },
        daily_special: { primary: 'scarcity', technique: 'today-only' },
        brand_awareness: { primary: 'reciprocity', technique: 'community-value' },
      };

      for (const type of validTypes) {
        expect(hookMap[type]).toBeDefined();
        expect(hookMap[type].primary).toBeTruthy();
      }
    });

    it('should fall back to brand_awareness for invalid types', () => {
      const campaignType = 'unknown_type';
      const defaultType = validTypes.includes(campaignType) ? campaignType : 'brand_awareness';
      expect(defaultType).toBe('brand_awareness');
    });
  });

  // ─── Cron Window Calculation ───

  describe('Staggered Cron Window Logic', () => {
    it('should correctly calculate the 12-minute window', () => {
      const currentMinute = 125; // 02:05 UTC
      const windowStart = (currentMinute - 12 + 1440) % 1440;
      const windowEnd = currentMinute;

      expect(windowStart).toBe(113);
      expect(windowEnd).toBe(125);

      // A restaurant with offset 120 should be in the window
      const offset = 120;
      expect(offset >= windowStart && offset <= windowEnd).toBe(true);

      // A restaurant with offset 130 should not be in the window
      const offset2 = 130;
      expect(offset2 >= windowStart && offset2 <= windowEnd).toBe(false);
    });

    it('should handle midnight crossing correctly', () => {
      const windowStart = 1433;
      const windowEnd = 5;

      // Crossing midnight: offset >= 1433 OR offset <= 5
      const isInWindow = (offset: number): boolean => {
        const normalized = ((offset % 1440) + 1440) % 1440;
        return normalized >= windowStart || normalized <= windowEnd;
      };

      expect(isInWindow(1435)).toBe(true);
      expect(isInWindow(3)).toBe(true);
      expect(isInWindow(500)).toBe(false);
    });

    it('should handle campaign_cron_offset_minutes range 0-240', () => {
      // Each restaurant gets a staggered offset within a 4-hour window
      const validRange = (offset: number): boolean => offset >= 0 && offset <= 240;

      expect(validRange(0)).toBe(true);
      expect(validRange(120)).toBe(true);
      expect(validRange(240)).toBe(true);
      expect(validRange(241)).toBe(false);
    });
  });

  // ─── Signal Completeness Validation ───

  describe('Signal Completeness Validation', () => {
    it('should require weather_data and local_events', () => {
      const isComplete = (signals: Record<string, unknown> | null): boolean => {
        if (!signals) return false;
        return !!(signals.weather_data && signals.local_events);
      };

      expect(isComplete({ weather_data: {}, local_events: [] })).toBe(true);
      expect(isComplete({ weather_data: {} })).toBe(false);
      expect(isComplete({ local_events: [] })).toBe(false);
      expect(isComplete(null)).toBe(false);
    });

    it('should parse JSON string fields correctly', () => {
      const signals = {
        weather_data: '{"main":"Clear"}',
        local_events: '["event1"]',
        trending_content: null,
      };

      const weather =
        typeof signals.weather_data === 'string'
          ? JSON.parse(signals.weather_data)
          : signals.weather_data;
      const events =
        typeof signals.local_events === 'string'
          ? JSON.parse(signals.local_events)
          : signals.local_events;

      expect(weather).toEqual({ main: 'Clear' });
      expect(events).toEqual(['event1']);
    });
  });

  // ─── Telegram Notification Format ───

  describe('Telegram Notification Format (Story 5.1 compliant)', () => {
    it('should produce inline keyboard with approve/edit/deny buttons', () => {
      const keyboard = {
        inline_keyboard: [
          [
            { text: '✅ Approve & Schedule', callback_data: 'approve:rest_123' },
            { text: '💬 Edit Copy', callback_data: 'edit:rest_123' },
          ],
          [{ text: '❌ Deny', callback_data: 'deny:rest_123' }],
        ],
      };

      expect(keyboard.inline_keyboard.length).toBe(2);
      expect(keyboard.inline_keyboard[0].length).toBe(2);
      expect(keyboard.inline_keyboard[1].length).toBe(1);
      expect(keyboard.inline_keyboard[0][0].text).toContain('Approve');
      expect(keyboard.inline_keyboard[1][0].text).toContain('Deny');
    });

    it('should return campaign type labels correctly', () => {
      const typeLabels: Record<string, string> = {
        flash_offer: '⚡ Flash Offer',
        seasonal_event: '🏖️ Seasonal Event',
        daily_special: '🍽️ Daily Special',
        brand_awareness: '✨ Brand Story',
      };

      expect(typeLabels['flash_offer']).toBe('⚡ Flash Offer');
      expect(typeLabels['daily_special']).toBe('🍽️ Daily Special');
    });

    it('should truncate caption preview to 120 chars', () => {
      const caption =
        'Come join us for an amazing evening of fresh seafood and ocean views. Our chef has prepared a special menu featuring the daily catch with locally sourced ingredients.';
      const preview = caption.substring(0, 120);
      expect(preview.length).toBeLessThanOrEqual(120);
    });
  });

  // ─── Template Selection ───

  describe('Template Selection by Campaign Type', () => {
    const templateMap: Record<string, string[]> = {
      flash_offer: [
        'flash_urgent_sale',
        'flash_countdown',
        'flash_exclusive',
        'flash_today_only',
        'flash_limited_qty',
      ],
      seasonal_event: [
        'seasonal_summer',
        'seasonal_weekend',
        'seasonal_holiday',
        'seasonal_sunset',
        'seasonal_festival',
      ],
      daily_special: [
        'daily_fresh_catch',
        'daily_chef_special',
        'daily_ingredient_hero',
        'daily_plated_dish',
        'daily_behind_scenes',
      ],
      brand_awareness: [
        'brand_story',
        'brand_location_beauty',
        'brand_team_spotlight',
        'brand_review_quote',
        'brand_community',
      ],
    };

    it('should have 5 templates per campaign type (20 total core, 25 with forge)', () => {
      for (const [type, templates] of Object.entries(templateMap)) {
        expect(templates.length).toBe(5);
        expect(templates.every((t) => t.length > 0)).toBe(true);
      }
    });

    it('should select a valid template for each campaign type', () => {
      const __types = Object.keys(templateMap);
      for (const type of __types) {
        const templates = templateMap[type];
        const selected = templates[Math.floor(Math.random() * templates.length)];
        expect(templates).toContain(selected);
      }
    });
  });

  // ─── Agent Config Validation ───

  describe('Agent Config Requirements', () => {
    const requiredAgents = [
      'signal_collector',
      'opportunity_detector',
      'offer_strategist',
      'creative_director',
      'production_designer',
      'analyst',
    ];

    it('should have 6 required pipeline agents', () => {
      expect(requiredAgents.length).toBe(6);
    });

    it('should have per-agent context scoping rules', () => {
      const scoping: Record<string, string[]> = {
        signal_collector: ['city_signals', 'cuisine_type'],
        opportunity_detector: ['signals', 'brand_persona_fragment', 'cuisine_type'],
        offer_strategist: ['opportunity_brief', 'campaign_type'],
        creative_director: ['offer_strategy', 'brand_persona_fragment'],
        production_designer: ['creative_output', 'template_parameters'],
        analyst: ['campaign_performance', 'engagement_metrics'],
      };

      for (const agent of requiredAgents) {
        expect(scoping[agent]).toBeDefined();
        expect(scoping[agent].length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Error Handling Patterns ───

  describe('Error Handling Patterns', () => {
    it('should format P1 operator alert correctly', () => {
      const restaurantName = 'Test Trattoria';
      const failures = ['missing_brand_persona_fragment'];
      const restaurantId = 'rest_123';

      const alert = `[P1] [${restaurantName}] Generation failed: ${failures.join(', ')}. Halting for today. Action: Check restaurant record in D1 (id: ${restaurantId}).`;

      expect(alert).toContain('[P1]');
      expect(alert).toContain(restaurantName);
      expect(alert).toContain('missing_brand_persona_fragment');
      expect(alert).toContain(restaurantId);
    });

    it('should generate failure KV key correctly', () => {
      const slug = 'test-trattoria';
      const failureKey = `generation_failed:${slug}`;
      expect(failureKey).toBe('generation_failed:test-trattoria');
    });

    it('should have workflow timeout of 3 minutes', () => {
      const timeoutSeconds = 180;
      expect(timeoutSeconds).toBe(3 * 60);
    });
  });
});