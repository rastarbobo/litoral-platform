import { z } from "zod";

export const MAX_SAAS_PER_AREA = 2;
export const MAX_AGENCY_PER_AREA = 1;

export const SCARCITY_ERROR_MESSAGE = (cuisine: string, area: string) =>
  `Sorry, the One Per Town limit has been reached for ${cuisine} cuisine in ${area}. ` +
  `Only ${MAX_SAAS_PER_AREA} SaaS and ${MAX_AGENCY_PER_AREA} Agency clients per town are accepted ` +
  `to maintain our exclusivity promise.`;

/** Zod schema for the public scarcity check query parameters */
export const ScarcityCheckParamsSchema = z.object({
  cuisineType: z.string().trim().min(1).max(100),
  locationArea: z.string().trim().min(1).max(255),
});

type __ScarcityCheckParams = z.infer<typeof ScarcityCheckParamsSchema>;

/** Zod schema for the enrollment request body */
export const EnrollmentRequestSchema = z.object({
  restaurantId: z.string().regex(/^rest_[a-zA-Z0-9]+$/),
  tier: z.enum(["saas", "agency"]),
});

type __EnrollmentRequest = z.infer<typeof EnrollmentRequestSchema>;

/** Scarcity state for the landing page */
interface __ScarcityState {
  saasCount: number;
  agencyCount: number;
  maxSaas: number;
  maxAgency: number;
  isAvailable: boolean;
}