"use server-only";

/**
 * Shared Telegram alerting utilities.
 *
 * Centralises all Telegram Bot API sending logic, HTML escaping,
 * and P1 operator alert formatting so that cron services do not
 * duplicate code.
 *
 * Architecture: any service that needs to send a Telegram message
 * should import from here rather than re-implementing.
 */

/**
 * Basic HTML escape for Telegram messages with parse_mode="HTML".
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Send a text message via the Telegram Bot API.
 *
 * @returns true if the HTTP call succeeded (res.ok), false otherwise
 */
export async function sendTelegramMessage(
  botToken: string,
  chatId: string,
  text: string,
  parseMode: "HTML" | "Markdown" = "HTML",
): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: parseMode }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Send a P1 alert to the Telegram operator bot channel.
 * Falls back to console.warn if env vars aren't configured.
 */
export async function sendP1Alert(payload: { title: string; body: string }): Promise<void> {
  const operatorBotToken =
    (typeof process !== "undefined" && process.env?.TELEGRAM_OPERATOR_BOT_TOKEN) ||
    undefined;
  const operatorChatId =
    (typeof process !== "undefined" && process.env?.TELEGRAM_OPERATOR_CHAT_ID) ||
    undefined;

  if (!operatorBotToken || !operatorChatId) {
    console.warn("P1 alert skipped: Telegram credentials not configured", payload);
    return;
  }

  try {
    const text = `[P1] ${escapeHtml(payload.title)}\n\n${escapeHtml(payload.body)}`;
    await fetch(`https://api.telegram.org/bot${operatorBotToken}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: operatorChatId,
        text,
        parse_mode: "HTML",
      }),
    });
  } catch (err) {
    console.error("Failed to send P1 Telegram alert", { error: err, payload });
  }
}
