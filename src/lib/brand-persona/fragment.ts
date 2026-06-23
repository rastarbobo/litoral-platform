import type { BrandPersonaFull, BrandPersonaFragment } from "./types";

/**
 * Approximate token count: 1 token ≈ 4 characters for English text.
 * This is a heuristic; actual token counts vary by model/tokenizer.
 */
function countTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Truncate text to fit within a maximum token budget.
 * Preserves whole words at the boundary (no mid-word cuts).
 */
function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  // Cut at maxChars, then rewind to last word boundary
  const cut = text.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(" ");
  if (lastSpace > maxChars * 0.5) {
    return cut.slice(0, lastSpace) + "…";
  }
  return cut.replace(/\s+\S*$/, "") + "…";
}

/**
 * Field extraction config: key in the full persona doc, max token budget per field.
 * Order matters — fields later in the array may be truncated more aggressively
 * to stay within the total 500 token budget.
 */
const FRAGMENT_FIELDS: Array<{
  key: keyof Pick<
    BrandPersonaFull,
    "voice" | "cuisine_philosophy" | "neighborhood_character" | "values"
  >;
  maxTokens: number;
}> = [
  { key: "voice", maxTokens: 50 },
  { key: "cuisine_philosophy", maxTokens: 100 },
  { key: "neighborhood_character", maxTokens: 50 },
  { key: "values", maxTokens: 100 },
];

const FRAGMENT_TOKEN_LIMIT = 500;

/**
 * Generate a condensed fragment (≤ 500 tokens) from the full Brand Persona document.
 *
 * The fragment is what gets injected into every AI agent call (Offer Strategist,
 * Creative Director, etc.). It preserves the essence of the brand voice and values
 * while staying within token budget.
 *
 * @param full - The complete Brand Persona document from R2.
 * @returns A BrandPersonaFragment ready for D1 storage.
 */
export function generateFragment(
  full: BrandPersonaFull,
): BrandPersonaFragment {
  const fragment: Record<string, unknown> = { v: 1 };
  let totalTokens = 0;

  for (const { key, maxTokens } of FRAGMENT_FIELDS) {
    const remainingBudget = FRAGMENT_TOKEN_LIMIT - totalTokens;
    if (remainingBudget <= 0) break;

    const value = (full as Record<string, unknown>)[key];
    const textValue = typeof value === "string" ? value : "";

    if (textValue.length === 0) {
      fragment[key] = "";
      continue;
    }

    const tokenBudget = Math.min(maxTokens, remainingBudget);
    const truncated = truncateToTokens(textValue, tokenBudget);
    fragment[key] = truncated;
    totalTokens += countTokens(truncated);
  }

  // target_customer is an array, not a string field
  fragment.target_customer = Array.isArray(full.target_customer)
    ? full.target_customer.slice(0, 5) // max 5 segments
    : [];

  const result: BrandPersonaFragment = {
    v: 1,
    voice: fragment.voice as string,
    cuisine_philosophy: fragment.cuisine_philosophy as string,
    target_customer: fragment.target_customer as string[],
    neighborhood_character: fragment.neighborhood_character as string,
    values: fragment.values as string,
    _total_tokens: totalTokens + countTokens(JSON.stringify(fragment.target_customer)),
  };

  return result;
}

/**
 * Build a full Brand Persona document from the onboarding wizard input.
 * Timestamps in ISO 8601 UTC.
 *
 * @param input - Raw form data from the 5-step wizard.
 * @param slug - The restaurant slug.
 * @param mode - "onboarding-wizard" or "dashboard-editor".
 * @param existingCreatedAt - If updating an existing persona, preserve the original created_at.
 */
export function buildFullPersona(
  input: {
    cuisinePhilosophy: string;
    voice: string;
    targetCustomer: string[];
    neighborhoodCharacter: string;
    values: string;
  },
  slug: string,
  mode: "onboarding-wizard" | "dashboard-editor",
  existingCreatedAt?: string,
): BrandPersonaFull {
  const now = new Date().toISOString();

  return {
    version: 1,
    created_at: existingCreatedAt ?? now,
    updated_at: now,
    cuisine_philosophy: input.cuisinePhilosophy,
    voice: input.voice,
    target_customer: input.targetCustomer,
    neighborhood_character: input.neighborhoodCharacter,
    values: input.values,
    metadata: {
      generated_by: mode,
      restaurant_slug: slug,
    },
  };
}

/**
 * Try to parse a pre-filled form value from a D1 fragment JSON string.
 * Returns partial input if fragment exists, or null if no fragment.
 */
export function parseFragmentForPreFill(
  fragmentJson: string | null | undefined,
): Partial<{
  cuisinePhilosophy: string;
  voice: string;
  targetCustomer: string[];
  neighborhoodCharacter: string;
  values: string;
}> | null {
  if (!fragmentJson) return null;

  try {
    const parsed = JSON.parse(fragmentJson);
    return {
      cuisinePhilosophy: parsed.cuisine_philosophy ?? "",
      voice: parsed.voice ?? "",
      targetCustomer: parsed.target_customer ?? [],
      neighborhoodCharacter: parsed.neighborhood_character ?? "",
      values: parsed.values ?? "",
    };
  } catch {
    return null;
  }
}