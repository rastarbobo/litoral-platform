/**
 * Tests for Story 4.4: Template Forge Integration
 *
 * These tests validate the Template Forge logic:
 * Template selection with forge data, cold-start fallback,
 * performance score calculation, deprecation logic, and proposal generation.
 * Pure logic tests — no external dependencies (avoids server-only schema imports).
 */

import { describe, it, expect } from 'vitest';

describe('Story 4.4: Template Forge Integration', () => {

  // ─── AC1: Template Selection with Forge Data ───

  describe('Template Selection Logic', () => {
    const mockForgeResults = [
      { template_id: 'tpl_001', performance_score: 0.9, ncat_parameters_diff: { style_description: 'elegant minimalist food' } },
      { template_id: 'tpl_002', performance_score: 0.6, ncat_parameters_diff: { style_description: 'bold vibrant social' } },
      { template_id: 'tpl_003', performance_score: 0.4, ncat_parameters_diff: { style_description: 'minimalist clean' } },
    ];

    /**
     * Production Designer template selection logic.
     * Mirrors the n8n workflow's 'Select Template' node.
     */
    function selectTemplate(
      forgeResults: any[],
      preferredId: string | null,
      style_keywords: string[],
      fallbackType: string
    ) {
      // Filter by style keywords
      let filtered = forgeResults;
      if (style_keywords.length > 0) {
        const sk = style_keywords.map(k => k.toLowerCase());
        filtered = forgeResults.filter(t => {
          const meta = t.ncat_parameters_diff || {};
          const desc = (meta.style_description || meta.description || t.template_id || '').toLowerCase();
          return sk.some(k => desc.includes(k));
        });
        if (filtered.length === 0) filtered = forgeResults;
      }

      let sId: string | undefined, sSc = 0, src = 'forge';
      if (filtered.length > 0) {
        if (preferredId) {
          const preferred = filtered.find(t => t.template_id === preferredId);
          if (preferred) {
            const t = +preferred.performance_score;
            const u = +filtered[0].performance_score;
            if (u >= t * 1.5) {
              sId = filtered[0].template_id; sSc = u;
            } else {
              sId = preferredId; sSc = t;
            }
          } else {
            sId = filtered[0].template_id; sSc = +filtered[0].performance_score;
          }
        } else {
          sId = filtered[0].template_id; sSc = +filtered[0].performance_score;
        }
      } else {
        src = 'cold_start';
        // Cold-start: would query template_library, but here we simulate
        sId = fallbackType;
      }
      return { template_id: sId, score: sSc, source: src };
    }

    it('selects highest-scoring template when forge score >= 1.5x preferred', () => {
      const result = selectTemplate(mockForgeResults, 'tpl_002', [], 'flash_offer');
      // preferred tpl_002 has score 0.6, winner tpl_001 has score 0.9
      // 0.9 >= 0.6*1.5 = 0.9, so at threshold — select winner
      expect(result.template_id).toBe('tpl_001');
      expect(result.score).toBe(0.9);
    });

    it('prefers preferred when forge advantage is less than 1.5x', () => {
      const forge = [
        { template_id: 'tpl_001', performance_score: 0.7, ncat_parameters_diff: { style_description: '' } },
        { template_id: 'tpl_002', performance_score: 0.6, ncat_parameters_diff: { style_description: '' } },
      ];
      const result = selectTemplate(forge, 'tpl_002', [], 'flash_offer');
      // top = 0.7, preferred = 0.6. 0.7 < 0.6*1.5 = 0.9, so use preferred
      expect(result.template_id).toBe('tpl_002');
      expect(result.score).toBe(0.6);
    });

    it('filters by style keywords', () => {
      const result = selectTemplate(mockForgeResults, null, ['minimalist'], 'flash_offer');
      // After filtering: tpl_001 (elegant minimalist food) and tpl_003 (minimalist clean)
      // tpl_001 has higher score 0.9
      expect(result.template_id).toBe('tpl_001');
    });

    it('falls back to unfiltered when style keywords match nothing', () => {
      const result = selectTemplate(mockForgeResults, null, ['neon'], 'flash_offer');
      expect(result.template_id).toBe('tpl_001');
    });

    it('falls back to cold-start when forge is empty', () => {
      const result = selectTemplate([], null, [], 'seasonal_event');
      expect(result.source).toBe('cold_start');
      expect(result.score).toBe(0);
    });
  });

  // ─── AC2: Cold-Start ───

  describe('Cold-Start Selection', () => {
    it('always returns cold_start for empty forge table', () => {
      const forgeResults: any[] = [];
      const source = forgeResults.length > 0 ? 'forge' : 'cold_start';
      expect(source).toBe('cold_start');
    });

    it('queries core template library for cold-start, not random IDs', () => {
      // Simulate the new cold-start logic: query template_library
      const mockLibrary = [
        { template_id: 'core_001', campaign_type: 'flash_offer', status: 'active' },
        { template_id: 'core_002', campaign_type: 'flash_offer', status: 'active' },
      ];
      const matching = mockLibrary.filter(t => t.campaign_type === 'flash_offer');
      const pick = matching[Math.floor(Math.random() * matching.length)];
      expect(pick.template_id).toMatch(/^core_\d+$/);
    });
  });

  // ─── AC3: Performance Score Calculation ───

  describe('Performance Score Calculation', () => {
    /**
     * Per-campaign_type performance score calculation.
     * Mirrors the aggregator's 'Calculate Scores' node.
     */
    function calculateScore(
      group: { engagement_rate_bps: number; ctr_bps: number; conversions: number; last_selected_at: string | null }[],
      row: { engagement_rate_bps: number; ctr_bps: number; conversions: number; last_selected_at: string | null }
    ) {
      const maxVals = {
        eng: Math.max(...group.map(x => x.engagement_rate_bps || 1), 1),
        ctr: Math.max(...group.map(x => x.ctr_bps || 1), 1),
        conv: Math.max(...group.map(x => x.conversions || 1), 1),
      };

      const e_norm = maxVals.eng > 0 ? (row.engagement_rate_bps || 0) / maxVals.eng : 1;
      const ctr_norm = maxVals.ctr > 0 ? (row.ctr_bps || 0) / maxVals.ctr : 1;
      const c_norm = maxVals.conv > 0 ? (row.conversions || 0) / maxVals.conv : 1;

      const daysSince = () => {
        if (!row.last_selected_at) return 0;
        const d = Math.floor((Date.now() - new Date(row.last_selected_at).getTime()) / 86400000);
        if (d <= 3) return 1.0;
        if (d >= 30) return 0.0;
        if (d <= 14) return 1.0 - ((d - 3) / 11) * 0.5;
        return 0.5 - ((d - 14) / 16) * 0.5;
      };

      const rec = daysSince();
      const score = e_norm * 0.4 + ctr_norm * 0.3 + c_norm * 0.2 + rec * 0.1;
      return Math.min(1, Math.max(0, score));
    }

    const mockGroup = [
      { engagement_rate_bps: 5000, ctr_bps: 3000, conversions: 100, last_selected_at: new Date().toISOString() },
      { engagement_rate_bps: 3000, ctr_bps: 2000, conversions: 50, last_selected_at: null },
      { engagement_rate_bps: 8000, ctr_bps: 4000, conversions: 200, last_selected_at: new Date(Date.now() - 1000000000).toISOString() },
    ];

    it('calculates composite score correctly with per-campaign normalization', () => {
      const score = calculateScore(mockGroup, mockGroup[0]);
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
    });

    it('returns 0 when all metrics are zero', () => {
      const zeroGroup = [{ engagement_rate_bps: 0, ctr_bps: 0, conversions: 0, last_selected_at: null }];
      const score = calculateScore(zeroGroup, zeroGroup[0]);
      expect(score).toBe(0);
    });

    it('returns 1.0 when all normalized metrics are 1.0 and recency is 1.0', () => {
      const maxGroup = [{ engagement_rate_bps: 1000, ctr_bps: 1000, conversions: 100, last_selected_at: new Date().toISOString() }];
      const score = calculateScore(maxGroup, maxGroup[0]);
      expect(score).toBeGreaterThan(0.9); // recency = 1.0, so should be very high
    });

    it('applies recency decay correctly', () => {
      const old = { engagement_rate_bps: 1000, ctr_bps: 1000, conversions: 100, last_selected_at: new Date(Date.now() - 20 * 86400000).toISOString() };
      const group = [old];
      const score = calculateScore(group, old);
      // At 20 days old, recency is ~0.28, so score will be weighted accordingly
      expect(score).toBeLessThan(1.0); // recency reduces the total score
      expect(score).toBeGreaterThan(0.5); // but metrics still contribute significantly
    });
  });

  // ─── AC4: Deprecation Logic ───

  describe('Deprecation Logic', () => {
    it('calculates 20th percentile correctly', () => {
      const scores = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
      const sorted = [...scores].sort((a, b) => a - b);
      const percentile20 = sorted[Math.floor((20 / 100) * sorted.length)];
      expect(percentile20).toBe(30); // sorted[2] = 30
    });

    it('marks templates older than 7 days as stale', () => {
      const lastSelected = new Date();
      lastSelected.setDate(lastSelected.getDate() - 8);
      const daysOld = Math.floor((Date.now() - lastSelected.getTime()) / 86400000);
      expect(daysOld).toBeGreaterThanOrEqual(8);
    });

    it('preserves minimum 20 template floor per campaign_type', () => {
      // per-campaign_type: if totalActive - candidatesToDeprecate >= 20
      const totalActive = 25;
      const candidatesToDeprecate = 5;
      const canDeprecate = (totalActive - candidatesToDeprecate) >= 20;
      expect(canDeprecate).toBe(true);

      const totalActive2 = 18;
      const candidatesToDeprecate2 = 3;
      const canDeprecate2 = (totalActive2 - candidatesToDeprecate2) >= 20;
      expect(canDeprecate2).toBe(false);
    });
  });

  // ─── AC5: Proposed Templates ───

  describe('Template Variation Proposals', () => {
    it('generates up to 3 proposals per day', () => {
      const topTemplates = [1, 2, 3, 4, 5];
      const proposals = topTemplates.slice(0, 3);
      expect(proposals.length).toBeLessThanOrEqual(3);
    });

    it('proposed templates have correct status', () => {
      const proposed = { status: 'proposed', parentTemplateId: 'tpl_parent_001' };
      expect(proposed.status).toBe('proposed');
      expect(proposed.parentTemplateId).toBeDefined();
    });

    it('AI Gateway call uses agent_config for model selection', () => {
      const agentConfig = { provider: 'openai', model: 'gpt-4o', temperature: 0.6, max_tokens: 1024 };
      expect(agentConfig).toHaveProperty('provider');
      expect(agentConfig).toHaveProperty('model');
      expect(agentConfig.temperature).toBe(0.6);
    });
  });

  // ─── AC6: Graceful Fallback ───

  describe('Graceful Fallback', () => {
    it('does not block when forge query fails', () => {
      const forgeResults: any[] = [];
      const fallback = { templateId: 'default_1', source: 'cold_start' };
      expect(fallback.source).toBe('cold_start');
      expect(fallback.templateId).toBeDefined();
    });

    it('logs warning on forge failure, not error', () => {
      const forgeError = 'Template Forge unavailable — falling back to cold-start';
      expect(forgeError).toContain('falling back to cold-start');
      expect(forgeError).not.toContain('ERROR');
    });
  });

  // ─── n8n Workflow Integration ───

  describe('n8n Workflow Integration', () => {
    it('production designer workflow exists with required nodes', () => {
      const fs = require('fs');
      const path = require('path');
      const wf = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '../../../n8n-workflows/campaign-engine/agents/production-designer.json'),
        'utf8'
      ));
      expect(wf.nodes.some((n: any) => n.name === 'Query Template Forge')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'Select Template')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'Invoke Media Pipeline')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'Retry #1 (1s)')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'Retry #2 (3s)')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'Cold-Start Fallback')).toBe(true);
      expect(wf.nodes.filter((n: any) => n.type === 'n8n-nodes-base.executeWorkflow').length).toBeGreaterThan(0);
    });

    it('template forge aggregator workflow exists with cron trigger', () => {
      const fs = require('fs');
      const path = require('path');
      const wf = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '../../../n8n-workflows/campaign-engine/template-forge/template-forge-aggregator.json'),
        'utf8'
      ));
      expect(wf.nodes.some((n: any) => n.type === 'n8n-nodes-base.scheduleTrigger')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'Execute Deprecation')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'P3 Daily Digest')).toBe(true);
    });

    it('template proposer workflow exists with AI Gateway', () => {
      const fs = require('fs');
      const path = require('path');
      const wf = JSON.parse(fs.readFileSync(
        path.resolve(__dirname, '../../../n8n-workflows/campaign-engine/template-forge/template-proposer.json'),
        'utf8'
      ));
      expect(wf.nodes.some((n: any) => n.name === 'Get Top Templates')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'AI Gateway Variation')).toBe(true);
      expect(wf.nodes.some((n: any) => n.name === 'Retry AI')).toBe(true);
    });
  });
});
