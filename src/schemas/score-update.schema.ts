import { z } from "zod";

// ─── Score Band Domain ─────────────────────────────────────
const SCORE_BAND = {
  A: "A",
  B: "B",
  C: "C",
  D: "D",
  EXCELLENT: "Excellent",
  NEEDS_WORK: "Needs Work",
} as const;

const scoreBandTuple = Object.values(SCORE_BAND) as [string, ...string[]];

// ─── Schema ────────────────────────────────────────────────

/**
 * Shared schema for score-update endpoint.
 * Used by both the route handler and n8n workflow validation.
 */
export const ScoreUpdateBodySchema = z.object({
  id: z.string().min(1),
  marketingReadinessScore: z.number().int().min(0).max(100),
  scoreBand: z.enum(scoreBandTuple),
  primaryGapExplanation: z.string().min(1).max(2000),
}).strict();

// type ScoreUpdateBody = z.infer<typeof ScoreUpdateBodySchema>;