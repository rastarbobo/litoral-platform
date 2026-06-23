import "server-only";

import { getCloudflareContext } from "@/utils/cloudflare-context";
import type { BrandPersonaFull } from "./types";

/** R2 path prefix for client brand assets */
const CLIENTS_PREFIX = "clients";

/**
 * Build the R2 key for a restaurant's brand persona document.
 * Path convention: /clients/{slug}/brand/persona.json
 */
export function getBrandPersonaR2Key(slug: string): string {
  return `${CLIENTS_PREFIX}/${slug}/brand/persona.json`;
}

/**
 * Save the full Brand Persona document to R2.
 * Overwrites existing content (idempotent).
 *
 * @param slug - Restaurant slug
 * @param full - Complete Brand Persona document
 * @returns The R2 key on success, or an error message
 */
export async function saveBrandPersonaToR2(
  slug: string,
  full: BrandPersonaFull,
): Promise<{ key: string } | { error: string }> {
  const key = getBrandPersonaR2Key(slug);

  try {
    const { env } = await getCloudflareContext();

    if (!env.NEXT_INC_CACHE_R2_BUCKET) {
      return { error: "R2 bucket not configured" };
    }

    const body = JSON.stringify(full, null, 2);

    await env.NEXT_INC_CACHE_R2_BUCKET.put(key, body, {
      httpMetadata: {
        contentType: "application/json",
        cacheControl: "no-cache",
      },
    });

    return { key };
  } catch (err) {
    console.error("saveBrandPersonaToR2: R2 put failed", { error: err, slug, key });
    return { error: err instanceof Error ? err.message : "Unknown R2 error" };
  }
}

/**
 * Load the full Brand Persona document from R2.
 *
 * @param r2Key - The R2 key stored in D1 `brand_persona_r2_key`
 * @returns The parsed persona document, or null if not found
 */
export async function loadBrandPersonaFromR2(
  r2Key: string | null | undefined,
): Promise<BrandPersonaFull | null> {
  if (!r2Key) return null;

  try {
    const { env } = await getCloudflareContext();

    if (!env.NEXT_INC_CACHE_R2_BUCKET) {
      console.warn("loadBrandPersonaFromR2: R2 bucket not configured");
      return null;
    }

    const object = await env.NEXT_INC_CACHE_R2_BUCKET.get(r2Key);

    if (!object) {
      return null;
    }

    const text = await object.text();
    return JSON.parse(text) as BrandPersonaFull;
  } catch (err) {
    console.error("loadBrandPersonaFromR2: R2 get failed", { error: err, r2Key });
    return null;
  }
}