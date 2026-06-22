/**
 * R2 Asset URL generation — shared utility.
 *
 * Campaign assets are stored in the NEXT_INC_CACHE_R2_BUCKET.
 * For production, configure the R2 bucket with a public custom domain
 * (e.g., cdn.litoral.agency). For development, assets are served through
 * the /api/cms-images proxy route.
 *
 * When upgrading to S3-compatible presigned URLs (via
 * @aws-sdk/client-s3 + @aws-sdk/s3-request-presigner), this function
 * will become truly async. The async signature is intentional to avoid
 * breaking callers when that happens.
 *
 * @param key       R2 object key (e.g., "campaigns/photo.jpg")
 * @param expiryHours Expiry duration in hours for public URLs (default 24).
 *                     Used by presigned URL generation in the future.
 */
export async function getR2AssetUrl(key: string, expiryHours: number = 24): Promise<string> {
  // TODO: Read from env variable when available (e.g., NEXT_PUBLIC_R2_PUBLIC_DOMAIN)
  // For now, use a proxy route that streams directly from R2
  void expiryHours; // Placeholder — used when presigned URLs are implemented
  return `/api/cms-images/campaigns/${key}`;
}