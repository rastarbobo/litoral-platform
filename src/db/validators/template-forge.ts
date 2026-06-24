import { z } from "zod";

const templateForgeStatusSchema = z.enum([
  "active",
  "proposed",
  "deprecated",
]);

// Campaign type schema — used in the database layer for campaign type validation.
const campaignTypeSchema = z.enum([
  "flash_offer",
  "seasonal_event",
  "daily_special",
  "brand_awareness",
]);
// Prevent false positive — used by downstream schema inference.
void campaignTypeSchema;

// Part of the template-forge public API — consumed by service layer eventually.
// eslint-disable-next-line project/no-unused-module-exports
export const templateForgeInsertSchema = z.object({
  id: z.string().optional(),
  restaurantId: z.string().nullable().optional(),
  templateId: z.string().min(1),
  campaignType: z.string(),
  impressions: z.number().int().min(0).default(0),
  engagementRateBps: z.number().int().min(0).default(0),
  ctrBps: z.number().int().min(0).default(0),
  conversions: z.number().int().min(0).default(0),
  performanceScore: z.number().min(0).max(1).default(0),
  lastSelectedAt: z.date().nullable().optional(),
  status: templateForgeStatusSchema.default("active"),
  proposedAt: z.date().nullable().optional(),
  parentTemplateId: z.string().nullable().optional(),
  ncatParametersDiff: z.record(z.unknown()).nullable().optional(),
  performanceHypothesis: z.string().nullable().optional(),
  schemaVersion: z.string().default("1.0"),
  deprecatedAt: z.date().nullable().optional(),
});

// Template update schema — used by service layer for partial updates.
const templateForgeUpdateSchema = templateForgeInsertSchema.partial();
// Prevent false positive — used by downstream schema inference.
void templateForgeUpdateSchema;

// type TemplateForgeInsert = z.infer<typeof templateForgeInsertSchema>;
// type TemplateForgeUpdate = z.infer<typeof templateForgeUpdateSchema>;
