import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getCloudflareContext } from "@/utils/cloudflare-context";
import { restaurantRepo } from "@/db/repositories/restaurant-repository";

// ─── Constants ──────────────────────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_API_BASE = "https://api.telegram.org";
const TG_DEDUP_TTL = 86400; // 24 hours

// n8n webhook URL for direct campaign processing (Story 4.2: simplified from CF Queue)
const N8N_WEBHOOK_URL = process.env.N8N_WEBHOOK_URL || "";

const WEBHOOK_SECRET_HEADER = "x-telegram-bot-api-secret-token";

// ─── Zod Schemas ────────────────────────────────────────────

const TelegramPhotoSizeSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  width: z.number(),
  height: z.number(),
  file_size: z.number().optional(),
});

const TelegramVoiceSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  duration: z.number(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
});

const TelegramVideoSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  width: z.number(),
  height: z.number(),
  duration: z.number(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
});

const TelegramMessageSchema = z.object({
  message_id: z.number(),
  from: z.object({
    id: z.number(),
    is_bot: z.boolean(),
    first_name: z.string(),
    last_name: z.string().optional(),
    username: z.string().optional(),
  }),
  chat: z.object({
    id: z.number(),
    type: z.string(),
    first_name: z.string().optional(),
    last_name: z.string().optional(),
    username: z.string().optional(),
  }),
  date: z.number(),
  text: z.string().optional(),
  caption: z.string().optional(),
  photo: z.array(TelegramPhotoSizeSchema).optional(),
  voice: TelegramVoiceSchema.optional(),
  video: TelegramVideoSchema.optional(),
});

const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: TelegramMessageSchema.optional(),
  edited_message: TelegramMessageSchema.optional(),
});

// ─── Inferred Types ─────────────────────────────────────────

type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;
type TelegramMessage = z.infer<typeof TelegramMessageSchema>;

// ─── Event Payload Type ─────────────────────────────────────

type MediaType = "photo" | "voice" | "video" | "text";

interface TelegramEventPayload {
  updateId: number;
  chatId: number;
  messageId: number;
  date: number;
  mediaType: MediaType;
  caption: string | null;
  text: string | null;
  fileId: string | null;
  fileUniqueId: string | null;
  mimeType: string | null;
  fromFirstName: string;
  fromUsername: string | null;
}

// ─── Helpers ────────────────────────────────────────────────

/** Resolve restaurant by Telegram chat ID */
async function findRestaurantByChatId(chatId: number) {
  return restaurantRepo.findByTelegramChatId(String(chatId));
}

/** Build the Telegram event payload from a parsed message */
function buildEventPayload(
  update: TelegramUpdate,
  msg: TelegramMessage,
): TelegramEventPayload {
  let mediaType: MediaType = "text";
  let fileId: string | null = null;
  let fileUniqueId: string | null = null;
  let mimeType: string | null = null;

  // Determine media type and extract file references
  if (msg.photo && msg.photo.length > 0) {
    // Telegram sends multiple photo sizes; pick the largest (last in array)
    const largestPhoto = msg.photo[msg.photo.length - 1];
    mediaType = "photo";
    fileId = largestPhoto.file_id;
    fileUniqueId = largestPhoto.file_unique_id;
  } else if (msg.voice) {
    mediaType = "voice";
    fileId = msg.voice.file_id;
    fileUniqueId = msg.voice.file_unique_id;
    mimeType = msg.voice.mime_type ?? null;
  } else if (msg.video) {
    mediaType = "video";
    fileId = msg.video.file_id;
    fileUniqueId = msg.video.file_unique_id;
    mimeType = msg.video.mime_type ?? null;
  }

  return {
    updateId: update.update_id,
    chatId: msg.chat.id,
    messageId: msg.message_id,
    date: msg.date,
    mediaType,
    caption: msg.caption ?? null,
    text: msg.text ?? null,
    fileId,
    fileUniqueId,
    mimeType,
    fromFirstName: msg.from.first_name,
    fromUsername: msg.from.username ?? null,
  };
}

