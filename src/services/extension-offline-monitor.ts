import { campaignRepo } from "@/db/repositories/campaign-repository";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import {
  sendOwnerOfflineAlert,
  sendOperatorEscalationAlert,
} from "@/services/extension-offline-alerts";

/**
 * Extension Offline Monitor (Story 6.5)
 *
 * Detects campaigns that have been sitting in 'approved' status for too long,
 * indicating the Chrome Extension is offline. Sends escalating alerts:
 *
 * t=90 min  → Owner Telegram alert (throttled: 1 per 24h)
 * t=120 min → P1 Operator alert (throttled: 1 per 6h)
 *
 * Alert throttling is performed atomically in the database to eliminate
 * TOCTOU races between concurrent cron runs.
 */

// ─── Types ─────────────────────────────────────────────────

interface OfflineMonitorResult {
  scannedAt: string;
  restaurantsWithStale: number;
  totalStaleCampaigns: number;
  ownerAlertsSent: number;
  operatorAlertsSent: number;
}

// ─── Constants ────────────────────────────────────────────

/** Campaigns approved but unclaimed for this long trigger owner alert */
const OWNER_ALERT_THRESHOLD_MINUTES = 90;

/** After owner alert + this many minutes, escalate to operator */
const OPERATOR_ESCALATION_THRESHOLD_MINUTES = 120;

// ─── Core Monitor ─────────────────────────────────────────

/**
 * Run the extension offline monitor.
 *
 * Finds campaigns in 'approved' status older than thresholds,
 * groups by restaurant, and sends alerts with atomic throttling.
 */
export async function runOfflineMonitor(): Promise<OfflineMonitorResult> {
  let ownerAlertsSent = 0;
  let operatorAlertsSent = 0;
  let totalStaleCampaigns = 0;

  // Query campaigns older than 90 minutes (owner alert threshold)
  const staleGroups = await campaignRepo.listAllApprovedOlderThan(OWNER_ALERT_THRESHOLD_MINUTES);

  if (staleGroups.length === 0) {
    return {
      scannedAt: new Date().toISOString(),
      restaurantsWithStale: 0,
      totalStaleCampaigns: 0,
      ownerAlertsSent: 0,
      operatorAlertsSent: 0,
    };
  }

  // Process each restaurant
  for (const group of staleGroups) {
    const { restaurantId, restaurantName, telegramChatId, campaigns } = group;
    totalStaleCampaigns += campaigns.length;

    const oldestCampaign = campaigns[0]; // ordered by createdAt ASC
    const oldestApprovedAt = oldestCampaign?.createdAt ?? new Date();

    // Determine if this is owner or operator escalation tier
    const minutesSinceApproval = oldestApprovedAt
      ? Math.floor((Date.now() - new Date(oldestApprovedAt).getTime()) / 60000)
      : 0;

    const needsOperatorEscalation = minutesSinceApproval >= OPERATOR_ESCALATION_THRESHOLD_MINUTES;

    // ── Owner Alert (if telegram_chat_id exists ──
    if (telegramChatId) {
      // Atomic throttle: only one cron run can win the UPDATE per restaurant
      const shouldAlert = await restaurantRepo.checkAndUpdateLastOfflineAlertAt(restaurantId);

      if (shouldAlert) {
        const { sent } = await sendOwnerOfflineAlert(
          restaurantName,
          telegramChatId,
          campaigns.length,
          oldestApprovedAt,
        );
        if (sent) ownerAlertsSent++;
      }
    }

    // ── Operator P1 Escalation ──
    // Send if: no telegram_chat_id OR past 120 min threshold
    if (!telegramChatId || needsOperatorEscalation) {
      // Atomic throttle: only one cron run can win the UPDATE per restaurant
      const shouldEscalate = await restaurantRepo.checkAndUpdateLastOperatorAlertAt(restaurantId);

      if (shouldEscalate) {
        const reason = !telegramChatId
          ? "Owner has no Telegram linked - manual contact required."
          : `Oldest campaign approved ${minutesSinceApproval} min ago. Owner was alerted at ${OWNER_ALERT_THRESHOLD_MINUTES} min.`;

        const ok = await sendOperatorEscalationAlert(restaurantName, campaigns.length, reason);
        if (ok) operatorAlertsSent++;
      }
    }
  }

  return {
    scannedAt: new Date().toISOString(),
    restaurantsWithStale: staleGroups.length,
    totalStaleCampaigns,
    ownerAlertsSent,
    operatorAlertsSent,
  };
}
