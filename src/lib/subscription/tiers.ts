/**
 * Subscription tier definitions for the Litoral Agency platform.
 *
 * Mirrors the Stripe product structure. Tier keys correspond to
 * `subscription_tier` values stored in D1.
 */

export interface SubscriptionTier {
  key: string;
  name: string;
  price: string;
  features: string[];
}

export const SUBSCRIPTION_TIERS: SubscriptionTier[] = [
  {
    key: "starter",
    name: "Starter",
    price: "$199/mo",
    features: [
      "1 autonomous campaign/day",
      "Telegram approval & revisions",
      "Basic Results Dashboard",
      "Chrome Extension publishing",
    ],
  },
  {
    key: "pro",
    name: "Pro",
    price: "$349/mo",
    features: [
      "2 autonomous campaigns/day",
      "Owner-initiated campaigns (photos, voice notes)",
      "Full Results Dashboard with ROI tracking",
      "Season comparison view",
      "Priority Chrome Extension support",
    ],
  },
  {
    key: "annual_pro",
    name: "Annual Pro",
    price: "$3,499/yr",
    features: [
      "Everything in Pro",
      "Free Hibernate months (Nov–Feb)",
      "Pre-Season Booking Engine",
      "Local SEO Guardian",
      "Dedicated operator support",
    ],
  },
];

/** Tier key → display name lookup */
export const TIER_LABELS: Record<string, string> = Object.fromEntries(
  SUBSCRIPTION_TIERS.map((t) => [t.key, t.name]),
);

/** Ordered tier hierarchy for upgrade/downgrade logic */
export const TIER_ORDER = ["starter", "pro", "annual_pro"] as const;

/**
 * Determine if `targetTier` is an upgrade from `currentTier`.
 * Returns false if tiers are equal or if current is higher.
 */
export function isUpgrade(
  currentTier: string | null,
  targetTier: string,
): boolean {
  if (!currentTier) return true;
  const currentIdx = TIER_ORDER.indexOf(currentTier as (typeof TIER_ORDER)[number]);
  const targetIdx = TIER_ORDER.indexOf(targetTier as (typeof TIER_ORDER)[number]);
  if (currentIdx === -1 || targetIdx === -1) return false;
  return targetIdx > currentIdx;
}