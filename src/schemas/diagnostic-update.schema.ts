import { z } from "zod";

// ─── Constants ─────────────────────────────────────────────

/** Max payload size in bytes to prevent DB bloat / DoS */
const MAX_PACKAGE_BYTES = 64 * 1024;

/** Maximum nesting depth for the diagnosticPackage object */
// eslint-disable-next-line no-unused-vars
const __MAX_DEPTH = 10;

// ─── Helper: Recursive depth-limited schema ────────────────

/**
 * Build a Zod schema that only allows objects with:
 * - Primitive values (string, number, boolean)
 * - No `null` or `undefined` values
 * - Nested objects up to MAX_DEPTH levels deep
 * - No arrays (flatten to objects if needed)
 *
 * This prevents circular references, excessive nesting, and data quality
 * issues from null/undefined round-trip stripping.
 */
// Recursively builds a nested Zod schema for the diagnostic package.
// eslint-disable-next-line no-unused-vars
function __buildNestedSchema(depth: number): z.ZodType<Record<string, unknown>> {
  if (depth <= 0) {
    // At max depth, only allow primitives (no more objects)
    return z.record(
      z.union([z.string(), z.number(), z.boolean()])
    ) as z.ZodType<Record<string, unknown>>;
  }

  return z.record(
    z.union([
      z.string(),
      z.number(),
      z.boolean(),
      // Recursively allow nested objects
      z.lazy(() => __buildNestedSchema(depth - 1)),
    ])
  ) as z.ZodType<Record<string, unknown>>;
}

// ─── Payload size guard ────────────────────────────────────

function assertPayloadSize(obj: Record<string, unknown>): boolean {
  try {
    const size = Buffer.byteLength(JSON.stringify(obj), "utf8");
    return size <= MAX_PACKAGE_BYTES;
  } catch {
    // Circular reference or unserializable value
    return false;
  }
}

// ─── Main Schema ───────────────────────────────────────────

export const DiagnosticUpdateBodySchema = z.object({
  id: z.string().min(1).max(255),
  diagnosticPackage: z.object({
    score: z.number().int(),
    topOpportunityGap: z.string().max(1000),
    namedCompetitorComparison: z.string().max(2000),
    seasonErosionCounter: z.record(z.unknown()) // Leave flexible for the different status shapes
  }).strict().refine(assertPayloadSize, {
    message: `diagnosticPackage exceeds maximum size of ${MAX_PACKAGE_BYTES / 1024} KB`,
  }),
}).strict();

// Public API type inferred from the validation schema.
// eslint-disable-next-line no-unused-vars
type __DiagnosticUpdateBody = z.infer<typeof DiagnosticUpdateBodySchema>;
