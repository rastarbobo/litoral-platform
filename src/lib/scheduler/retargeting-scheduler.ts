import { restaurantRepo } from "@/db/repositories/restaurant-repository";

/**
 * Compute the MM-DD string 4 weeks from now using UTC to avoid timezone drift
 * on Cloudflare Workers (which run in UTC).
 */
function getTargetSeasonStart(now: Date): string {
  const targetDate = new Date(now.getTime() + 4 * 7 * 24 * 60 * 60 * 1000);
  const month = String(targetDate.getUTCMonth() + 1).padStart(2, '0');
  const day = String(targetDate.getUTCDate()).padStart(2, '0');
  return `${month}-${day}`;
}

export async function processSeasonProximityTriggers(env: Record<string, unknown>, now: Date = new Date()): Promise<number> {
  // We want to trigger 4 weeks before the peak season (using UTC).
  const targetSeasonStart = getTargetSeasonStart(now);

  const { data: prospects, error } = await restaurantRepo.getRetargetingProspectsForSeason(targetSeasonStart);

  if (error) {
    console.error("processSeasonProximityTriggers: query failed", { error, targetSeasonStart });
    return -1; // Signal failure to caller
  }

  if (prospects.length === 0) {
    console.log("processSeasonProximityTriggers: no matching prospects", { targetSeasonStart });
    return 0;
  }

  // Fire webhooks concurrently and track failures
  const results = await Promise.allSettled(
    prospects.map(async (prospect) => {
      // Log the retargeting event first for idempotency
      await restaurantRepo.logRetargetingEvent(prospect.id, "retarget_season");

      if (env.N8N_WEBHOOK_RETARGETING_URL) {
        const response = await fetch(env.N8N_WEBHOOK_RETARGETING_URL as string, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prospectId: prospect.id,
            trigger: "retarget_season",
            seasonStart: targetSeasonStart,
          }),
        });
        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}`);
        }
      }
    })
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  const succeeded = results.filter(r => r.status === 'fulfilled').length;

  if (failed > 0) {
    console.error(`processSeasonProximityTriggers: ${failed}/${results.length} webhooks failed`, { targetSeasonStart });
  }

  return succeeded;
}

export async function processCompetitorSignup(env: Record<string, unknown>, competitorId: string): Promise<number> {
  const competitor = await restaurantRepo.findById(competitorId);

  if (!competitor || !competitor.cuisineType?.trim() || !competitor.locationArea?.trim()) {
    console.warn(`Competitor signup missing cuisine/location or not found: ${competitorId}`);
    return 0;
  }

  const { data: prospects, error } = await restaurantRepo.getRetargetingProspectsForCompetitor(
    competitor.cuisineType,
    competitor.locationArea,
    competitor.id
  );

  if (error) {
    console.error("processCompetitorSignup: query failed", { error, competitorId });
    return -1;
  }

  if (prospects.length === 0) {
    console.log("processCompetitorSignup: no matching prospects in area", {
      competitorId,
      cuisine: competitor.cuisineType,
      area: competitor.locationArea,
    });
    return 0;
  }

  // Fire webhooks concurrently and track failures
  const results = await Promise.allSettled(
    prospects.map(async (prospect) => {
      // Log the retargeting event first — logRetargetingEvent handles deduplication
      await restaurantRepo.logRetargetingEvent(prospect.id, "retarget_competitor");

      if (env.N8N_WEBHOOK_RETARGETING_URL) {
        const response = await fetch(env.N8N_WEBHOOK_RETARGETING_URL as string, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            prospectId: prospect.id,
            trigger: "retarget_competitor",
            competitorName: competitor.name,
          }),
        });
        if (!response.ok) {
          throw new Error(`Webhook returned ${response.status}`);
        }
      }
    })
  );

  const failed = results.filter(r => r.status === 'rejected').length;
  const succeeded = results.filter(r => r.status === 'fulfilled').length;

  if (failed > 0) {
    console.error(`processCompetitorSignup: ${failed}/${results.length} webhooks failed`, { competitorId });
  }

  return succeeded;
}