/** Send a reply message to a Telegram chat */
async function sendTelegramReply(
  chatId: number,
  replyToMessageId: number,
  text: string,
): Promise<void> {
  if (!TELEGRAM_BOT_TOKEN) {
    console.error("TELEGRAM_BOT_TOKEN is not configured — cannot send reply");
    return;
  }
  try {
    const url = `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    const body = JSON.stringify({
      chat_id: chatId,
      reply_to_message_id: replyToMessageId,
      text,
    });
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
  } catch (err) {
    console.error("Failed to send Telegram reply:", err);
  }
}

/** Validate the X-Telegram-Bot-Api-Secret-Token header */
function validateWebhookSecret(request: NextRequest): boolean {
  const secretToken = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secretToken) {
    console.error("TELEGRAM_WEBHOOK_SECRET is not configured");
    return false;
  }
  const headerToken = request.headers.get(WEBHOOK_SECRET_HEADER);
  // Use timing-safe comparison to prevent timing attacks
  if (!headerToken) return false;
  if (headerToken.length !== secretToken.length) return false;
  // Simple constant-time check (crypto.timingSafeEqual not available in Workers)
  let mismatch = 0;
  for (let i = 0; i < headerToken.length; i++) {
    mismatch |= headerToken.charCodeAt(i) ^ secretToken.charCodeAt(i);
  }
  return mismatch === 0;
}

// ─── Main Route Handler ─────────────────────────────────────

/**
 * POST /api/webhooks/telegram
 *
 * Telegram Bot webhook handler. Receives messages (text, photo, voice, video)
 * from restaurant owners, validates them, deduplicates, resolves the restaurant,
 * and enqueues for n8n processing.
 *
 * Per ADR-001: Worker → Queue → n8n (no direct n8n exposure).
 */
export async function POST(request: NextRequest) {
  // 1. Signature verification (mandatory — reject unverified)
  if (!validateWebhookSecret(request)) {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 403 },
    );
  }

  // 2. Parse and validate Telegram update payload
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "error", message: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parseResult = TelegramUpdateSchema.safeParse(body);
  if (!parseResult.success) {
    console.warn("Telegram webhook: invalid update shape", parseResult.error.flatten());
    return NextResponse.json(
      { status: "error", message: "Invalid update shape" },
      { status: 400 },
    );
  }

  const update = parseResult.data;

  // Only process messages (skip edited messages, callback queries, etc.)
  const msg = update.message;
  if (!msg) {
    // edited_message or non-message update — acknowledge silently
    return NextResponse.json({ status: "success" });
  }

  // 3. Deduplication via KV (tg_dedup:{update_id}, 24h TTL)
  const { env } = await getCloudflareContext();
  const kvNamespace = env.NEXT_INC_CACHE_KV as KVNamespace | undefined;

  if (kvNamespace) {
    const dedupKey = `tg_dedup:${update.update_id}`;
    const existing = await kvNamespace.get(dedupKey);
    if (existing !== null) {
      return NextResponse.json({ status: "success" });
    }
    // Mark as processed immediately (fire-and-forget, don't block response)
    try {
      await kvNamespace.put(dedupKey, "1", {
        expirationTtl: TG_DEDUP_TTL,
      });
    } catch (err) {
      console.error("Failed to mark Telegram dedup in KV:", err);
      // Continue processing — better to risk a duplicate than drop a message
    }
  }

  // 4. Build structured event payload
  const eventPayload = buildEventPayload(update, msg);

  // 5. Resolve restaurant by Telegram chat ID
  const restaurant = await findRestaurantByChatId(msg.chat.id);

  if (!restaurant) {
    // Unknown chat — reply and acknowledge
    await sendTelegramReply(
      msg.chat.id,
      msg.message_id,
      "I don't recognize you. Please contact support.",
    );
    return NextResponse.json({ status: "success" });
  }

  // 6. Pre-flight validation (same checks as Story 4.1)
  if (restaurant.subscriptionStatus !== "active_saas" && restaurant.subscriptionStatus !== "active_agency") {
    await sendTelegramReply(
      msg.chat.id,
      msg.message_id,
      "Your account is not active. Please contact support.",
    );
    return NextResponse.json({ status: "success" });
  }

  if (!restaurant.brandPersonaFragment || !restaurant.slug || !restaurant.cuisineType) {
    // Fire P2 operator alert via console (n8n watches for these patterns)
    console.error(
      `[${restaurant.name}] Pre-flight validation failed: ` +
      `brandPersonaFragment=${!!restaurant.brandPersonaFragment}, ` +
      `slug=${!!restaurant.slug}, cuisineType=${!!restaurant.cuisineType}`
    );
    await sendTelegramReply(
      msg.chat.id,
      msg.message_id,
      "I couldn't process that. Could you try again? If this keeps happening, I'll alert our team.",
    );
    return NextResponse.json({ status: "success" });
  }

  // 7. Send directly to n8n webhook for campaign processing
  // (Story 4.2: simplified from CF Queue → direct webhook per decision)
  // Include restaurant context so n8n doesn't need to re-query D1 for basic info
  const webhookPayload = {
    ...eventPayload,
    restaurantId: restaurant.id,
    restaurantName: restaurant.name,
    restaurantSlug: restaurant.slug,
    cuisineType: restaurant.cuisineType,
    brandPersonaFragment: restaurant.brandPersonaFragment,
    brandPersonaR2Key: restaurant.brandPersonaR2Key,
    subscriptionStatus: restaurant.subscriptionStatus,
  };

  let webhookSent = false;
  if (N8N_WEBHOOK_URL) {
    try {
      const response = await fetch(N8N_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(webhookPayload),
      });
      if (response.ok) {
        webhookSent = true;
      } else {
        console.error(`Failed to send to n8n webhook: ${response.status}`);
      }
    } catch (err) {
      console.error("Failed to POST to n8n webhook:", err);
    }
  } else {
    // Dev/local: log the payload
    console.log("[OWNER_INITIATED_WEBHOOK]", JSON.stringify(webhookPayload));
    webhookSent = true;
  }

  // 8. If webhook call failed, reply with error to owner
  if (!webhookSent) {
    await sendTelegramReply(
      msg.chat.id,
      msg.message_id,
      "I couldn't process that. Could you try again? If this keeps happening, I'll alert our team.",
    );
    return NextResponse.json(
      { status: "error", message: "Failed to send to campaign handler" },
      { status: 500 },
    );
  }

  return NextResponse.json({ status: "success" });
}