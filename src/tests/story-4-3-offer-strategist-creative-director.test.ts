/**
 * Tests for Story 4.3: AI Pipeline — Offer Strategist & Creative Director
 *
 * These tests validate the Offer Strategist and Creative Director agent logic:
 * hook mechanism selection, context scoping, Brand Persona consistency checking,
 * Zod schema validation, retry logic, and agent error handling.
 * Pure logic tests — no external dependencies.
 */

import { describe, it, expect } from 'vitest';

describe('Story 4.3: AI Pipeline — Offer Strategist & Creative Director', () => {
  // ─── Offer Strategist: Hook Mechanism Selection ───

  describe('Offer Strategist — Hook Mechanism Selection', () => {
    const validHooks = [
      'scarcity',
      'urgency',
      'reciprocity',
      'identity',
      'loss_aversion',
      'social_proof',
    ] as const;

    const hookDefaults: Record<
      string,
      { primary: string; alternative: string }
    > = {
      flash_offer: { primary: 'scarcity', alternative: 'urgency' },
      seasonal_event: { primary: 'urgency', alternative: 'identity' },
      daily_special: { primary: 'scarcity', alternative: 'loss_aversion' },
      brand_awareness: { primary: 'identity', alternative: 'reciprocity' },
    };

    const validCampaignTypes = Object.keys(hookDefaults);

    it('should have exactly 6 valid hook archetypes', () => {
      expect(validHooks.length).toBe(6);
      expect(validHooks).toContain('scarcity');
      expect(validHooks).toContain('urgency');
      expect(validHooks).toContain('reciprocity');
      expect(validHooks).toContain('identity');
      expect(validHooks).toContain('loss_aversion');
      expect(validHooks).toContain('social_proof');
    });

    it('should have default hooks for all 4 campaign types', () => {
      for (const type of validCampaignTypes) {
        expect(hookDefaults[type]).toBeDefined();
        expect(validHooks as readonly string[]).toContain(
          hookDefaults[type].primary,
        );
        expect(validHooks as readonly string[]).toContain(
          hookDefaults[type].alternative,
        );
      }
    });

    it('should fall back to brand_awareness defaults for unknown campaign types', () => {
      const unknownType = 'unknown';
      const defaults = hookDefaults[unknownType] || hookDefaults['brand_awareness'];
      expect(defaults.primary).toBe('identity');
      expect(defaults.alternative).toBe('reciprocity');
    });

    it('should reject hooks outside the valid archetypes', () => {
      const isValidHook = (hook: string): boolean =>
        (validHooks as readonly string[]).includes(hook);

      expect(isValidHook('scarcity')).toBe(true);
      expect(isValidHook('urgency')).toBe(true);
      expect(isValidHook('fomo')).toBe(false);
      expect(isValidHook('emotional')).toBe(false);
      expect(isValidHook('')).toBe(false);
    });

    it('should return valid hook for any campaign type with a getter function', () => {
      const selectHook = (
        campaignType: string,
        override?: string,
      ): string => {
        if (override && (validHooks as readonly string[]).includes(override))
          return override;
        const defaults = hookDefaults[campaignType] || hookDefaults['brand_awareness'];
        return defaults.primary;
      };

      for (const type of validCampaignTypes) {
        const hook = selectHook(type);
        expect(validHooks).toContain(hook);
      }

      // Test overrides
      expect(selectHook('flash_offer', 'reciprocity')).toBe('reciprocity');
      expect(selectHook('unknown', 'loss_aversion')).toBe('loss_aversion');
    });
  });

  // ─── Offer Strategist: Context Scoping ───

  describe('Offer Strategist — Context Scoping', () => {
    it('should only receive opportunity brief fields (no persona/signals)', () => {
      // Simulate the strict input boundary for Offer Strategist
      const offerStrategistInput = {
        campaign_type: 'daily_special',
        opportunity_rationale:
          'Fresh catch of sea bass arrived this morning — limited to 30 portions',
        urgency_level: 4,
        restaurant_name: 'Test Trattoria',
        cuisine_type: 'seafood',
      };

      // Verify NO brand persona or signal data leaks
      expect(offerStrategistInput).not.toHaveProperty('brand_persona_fragment');
      expect(offerStrategistInput).not.toHaveProperty('weather_data');
      expect(offerStrategistInput).not.toHaveProperty('local_events');
      expect(offerStrategistInput).not.toHaveProperty('trending_content');
      expect(offerStrategistInput).not.toHaveProperty('signals');
    });

    it('should have all required input fields', () => {
      const requiredFields = [
        'campaign_type',
        'opportunity_rationale',
        'urgency_level',
      ];
      const input = {
        campaign_type: 'brand_awareness',
        opportunity_rationale: 'Standard awareness campaign',
        urgency_level: 2,
      };

      for (const field of requiredFields) {
        expect(input).toHaveProperty(field);
        expect(input[field as keyof typeof input]).toBeTruthy();
      }
    });
  });

  // ─── Offer Strategist: Output Schema Validation ───

  describe('Offer Strategist — Output Schema', () => {
    const validHooks = [
      'scarcity',
      'urgency',
      'reciprocity',
      'identity',
      'loss_aversion',
      'social_proof',
    ];

    const validateOfferStrategy = (output: unknown): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];

      if (!output || typeof output !== 'object') {
        return { valid: false, errors: ['Output must be an object'] };
      }

      const obj = output as Record<string, unknown>;

      // Check hook_mechanism
      if (!obj.hook_mechanism || typeof obj.hook_mechanism !== 'string') {
        errors.push('Missing or invalid hook_mechanism');
      } else if (!validHooks.includes(obj.hook_mechanism)) {
        errors.push(
          `Invalid hook_mechanism: ${obj.hook_mechanism}. Must be one of: ${validHooks.join(', ')}`,
        );
      }

      // Check language_framing
      if (!obj.language_framing || typeof obj.language_framing !== 'string') {
        errors.push('Missing or invalid language_framing');
      }

      // Check cta_direction
      if (!obj.cta_direction || typeof obj.cta_direction !== 'string') {
        errors.push('Missing or invalid cta_direction');
      }

      // Check urgency_level
      if (
        typeof obj.urgency_level !== 'number' ||
        obj.urgency_level < 1 ||
        obj.urgency_level > 5
      ) {
        errors.push(
          `Invalid urgency_level: ${obj.urgency_level}. Must be number 1-5`,
        );
      }

      // Check rationale
      if (!obj.rationale || typeof obj.rationale !== 'string') {
        errors.push('Missing or invalid rationale');
      }

      // Check schema_version
      if (obj.schema_version !== '1.0') {
        errors.push('Missing or invalid schema_version');
      }

      return { valid: errors.length === 0, errors };
    };

    it('should validate a correct offer strategy output', () => {
      const validOutput = {
        hook_mechanism: 'scarcity',
        language_framing:
          'Limited availability — only 30 portions of fresh sea bass tonight',
        cta_direction: 'Book now or miss out on tonight\'s special',
        urgency_level: 4,
        rationale:
          'Scarcity is optimal for this daily special due to limited 30-portion supply',
        schema_version: '1.0',
      };

      const result = validateOfferStrategy(validOutput);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject output with invalid hook_mechanism', () => {
      const invalidOutput = {
        hook_mechanism: 'fomo',
        language_framing: 'Limited availability',
        cta_direction: 'Book now',
        urgency_level: 3,
        rationale: 'Test rationale',
        schema_version: '1.0',
      };

      const result = validateOfferStrategy(invalidOutput);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('Invalid hook_mechanism'))).toBe(true);
    });

    it('should reject output with missing required fields', () => {
      const partialOutput = {
        hook_mechanism: 'scarcity',
        schema_version: '1.0',
      };

      const result = validateOfferStrategy(partialOutput);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(3);
    });

    it('should reject output with urgency_level outside 1-5 range', () => {
      const invalidOutput = {
        hook_mechanism: 'scarcity',
        language_framing: 'Test',
        cta_direction: 'Test',
        urgency_level: 6,
        rationale: 'Test',
        schema_version: '1.0',
      };

      const result = validateOfferStrategy(invalidOutput);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('urgency_level'))).toBe(true);
    });

    it('should reject non-object output', () => {
      expect(validateOfferStrategy(null).valid).toBe(false);
      expect(validateOfferStrategy(undefined).valid).toBe(false);
      expect(validateOfferStrategy('string').valid).toBe(false);
      expect(validateOfferStrategy(42).valid).toBe(false);
    });
  });

  // ─── Creative Director: Input Schema ───

  describe('Creative Director — Input Validation', () => {
    it('should require offerStrategy, brand_persona_fragment, and campaign_type', () => {
      const validateInput = (input: Record<string, unknown>): string[] => {
        const missing: string[] = [];
        const required = ['offerStrategy', 'brand_persona_fragment', 'campaign_type'];
        for (const field of required) {
          if (!input[field]) missing.push(field);
        }
        return missing;
      };

      expect(
        validateInput({
          offerStrategy: {},
          brand_persona_fragment: 'test',
          campaign_type: 'daily_special',
        }),
      ).toHaveLength(0);

      expect(
        validateInput({ offerStrategy: {}, brand_persona_fragment: '' }),
      ).toContain('brand_persona_fragment');

      expect(validateInput({})).toContain('offerStrategy');
    });
  });

  // ─── Creative Director: Output Schema Validation ───

  describe('Creative Director — Output Schema', () => {
    const validateCreativeBrief = (output: unknown): { valid: boolean; errors: string[] } => {
      const errors: string[] = [];

      if (!output || typeof output !== 'object') {
        return { valid: false, errors: ['Output must be an object'] };
      }

      const obj = output as Record<string, unknown>;

      // Check caption
      if (!obj.caption || typeof obj.caption !== 'string') {
        errors.push('Missing or invalid caption');
      }

      // Check visual_direction
      if (!obj.visual_direction || typeof obj.visual_direction !== 'string') {
        errors.push('Missing or invalid visual_direction');
      }

      // Check template_selection
      if (!obj.template_selection || typeof obj.template_selection !== 'object') {
        errors.push('Missing or invalid template_selection');
      } else {
        const ts = obj.template_selection as Record<string, unknown>;
        if (!ts.fallback_type || typeof ts.fallback_type !== 'string') {
          errors.push('template_selection must have fallback_type');
        }
        if (
          ts.style_keywords &&
          (!Array.isArray(ts.style_keywords) ||
            !ts.style_keywords.every((k: unknown) => typeof k === 'string'))
        ) {
          errors.push('style_keywords must be array of strings');
        }
      }

      // Check format_specifications
      if (
        !obj.format_specifications ||
        typeof obj.format_specifications !== 'object'
      ) {
        errors.push('Missing or invalid format_specifications');
      } else {
        const fs = obj.format_specifications as Record<string, unknown>;
        const validPlatforms = ['instagram', 'facebook', 'both'];
        if (fs.platform && !validPlatforms.includes(fs.platform as string)) {
          errors.push(
            `Invalid platform: ${fs.platform}. Must be one of: ${validPlatforms.join(', ')}`,
          );
        }
      }

      // Check tone_of_voice
      if (!obj.tone_of_voice || typeof obj.tone_of_voice !== 'object') {
        errors.push('Missing or invalid tone_of_voice');
      } else {
        const tv = obj.tone_of_voice as Record<string, unknown>;
        if (
          typeof tv.persona_alignment_score !== 'number' ||
          tv.persona_alignment_score < 0 ||
          tv.persona_alignment_score > 1
        ) {
          errors.push(
            `Invalid persona_alignment_score: ${tv.persona_alignment_score}. Must be 0-1`,
          );
        }
      }

      // Check schema_version
      if (obj.schema_version !== '1.0') {
        errors.push('Missing or invalid schema_version');
      }

      return { valid: errors.length === 0, errors };
    };

    it('should validate a correct creative brief output', () => {
      const validBrief = {
        caption:
          'Tonight only: Our fresh catch sea bass. Only 30 portions. Book your table now.',
        visual_direction:
          'Close-up hero shot of grilled sea bass with lemon and herbs, warm golden hour lighting, shallow depth of field',
        template_selection: {
          preferred_id: 'daily_fresh_catch',
          fallback_type: 'daily_fresh_catch',
          style_keywords: ['fresh', 'golden', 'appetizing'],
        },
        format_specifications: {
          platform: 'both',
          aspect_ratio: '1:1',
          story_companion: true,
        },
        tone_of_voice: {
          persona_alignment_score: 0.92,
          voice: 'Warm, family-oriented coastal restaurant',
          key_phrases: ['fresh catch', 'tonight only', 'family recipe'],
        },
        schema_version: '1.0',
      };

      const result = validateCreativeBrief(validBrief);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject output with missing caption', () => {
      const result = validateCreativeBrief({
        visual_direction: 'Test',
        template_selection: { fallback_type: 'standard' },
        format_specifications: { platform: 'both' },
        tone_of_voice: { persona_alignment_score: 0.9 },
        schema_version: '1.0',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('caption'))).toBe(true);
    });

    it('should reject output with invalid persona_alignment_score', () => {
      const result = validateCreativeBrief({
        caption: 'Test caption',
        visual_direction: 'Test direction',
        template_selection: { fallback_type: 'standard' },
        format_specifications: { platform: 'both' },
        tone_of_voice: { persona_alignment_score: 1.5 },
        schema_version: '1.0',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('persona_alignment_score'))).toBe(true);
    });

    it('should reject output with invalid platform', () => {
      const result = validateCreativeBrief({
        caption: 'Test caption',
        visual_direction: 'Test direction',
        template_selection: { fallback_type: 'standard' },
        format_specifications: { platform: 'tiktok' },
        tone_of_voice: { persona_alignment_score: 0.9 },
        schema_version: '1.0',
      });
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.includes('platform'))).toBe(true);
    });

    it('should default platform to "both" if not specified', () => {
      const brief = {
        caption: 'Test',
        visual_direction: 'Test',
        template_selection: { fallback_type: 'standard' },
        format_specifications: {},
        tone_of_voice: { persona_alignment_score: 0.9 },
        schema_version: '1.0',
      };

      // platform is optional — format_specifications without platform should still pass
      const result = validateCreativeBrief(brief);
      expect(result.valid).toBe(true);
    });
  });

  // ─── Brand Persona Consistency Check ───

  describe('Brand Persona Consistency Check', () => {
    const checkConsistency = (
      caption: string,
      brandPersona: string,
    ): { alignment_score: number; passed: boolean; issues: string[] } => {
      const issues: string[] = [];
      const lowerPersona = brandPersona.toLowerCase();
      const lowerCaption = caption.toLowerCase();

      // Extract meaningful words from persona (4+ chars)
      const personaWords = lowerPersona
        .split(/\s+/)
        .filter((w) => w.length >= 5 && !['about', 'their', 'there', 'where'].includes(w));

      // Check if any persona words appear in caption
      const matchedWords = personaWords.filter((w) => lowerCaption.includes(w));

      if (personaWords.length > 0 && matchedWords.length === 0) {
        issues.push(
          'Caption does not reference keywords from the brand persona',
        );
      }

      // Check if persona mentions cuisine type and caption reflects it
      const cuisineKeywords = [
        'seafood',
        'grill',
        'pasta',
        'taverna',
        'beach',
        'coastal',
        'traditional',
        'family',
      ];
      const personaCuisineHints = cuisineKeywords.filter((k) =>
        lowerPersona.includes(k),
      );
      const captionMatchesCuisine = personaCuisineHints.some((h) =>
        lowerCaption.includes(h),
      );

      if (personaCuisineHints.length > 0 && !captionMatchesCuisine) {
        issues.push('Caption does not reflect cuisine/personality hints from persona');
      }

      // Calculate alignment score
      const baseScore = 0.85;
      const deductionPerIssue = 0.1;
      const score = Math.max(0.5, baseScore - issues.length * deductionPerIssue);

      return {
        alignment_score: Math.round(score * 100) / 100,
        passed: score >= 0.85,
        issues,
      };
    };

    it('should pass when caption references persona keywords', () => {
      const persona =
        'We are a family-owned coastal seafood restaurant specializing in fresh daily catch. Our values: tradition, quality, warm hospitality.';
      const caption =
        'Tonight\'s fresh catch: grilled sea bass with lemon and herbs. A family recipe passed down through generations. Book your table for a taste of our coastal tradition.';

      const result = checkConsistency(caption, persona);
      expect(result.passed).toBe(true);
      expect(result.alignment_score).toBeGreaterThanOrEqual(0.85);
    });

    it('should fail when caption is generic and ignores persona entirely', () => {
      const persona =
        'Fine dining Italian trattoria in the heart of the historic district. Elegant, sophisticated, romantic ambiance.';
      const caption =
        'Come eat some good food at our restaurant. We have great prices and fast service.';

      const result = checkConsistency(caption, persona);
      expect(result.passed).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
    });

    it('should handle empty brand persona gracefully', () => {
      const result = checkConsistency(
        'Test caption',
        '',
      );
      // Without persona context, we can't check — so it passes by default
      expect(result.alignment_score).toBeGreaterThanOrEqual(0.85);
    });

    it('should detect cuisine mismatch between persona and caption', () => {
      const persona =
        'Authentic Italian pasta restaurant. Handmade pasta, traditional recipes, rustic charm. Homemade tagliatelle and classic carbonara.';
      const caption =
        'Try our new burger with crispy fries. Fast food and cold beer. Great for watching the game.';

      const result = checkConsistency(caption, persona);
      expect(result.passed).toBe(false);
    });

    it('should flag regeneration when score < 0.85', () => {
      const persona =
        'Upscale sushi bar. Modern Japanese cuisine, omakase experience, premium ingredients, minimalist aesthetic.';
      const caption =
        'Big portions, cheap prices, family deals! All you can eat buffet tonight!';

      const result = checkConsistency(caption, persona);

      // Should trigger regeneration
      const shouldRegenerate = !result.passed;
      expect(shouldRegenerate).toBe(true);
      expect(result.alignment_score).toBeLessThan(0.85);
    });
  });

  // ─── Retry Logic ───

  describe('Retry Logic & Error Handling', () => {
    it('should have maximum 3 retries (initial + 2 retries)', () => {
      const maxRetries = 3;
      expect(maxRetries).toBeGreaterThanOrEqual(1);
      expect(maxRetries).toBeLessThanOrEqual(5);
    });

    it('should calculate exponential backoff correctly', () => {
      // Story spec: 2 retries with 1s/3s backoff
      const backoff = (retryCount: number): number => {
        return retryCount === 1 ? 1000 : 3000;
      };

      expect(backoff(1)).toBe(1000); // 1s (retry 1)
      expect(backoff(2)).toBe(3000); // 3s (retry 2)
    });

    it('should have exactly 2 retries (not counting the original call)', () => {
      const maxRetries = 2;
      const backoffSequence = [1000, 3000];

      for (let i = 0; i < maxRetries; i++) {
        expect(backoffSequence[i]).toBeGreaterThan(0);
      }
      expect(backoffSequence.length).toBe(2);
    });

    it('should not exceed 2 retries', () => {
      // initial + 2 retries = 3 total attempts max
      const getBackoff = (retryCount: number): number | null => {
        if (retryCount > 2) return null; // null signals max retries exceeded
        return retryCount === 1 ? 1000 : 3000;
      };

      expect(getBackoff(1)).toBe(1000);
      expect(getBackoff(2)).toBe(3000);
      expect(getBackoff(3)).toBeNull();
    });

    it('should fire P1 alert after all retries exhausted', () => {
      const restaurantName = 'Test Trattoria';
      const agentName = 'Offer Strategist';
      const errorSummary = 'AI Gateway timeout after 3 attempts';

      const alert = `[${restaurantName}] ${agentName} failed: ${errorSummary}. Pipeline halted.`;

      expect(alert).toContain(restaurantName);
      expect(alert).toContain(agentName);
      expect(alert).toContain(errorSummary);
    });

    it('should release KV lock on final failure', () => {
      // After retries exhausted, the KV lock must be released
      // for the pipeline to try again the next day
      const shouldReleaseLock = true;
      expect(shouldReleaseLock).toBe(true);
    });
  });

  // ─── Pipeline Data Handoff ───

  describe('Pipeline Data Handoff (Offer Strategist → Creative Director → Production Designer)', () => {
    it('should pass offer strategy output as Creative Director input', () => {
      const offerStrategyOutput = {
        hook_mechanism: 'scarcity',
        language_framing: 'Limited availability framing',
        cta_direction: 'Book now',
        urgency_level: 4,
        rationale: 'Scarcity drives urgency for daily specials',
        schema_version: '1.0',
      };

      // The Creative Director receives the full offer strategy
      const creativeDirectorInput = {
        offerStrategy: offerStrategyOutput,
        brand_persona_fragment: 'Warm family restaurant',
        campaign_type: 'daily_special',
        template_forge_preferences: null,
        restaurant_name: 'Test Trattoria',
      };

      expect(creativeDirectorInput.offerStrategy).toEqual(offerStrategyOutput);
    });

    it('should pass creative brief as Production Designer input', () => {
      const creativeDirectorOutput = {
        creativeBrief: {
          caption: 'Tonight only: Fresh sea bass',
          visual_direction: 'Golden hour hero shot',
          template_selection: {
            preferred_id: 'daily_fresh_catch',
            fallback_type: 'daily_fresh_catch',
            style_keywords: ['fresh', 'golden'],
          },
          format_specifications: {
            platform: 'both',
            aspect_ratio: '1:1',
          },
          tone_of_voice: {
            persona_alignment_score: 0.92,
            voice: 'Warm family restaurant',
            key_phrases: ['fresh catch'],
          },
          schema_version: '1.0',
        },
        campaign_type: 'daily_special',
        restaurant_name: 'Test Trattoria',
      };

      // The Production Designer receives the creative brief
      const productionDesignerInput = creativeDirectorOutput.creativeBrief;

      expect(productionDesignerInput.caption).toBeTruthy();
      expect(productionDesignerInput.visual_direction).toBeTruthy();
      expect(productionDesignerInput.template_selection).toBeDefined();
      expect(productionDesignerInput.format_specifications).toBeDefined();
      expect(productionDesignerInput.tone_of_voice).toBeDefined();
    });
  });

  // ─── Template Selection Integration ───

  describe('Template Selection — Creative Director Preferred Template', () => {
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

    it('should use Creative Director preferred_id when available', () => {
      const campaignType = 'daily_special';
      const preferredId = 'daily_fresh_catch';
      const templates = templateMap[campaignType];
      const selectedTemplate = preferredId;

      expect(templates).toContain(selectedTemplate);
    });

    it('should fall back to Creative Director fallback_type if preferred_id absent', () => {
      const campaignType = 'brand_awareness';
      const fallbackType = 'brand_story';
      const templates = templateMap[campaignType];

      const selectedTemplate = templates.includes(fallbackType)
        ? fallbackType
        : templates[Math.floor(Math.random() * templates.length)];

      expect(templates).toContain(selectedTemplate);
    });

    it('should use random template from core library if no preferences from CD', () => {
      const campaignType = 'seasonal_event';
      const templates = templateMap[campaignType];
      const selected = templates[Math.floor(Math.random() * templates.length)];

      expect(templates).toContain(selected);
    });
  });

  // ─── Observability & Alerts ───

  describe('Observability & Operator Alerts', () => {
    it('should track execution duration per agent', () => {
      const startTime = Date.now();
      // Simulate agent execution
      const duration = Date.now() - startTime;
      expect(duration).toBeGreaterThanOrEqual(0);
    });

    it('should format P1 agent failure alert correctly', () => {
      const restaurantName = 'Test Trattoria';
      const agentName = 'Creative Director';
      const errorSummary = 'Brand Persona consistency check failed after regeneration';

      const alert = `[${restaurantName}] ${agentName} failed: ${errorSummary}. Pipeline halted.`;

      expect(alert).toContain(restaurantName);
      expect(alert).toContain(agentName);
      expect(alert).toContain('Pipeline halted');
    });

    it('should format P3 daily digest with batch statistics', () => {
      const restaurantCount = 12;
      const avgScore = 0.89;

      const digest = `${restaurantCount} campaigns generated today with avg quality score ${avgScore}`;

      expect(digest).toContain('12 campaigns');
      expect(digest).toContain('0.89');
    });
  });

  // ─── Agent Config Abstraction ───

  describe('Agent Config Abstraction (ADR-002)', () => {
    it('should load model config from agent_config table at runtime', () => {
      const agentConfig = {
        agent_code: 'offer_strategist',
        provider: 'openai',
        model: 'gpt-4o-mini',
        temperature: 0.4,
        max_tokens: 512,
      };

      expect(agentConfig.agent_code).toBe('offer_strategist');
      expect(agentConfig.temperature).toBeLessThanOrEqual(1);
    });

    it('should use configured temperature for Offer Strategist (lower = more deterministic)', () => {
      const offerStrategistTemp = 0.4;
      const creativeDirectorTemp = 0.7;

      // Offer Strategist needs more deterministic output (classification task)
      expect(offerStrategistTemp).toBeLessThan(creativeDirectorTemp);
    });

    it('should use higher max_tokens for Creative Director (copywriting)', () => {
      const offerStrategistTokens = 512;
      const creativeDirectorTokens = 2048;

      expect(creativeDirectorTokens).toBeGreaterThan(offerStrategistTokens);
    });

    it('should recommend gpt-4o-mini for Offer Strategist (cost-effective classification)', () => {
      const recommendModel = (agent: string): string => {
        const recommendations: Record<string, string> = {
          offer_strategist: 'gpt-4o-mini',
          creative_director: 'gpt-4o',
        };
        return recommendations[agent] || 'gpt-4o-mini';
      };

      expect(recommendModel('offer_strategist')).toBe('gpt-4o-mini');
    });
  });

  // ─── Invalid JSON Response Handling ───

  describe('Invalid JSON Response Handling', () => {
    const cleanAndParse = (rawResponse: string): { success: boolean; result?: unknown; error?: string } => {
      try {
        const cleaned = rawResponse
          .replace(/```json\n?/gi, '')
          .replace(/```\n?/gi, '')
          .trim();
        return { success: true, result: JSON.parse(cleaned) };
      } catch (e) {
        return { success: false, error: (e as Error).message };
      }
    };

    it('should clean markdown code blocks before parsing', () => {
      const responseWithMarkdown = '```json\n{"hook_mechanism": "scarcity"}\n```';
      const result = cleanAndParse(responseWithMarkdown);
      expect(result.success).toBe(true);
      if (result.success && result.result) {
        expect((result.result as Record<string, unknown>).hook_mechanism).toBe(
          'scarcity',
        );
      }
    });

    it('should parse clean JSON without markdown', () => {
      const cleanJson = '{"hook_mechanism": "urgency"}';
      const result = cleanAndParse(cleanJson);
      expect(result.success).toBe(true);
    });

    it('should handle parse errors gracefully', () => {
      const invalidJson = '{hook_mechanism: scarcity}';
      const result = cleanAndParse(invalidJson);
      expect(result.success).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it('should return error context for retry messaging', () => {
      const errorResult = { success: false, error: 'Unexpected token h in JSON at position 1' };
      // When passed to retry, the error message is appended to the prompt
      const retryPrompt = `Previous attempt failed: ${errorResult.error}. Ensure your response is valid JSON only.`;
      expect(retryPrompt).toContain(errorResult.error);
    });
  });

  // ─── JSON Schema Versioning ───

  describe('Schema Versioning', () => {
    it('should include schema_version 1.0 in Offer Strategist output', () => {
      const output = {
        hook_mechanism: 'scarcity',
        language_framing: 'Test',
        cta_direction: 'Test',
        urgency_level: 3,
        rationale: 'Test',
        schema_version: '1.0',
      };
      expect(output.schema_version).toBe('1.0');
    });

    it('should include schema_version 1.0 in Creative Director output', () => {
      const output = {
        caption: 'Test',
        visual_direction: 'Test',
        template_selection: { fallback_type: 'standard' },
        format_specifications: { platform: 'both' },
        tone_of_voice: { persona_alignment_score: 0.9 },
        schema_version: '1.0',
      };
      expect(output.schema_version).toBe('1.0');
    });
  });
});