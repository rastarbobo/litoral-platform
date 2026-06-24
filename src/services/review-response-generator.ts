/**
 * Review Response Generator — Story 7.3 (Task 3.1)
 *
 * Generates AI-powered Google Review responses filtered through the
 * restaurant's Brand Persona. Falls back to template responses on AI failure.
 *
 * ADR-002 compliance: Reads agent config from agentConfigTable
 * (agent_code = 'offer_strategist').
 */

import { restaurantRepo } from "@/db/repositories/restaurant-repository";
import type { Restaurant } from "@/db/schema";

// ─── Types ────────────────────────────────────────────────

interface GoogleReviewData {
  reviewId: string;
  reviewerName: string;
  rating: number; // 1-5
  text: string;
  createdAt?: string;
}

interface ReviewResponseResult {
  response: string;
  fallbackUsed: boolean;
}

class ReviewResponseGenerationError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = "ReviewResponseGenerationError";
  }
}

// ─── Template Fallbacks (AC 5) ───────────────────────────

const FALLBACK_TEMPLATES: Record<number, string[]> = {
  5: [
    "Thank you so much for your kind words, {reviewerName}! We're thrilled you enjoyed your visit and hope to welcome you back next season.",
    "We really appreciate you taking the time to share your experience, {reviewerName}. It means the world to us!",
  ],
  4: [
    "Thank you for the wonderful review, {reviewerName}! We're so glad you had a great experience with us.",
  ],
  3: [
    "Thank you for your feedback, {reviewerName}. We appreciate your honesty and will use it to improve. We'd love another chance to serve you.",
  ],
  2: [
    "We're sorry to hear your experience wasn't up to our standards, {reviewerName}. We take this feedback seriously and would love to make it right. Please reach out to us directly.",
  ],
  1: [
    "We sincerely apologize that your experience fell short, {reviewerName}. This is not the standard we hold ourselves to. We'd appreciate the opportunity to discuss this with you personally.",
  ],
};

// ─── Core Function ───────────────────────────────────────

/**
 * Generate an AI-powered review response or fall back to template.
 *
 * @param review - The Google Review to respond to
 * @param restaurant - The restaurant record (must include brandPersonaFragment)
 * @param aiGatewayFetch - Injected fetch function for AI Gateway calls (injectable for testing)
 * @returns The generated response text and whether a fallback was used
 */
// Public API — consumed by review response service consumers (e.g. n8n workflow, API route).
// eslint-disable-next-line project/no-unused-module-exports
export async function generateReviewResponse(
  review: GoogleReviewData,
  restaurant: Restaurant,
  aiGatewayFetch: (prompt: string) => Promise<string> = defaultAiGatewayCall,
): Promise<ReviewResponseResult> {
  // 1. Try AI-powered generation
  try {
    const systemPrompt = buildSystemPrompt(review, restaurant);
    const aiResponse = await aiGatewayFetch(systemPrompt);

    // Validate: AI must return a non-empty string
    if (aiResponse && aiResponse.trim().length > 0) {
      return {
        response: aiResponse.trim(),
        fallbackUsed: false,
      };
    }

    console.warn("ReviewResponseGenerator: AI returned empty response, using fallback", {
      reviewId: review.reviewId,
      restaurantId: restaurant.id,
    });
  } catch (error) {
    // AC 5: Log the failure and fall back to template
    console.error("ReviewResponseGenerator: AI call failed, using template fallback", {
      error: error instanceof Error ? error.message : "Unknown",
      reviewId: review.reviewId,
      restaurantId: restaurant.id,
    });
  }

  // 2. Fallback to template
  const fallback = selectFallbackTemplate(review.rating, review.reviewerName);
  return {
    response: fallback,
    fallbackUsed: true,
  };
}

// ─── Prompt Builder ──────────────────────────────────────

