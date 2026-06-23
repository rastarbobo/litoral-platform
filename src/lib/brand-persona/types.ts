import { z } from "zod";

// ─── Onboarding Input ──────────────────────────────────────

/** Raw input from the 5-step brand persona wizard */
// oxlint-disable-next-line project/no-unused-module-exports -- Schema export used via Zod inference; type export is the public contract
export const BrandPersonaInputSchema = z.object({
  cuisinePhilosophy: z.string().trim().max(500).default(""),
  voice: z.string().trim().max(100).default(""),
  targetCustomer: z.array(z.string().trim()).default([]),
  neighborhoodCharacter: z.string().trim().max(200).default(""),
  values: z.string().trim().max(500).default(""),
});

// oxlint-disable-next-line project/no-unused-module-exports -- Type export is the public API contract
export type BrandPersonaInput = z.infer<typeof BrandPersonaInputSchema>;

// ─── Full Persona Document (stored in R2) ──────────────────

export const VOICE_PRESETS = [
  "Warm & Welcoming",
  "Bold & Passionate",
  "Elegant & Refined",
  "Rustic & Authentic",
] as const;

export type VoicePreset = (typeof VOICE_PRESETS)[number];

// oxlint-disable-next-line project/no-unused-module-exports -- Schema export used via Zod inference
export const BrandPersonaFullSchema = z.object({
  version: z.literal(1),
  created_at: z.string(),
  updated_at: z.string(),
  cuisine_philosophy: z.string(),
  voice: z.string(),
  target_customer: z.array(z.string()),
  neighborhood_character: z.string(),
  values: z.string(),
  metadata: z.object({
    generated_by: z.enum(["onboarding-wizard", "dashboard-editor"]),
    restaurant_slug: z.string(),
  }),
});

export type BrandPersonaFull = z.infer<typeof BrandPersonaFullSchema>;

// ─── Fragment (≤500 tokens, stored in D1) ──────────────────

// oxlint-disable-next-line project/no-unused-module-exports -- Schema export used via Zod inference
export const BrandPersonaFragmentSchema = z.object({
  v: z.literal(1),
  voice: z.string().max(200),
  cuisine_philosophy: z.string().max(400),
  target_customer: z.array(z.string()),
  neighborhood_character: z.string().max(200),
  values: z.string().max(400),
  _total_tokens: z.number().int().max(500),
});

export type BrandPersonaFragment = z.infer<typeof BrandPersonaFragmentSchema>;

// ─── Dashboard Editor Input ────────────────────────────────

export const BrandPersonaEditSchema = BrandPersonaInputSchema;

// oxlint-disable-next-line project/no-unused-module-exports -- Type alias used as a semantic re-export for clarity
export type BrandPersonaEdit = BrandPersonaInput;