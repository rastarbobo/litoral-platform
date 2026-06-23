import "server-only";
import { z } from "zod";

/** Stripe Price IDs for subscription tiers — sourced from environment variables. */
export const SUBSCRIPTION_PRICE_IDS: Record<string, string> = {
  starter: process.env.STRIPE_PRICE_STARTER ?? "",
  pro: process.env.STRIPE_PRICE_PRO ?? "",
  annual_pro: process.env.STRIPE_PRICE_ANNUAL_PRO ?? "",
};

/** Valid subscription tier values. */
export const SUBSCRIPTION_TIERS = ["starter", "pro", "annual_pro"] as const;

/** Zod schema for create-session route body validation. */
export const CreateCheckoutSessionSchema = z.object({
  restaurantId: z.string().min(1, "restaurantId is required").max(100),
  tier: z.enum(SUBSCRIPTION_TIERS, {
    errorMap: () => ({ message: "tier must be starter, pro, or annual_pro" }),
  }),
});

export type CreateCheckoutSessionInput = z.infer<typeof CreateCheckoutSessionSchema>;