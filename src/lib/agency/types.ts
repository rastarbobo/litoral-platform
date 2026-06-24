import { z } from "zod";

/** Maximum number of Agency Tier clients globally (FR-8.1) */
export const MAX_AGENCY_GLOBAL = 20;

/** Human-readable capacity error message */
export const AGENCY_CAPACITY_MESSAGE =
  "The Agency Tier is currently at capacity (20 clients). " +
  "Please contact the founder for availability.";

/** Zod schema for the agency enrollment request body */
export const AgencyEnrollmentSchema = z.object({
  restaurantId: z.string().regex(/^rest_[a-zA-Z0-9]+$/),
});

// type AgencyEnrollment = z.infer<typeof AgencyEnrollmentSchema>;

// Agency capacity state reserved for future capacity endpoints.
// interface AgencyCapacityState {
//   agencyCount: number;
//   maxAgency: number;
//   isAvailable: boolean;
// }