function buildSystemPrompt(
  review: GoogleReviewData,
  restaurant: Restaurant,
): string {
  const ratingDescription = getRatingDescription(review.rating);

  return `You are the Litoral Agency, responding to a Google Review on behalf of a restaurant owner.

Restaurant: ${restaurant.name ?? "A local restaurant"}
Cuisine: ${restaurant.cuisineType ?? "various"}
Location: ${restaurant.location ?? "local area"}
Brand Persona: ${restaurant.brandPersonaFragment ?? "warm, welcoming, and community-focused coastal restaurant"}

Review from ${review.reviewerName} (${review.rating}/5 stars):
"${review.text}"

Rules for ${ratingDescription} reviews:
${getRatingRules(review.rating)}

IMPORTANT:
- Max 3 sentences. Short is better than long.
- Sound like the owner wrote it, not a corporation or PR agency.
- Match the Brand Persona tone of voice exactly.
- NEVER mention "AI", "automated", "template", "Litoral Agency", or "system" in the response.
- If the review mentions specific dishes, staff members, or experiences, reference them by name.
- Respond only with the review response text — no prefixes, labels, or quotation marks.`;
}

function getRatingDescription(rating: number): string {
  if (rating >= 4) return "positive";
  if (rating === 3) return "neutral";
  return "negative";
}

function getRatingRules(rating: number): string {
  if (rating >= 4) {
    return "- Be warm, grateful, and personal.\n- Mention something specific from their review.\n- Show you actually read what they wrote.";
  }
  if (rating === 3) {
    return "- Be appreciative of their feedback.\n- Be constructive and genuine.\n- Invite them back or to reach out directly.";
  }
  return "- Be apologetic without being defensive.\n- Offer to make it right.\n- Invite offline contact (phone/email) if appropriate.\n- Never make excuses or blame the customer.";
}

// ─── Fallback Selection ──────────────────────────────────

function selectFallbackTemplate(rating: number, reviewerName: string): string {
  const templates = FALLBACK_TEMPLATES[rating];
  if (!templates || templates.length === 0) {
    // Fallback for any unhandled rating
    return `Thank you for your review, ${reviewerName}. We appreciate your feedback.`;
  }

  // Deterministic selection based on reviewer name hash (same name → same template)
  // This avoids the same owner seeing different templates for the same reviewer on retry
  let hash = 0;
  for (let i = 0; i < reviewerName.length; i++) {
    hash = ((hash << 5) - hash + reviewerName.charCodeAt(i)) | 0;
  }
  const index = Math.abs(hash) % templates.length;

  return templates[index].replace("{reviewerName}", reviewerName);
}

// ─── AI Gateway Call ─────────────────────────────────────

/**
 * Default AI Gateway implementation.
 * Reads the Offer Strategist agent config from the database (ADR-002).
 * Injected as a parameter so unit tests can substitute a mock.
 */
async function defaultAiGatewayCall(prompt: string): Promise<string> {
  const agentConfig = await restaurantRepo.getAgentConfig("offer_strategist");

  if (!agentConfig) {
    throw new ReviewResponseGenerationError(
      "Offer Strategist agent config not found in agent_config table",
    );
  }

  // Call Cloudflare AI Gateway
  // The actual endpoint depends on the AI Gateway binding configuration
  // This uses the Workers AI binding pattern; adjust for your specific setup
  // NOTE: AI Gateway credentials should be passed via Worker env bindings.
  // This default implementation expects env vars to be injected. Callers
  // running in a Cloudflare Worker should pass a custom `aiGatewayFetch`
  // that reads from `env` bindings instead of process.env.
  const gatewayAccount = (typeof process !== "undefined" && process.env?.AI_GATEWAY_ACCOUNT) || "";
  const gatewayId = (typeof process !== "undefined" && process.env?.AI_GATEWAY_ID) || "";
  const gatewayToken = (typeof process !== "undefined" && process.env?.AI_GATEWAY_TOKEN) || "";

  if (!gatewayAccount || !gatewayId || !gatewayToken) {
    throw new ReviewResponseGenerationError(
      "AI Gateway credentials not configured. Pass a custom aiGatewayFetch or set env bindings."
    );
  }

  const response = await fetch(
    `https://gateway.ai.cloudflare.com/v1/${gatewayAccount}/${gatewayId}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${gatewayToken}`,
      },
      body: JSON.stringify({
        model: agentConfig.model,
        messages: [
          { role: "user", content: prompt },
        ],
        temperature: agentConfig.temperature,
        max_tokens: agentConfig.maxTokens,
      }),
    },
  );

  if (!response.ok) {
    throw new ReviewResponseGenerationError(
      `AI Gateway returned ${response.status}: ${response.statusText}`,
    );
  }

  const result = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };

  const content = result?.choices?.[0]?.message?.content;
  if (!content) {
    throw new ReviewResponseGenerationError("AI Gateway returned empty response");
  }

  return content;
}