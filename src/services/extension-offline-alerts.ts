"use server-only";

import { sendTelegramMessage, escapeHtml } from "./telegram-alerts";

/**
 * Extension Offline Alert Sending (Story 6.5)
 *
 * This module separates the presentation / external-I/O concerns
 * (formatting and sending Telegram messages) from the core offline
 * detection logic in `extension-offline-monitor.ts`.
 */

/**
 * Send an owner alert via Telegram.
 *
 * @returns `true` only if the HTTP call to Telegram succeeded.
 */
export async function sendOwnerOfflineAlert(
  restaurantName: string,
  telegramChatId: string,
  campaignCount: number,
  oldestApprovedAt: Date,
): Promise<{ sent: boolean }> {
  const ownerBotToken =
    (typeof process !== "undefined" && process.env?.TELEGRAM_OWNER_BOT_TOKEN) ||
    (typeof process !== "undefined" && process.env?.TELEGRAM_BOT_TOKEN) ||
    undefined;

  if (!ownerBotToken) {
    console.warn("Offline monitor: Owner bot token not configured");
    return { sent: false };
  }

  const formattedDate = oldestApprovedAt.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const text =
    `⚠️ <b>Litoral: Extension Offline</b>\n\n` +
    `Hi ${escapeHtml(restaurantName)}! Your Chrome Extension hasn't checked in for a while.\n\n` +
    `You have <b>${campaignCount} approved campaign(s)</b> waiting to be published. ` +
    `The oldest has been waiting since ${formattedDate}.\n\n` +
    `To publish: open Chrome and click the Litoral Agency extension icon.`;

  const sent = await sendTelegramMessage(ownerBotToken, telegramChatId, text);
  return { sent };
}

/**
 * Send a P1 escalation to the operator Telegram channel.
 *
 * @returns `true` only if the HTTP call to Telegram succeeded.
 */
export async function sendOperatorEscalationAlert(
  restaurantName: string,
  campaignCount: number,
  reason: string,
): Promise<boolean> {
  const operatorBotToken =
    (typeof process !== "undefined" && process.env?.TELEGRAM_OPERATOR_BOT_TOKEN) ||
    undefined;
  const operatorChatId =
    (typeof process !== "undefined" && process.env?.TELEGRAM_OPERATOR_CHAT_ID) ||
    undefined;

  if (!operatorBotToken || !operatorChatId) {
    console.warn("Offline monitor: Operator Telegram credentials not configured");
    return false;
  }

  const text =
    `[P1] <b>Extension Offline — ${escapeHtml(restaurantName)}</b>\n\n` +
    `${campaignCount} campaign(s) approved &gt;90 min ago, extension not polling.\n` +
    `${escapeHtml(reason)}`;

  return sendTelegramMessage(operatorBotToken, operatorChatId, text);
}
