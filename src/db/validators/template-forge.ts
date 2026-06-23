import { z } from "zod";

export const templateForgeStatusSchema = z.enum([
  "active",
  "proposed",
  "deprecated",
]);

export const campaignTypeSchema = z.enum([
  "flash_offer",
  "seasonal_event",
  "daily_special",
  "brand_awareness",
]);

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

export const templateForgeUpdateSchema = templateForgeInsertSchema.partial();

export type TemplateForgeInsert = z.infer<typeof templateForgeInsertSchema>;
export type TemplateForgeUpdate = z.infer<typeof templateForgeUpdateSchema>;
