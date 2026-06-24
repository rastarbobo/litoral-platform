import type { AnalystPromptContext } from "@/services/analyst-context";

/**
 * AI Insight Generator — Story 7.2
 *
 * Calls Cloudflare AI Gateway to generate a plain-English insight for
 * restaurant owners based on their campaign performance data.
 *
 * On failure, throws AiInsightGenerationError so the caller can
 * fall back to the rule-based generator from Story 7.1.
 */

// ─── Types ─────────────────────────────────────────────────

// Exported for consumers to catch and handle AI insight failures.
// eslint-disable-next-line project/no-unused-module-exports
export class AiInsightGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "AiInsightGenerationError";
  }
}

// ─── Constants ────────────────────────────────────────────

/**
 * System prompt that constrains the AI to produce restaurant-owner-friendly text.
 *
 * Stored as a constant here. Can be overridden via `agent_configTable` in Story 7.2+.
 */
const SYSTEM_PROMPT = [
  "You are the Litoral Analyst, translating performance data for a busy restaurant owner who doesn't read charts.",
  "Given the context below, write ONE short, friendly sentence (max 25 words) about what's working best.",
  "Use plain language. Never mention \"data\", \"analytics\", \"impressions\", \"bps\", or \"engagement rate\".",
  'Instead say things like "drove more attention", "got the most interest", "performed best".',
  "Always name the platform (Instagram/Facebook/TikTok/Google).",
  "Keep it positive and forward-looking.",
  "Do NOT use markdown, quotes, or bullet points. Just the plain sentence.",
].join(" ");

/**
 * User prompt template — serializes the context into a readable string.
 */
function buildUserPrompt(ctx: AnalystPromptContext): string {
  const lines: string[] = [];

  lines.push(`Context for the restaurant this week:`);
  lines.push(`- Total reach this week: ${ctx.currentWeek.totalReach.toLocaleString()}`);
  lines.push(
    `- Engagement: ${(ctx.currentWeek.engagementRateBps / 100).toFixed(1)}% vs ` +
      `${(ctx.previousWeek.engagementRateBps / 100).toFixed(1)}% last week`,
  );

  if (ctx.topPlatform) {
    lines.push(
      `- Top platform: ${ctx.topPlatform.platform} ` +
        `(${(ctx.topPlatform.engagementRateBps / 100).toFixed(1)}% engagement)`,
    );
  }

  lines.push(`- Total published campaigns: ${ctx.totalPublishedCampaigns}`);
  lines.push(`- Trend: ${ctx.trend}`);

  return lines.join("\n");
}

// ─── AI Gateway Client ────────────────────────────────────

interface AIGatewayConfig {
  model: string;
  temperature: number;
  maxTokens: number;
  gatewayUrl: string;
}

const DEFAULT_CONFIG: AIGatewayConfig = {
  model: "@cf/meta/llama-3-8b-instruct",
  temperature: 0.7,
  maxTokens: 150,
  gatewayUrl: "https://gateway.ai.cloudflare.com/v1",
};

function getGatewayConfig(): AIGatewayConfig {
  const accountId =
    (typeof process !== "undefined" && process.env?.CLOUDFLARE_ACCOUNT_ID) || "";

  const gatewayUrl = accountId
    ? `https://gateway.ai.cloudflare.com/v1/${accountId}/litoral/chat/completions`
    : DEFAULT_CONFIG.gatewayUrl;

  return {
    model:
      (typeof process !== "undefined" && process.env?.AI_INSIGHT_MODEL) ||
      DEFAULT_CONFIG.model,
    temperature: DEFAULT_CONFIG.temperature,
    maxTokens: DEFAULT_CONFIG.maxTokens,
    gatewayUrl,
  };
}

/**
 * Call Cloudflare AI Gateway with a chat completion request.
 *
 * Returns the message content on success.
 * Throws AiInsightGenerationError on any failure.
 */
export async function generateAiInsight(
  ctx: AnalystPromptContext,
): Promise<{ quote: string }> {
  const config = getGatewayConfig();

  if (!config.gatewayUrl || config.gatewayUrl === DEFAULT_CONFIG.gatewayUrl) {
    throw new AiInsightGenerationError(
      "AI Gateway not configured — CLOUDFLARE_ACCOUNT_ID not set",
    );
  }

  const userPrompt = buildUserPrompt(ctx);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000); // 10s timeout

  try {
    const res = await fetch(config.gatewayUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: config.model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userPrompt },
        ],
        temperature: config.temperature,
        max_tokens: config.maxTokens,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      throw new AiInsightGenerationError(
        `AI Gateway returned ${res.status}: ${res.statusText}`,
      );
    }

    // Handle Cloudflare AI Gateway response format:
    // { result: { success: true, ... }, ... } with text in choices form
    // or: { choices: [{ message: { content: "..." } }] } (OpenAI-compatible)

    const json: Record<string, unknown> = await res.json();

    // Try Cloudflare AI Gateway format first
    // Expected: { result: { choices: [{ message: { content: "..." } }] }, success: true }
    const result = json.result as Record<string, unknown> | undefined;
    if (result?.success) {
      const choices = result.choices as
        | Array<{ message?: { content?: string } }>
        | undefined;

      const content = choices?.[0]?.message?.content;

      if (content && typeof content === "string" && content.trim().length > 0) {
        return { quote: content.trim() };
      }
    }

    // Try OpenAI-compatible format
    const choices = json.choices as
      | Array<{ message?: { content?: string } }>
      | undefined;

    const content = choices?.[0]?.message?.content;

    if (content && typeof content === "string" && content.trim().length > 0) {
      return { quote: content.trim() };
    }

    throw new AiInsightGenerationError(
      "AI Gateway returned empty or malformed response",
    );
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof AiInsightGenerationError) {
      throw err;
    }

    if (err instanceof DOMException && err.name === "AbortError") {
      throw new AiInsightGenerationError("AI Gateway request timed out (10s)");
    }

    throw new AiInsightGenerationError(
      `AI Gateway request failed: ${err instanceof Error ? err.message : "Unknown error"}`,
      err,
    );
  }
}