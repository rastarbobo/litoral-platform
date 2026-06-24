/**
 * Review Responses Repository — Story 7.3 (Task 3.3)
 *
 * CRUD operations for the review_responses table.
 * Each restaurant's Google Review responses are tracked independently.
 */

import { eq, and, sql } from "drizzle-orm";
import { getDB } from "@/db";
import { reviewResponsesTable } from "@/db/schema";
import type { ReviewResponse, ReviewCoverage } from "@/db/schema";
import { tryCatch } from "@/lib/try-catch";
import { createId } from "@paralleldrive/cuid2";

// ─── Types ────────────────────────────────────────────────

interface CreateDraftInput {
  restaurantId: string;
  reviewId: string;
  reviewText: string;
  reviewRating: number;
  reviewerName: string;
  aiResponse: string | null;
  fallbackUsed: boolean;
}

interface DatabaseError {
  type: "DATABASE_ERROR";
  message: string;
}

type RepositoryResult<T> =
  | { type: "SUCCESS"; data: T }
  | DatabaseError;

// ─── Repository ───────────────────────────────────────────

class ReviewResponsesRepository {
  /**
   * Create a new draft review response.
   * Idempotent: if a response for this reviewId already exists, returns the existing one.
   */
  async createDraft(input: CreateDraftInput): Promise<RepositoryResult<ReviewResponse>> {
    const db = getDB();

    // Check for existing response (idempotency)
    const { data: existing } = await tryCatch(
      db
        .select()
        .from(reviewResponsesTable)
        .where(eq(reviewResponsesTable.reviewId, input.reviewId)),
    );

    if (existing && existing.length > 0) {
      return { type: "SUCCESS", data: existing[0] };
    }

    const id = `rr_${createId()}`;
    const now = new Date();

    const { data: result, error } = await tryCatch(
      db
        .insert(reviewResponsesTable)
        .values({
          id,
          restaurantId: input.restaurantId,
          reviewId: input.reviewId,
          reviewText: input.reviewText,
          reviewRating: input.reviewRating,
          reviewerName: input.reviewerName,
          aiResponse: input.aiResponse,
          fallbackUsed: input.fallbackUsed,
          status: "drafted",
          createdAt: now,
          updatedAt: now,
        })
        .returning(),
    );

    if (error || !result || result.length === 0) {
      console.error("ReviewResponsesRepository: createDraft failed", { error });
      return {
        type: "DATABASE_ERROR",
        message: error instanceof Error ? error.message : "Failed to create draft",
      };
    }

    return { type: "SUCCESS", data: result[0] };
  }

  /**
   * Get all review responses for a restaurant.
   */
  async getByRestaurantId(restaurantId: string): Promise<RepositoryResult<ReviewResponse[]>> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .select()
        .from(reviewResponsesTable)
        .where(eq(reviewResponsesTable.restaurantId, restaurantId))
        .orderBy(sql`created_at DESC`),
    );

    if (error) {
      console.error("ReviewResponsesRepository: getByRestaurantId failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        message: error instanceof Error ? error.message : "Failed to fetch responses",
      };
    }

    return { type: "SUCCESS", data: data ?? [] };
  }

  /**
   * Get pending approval drafts for a restaurant.
   */
  async getPendingApproval(restaurantId: string): Promise<RepositoryResult<ReviewResponse[]>> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .select()
        .from(reviewResponsesTable)
        .where(
          and(
            eq(reviewResponsesTable.restaurantId, restaurantId),
            eq(reviewResponsesTable.status, "drafted"),
          ),
        ),
    );

    if (error) {
      console.error("ReviewResponsesRepository: getPendingApproval failed", {
        error,
        restaurantId,
      });
      return {
        type: "DATABASE_ERROR",
        message: error instanceof Error ? error.message : "Failed to fetch pending approvals",
      };
    }

    return { type: "SUCCESS", data: data ?? [] };
  }

  /**
   * Update the status of a review response.
   */
  async updateStatus(
    id: string,
    status: "approved" | "rejected" | "published" | "drafted",
  ): Promise<RepositoryResult<ReviewResponse>> {
    const db = getDB();
    const now = new Date();

    const updatePayload: Record<string, unknown> = {
      status,
      updatedAt: now,
    };

    if (status === "approved") {
      updatePayload.approvedAt = now;
    } else if (status === "published") {
      updatePayload.publishedAt = now;
    }

    const { data: result, error } = await tryCatch(
      db
        .update(reviewResponsesTable)
        .set(updatePayload)
        .where(eq(reviewResponsesTable.id, id))
        .returning(),
    );

    if (error || !result || result.length === 0) {
      console.error("ReviewResponsesRepository: updateStatus failed", { error, id, status });
      return {
        type: "DATABASE_ERROR",
        message: error instanceof Error ? error.message : "Failed to update status",
      };
    }

    return { type: "SUCCESS", data: result[0] };
  }

  /**
   * Update the AI response text for a review response (owner edit path).
   */
  async updateAiResponse(
    id: string,
    aiResponse: string,
  ): Promise<RepositoryResult<ReviewResponse>> {
    const db = getDB();

    const { data: result, error } = await tryCatch(
      db
        .update(reviewResponsesTable)
        .set({
          aiResponse,
          fallbackUsed: false,
          updatedAt: new Date(),
        })
        .where(eq(reviewResponsesTable.id, id))
        .returning(),
    );

    if (error || !result || result.length === 0) {
      console.error("ReviewResponsesRepository: updateAiResponse failed", { error, id });
      return {
        type: "DATABASE_ERROR",
        message: error instanceof Error ? error.message : "Failed to update AI response",
      };
    }

    return { type: "SUCCESS", data: result[0] };
  }

  /**
   * Get review coverage stats for a restaurant within a date range.
   */
  async getReviewCoverage(
    restaurantId: string,
    since: Date,
  ): Promise<ReviewCoverage> {
    const db = getDB();

    const { data: stats, error } = await tryCatch(
      db
        .select({
          total: sql<number>`COUNT(*)`,
          drafted: sql<number>`SUM(CASE WHEN status = 'drafted' THEN 1 ELSE 0 END)`,
          approved: sql<number>`SUM(CASE WHEN status = 'approved' THEN 1 ELSE 0 END)`,
          published: sql<number>`SUM(CASE WHEN status = 'published' THEN 1 ELSE 0 END)`,
        })
        .from(reviewResponsesTable)
        .where(
          and(
            eq(reviewResponsesTable.restaurantId, restaurantId),
            sql`created_at >= ${since.getTime()}`,
          ),
        ),
    );

    if (error || !stats || stats.length === 0) {
      return { drafted: 0, approved: 0, published: 0, total: 0 };
    }

    return {
      drafted: stats[0].drafted as number ?? 0,
      approved: stats[0].approved as number ?? 0,
      published: stats[0].published as number ?? 0,
      total: stats[0].total as number ?? 0,
    };
  }

  /**
   * Find a single review response by ID.
   */
  async findById(id: string): Promise<ReviewResponse | null> {
    const db = getDB();

    const { data, error } = await tryCatch(
      db
        .select()
        .from(reviewResponsesTable)
        .where(eq(reviewResponsesTable.id, id)),
    );

    if (error || !data || data.length === 0) return null;
    return data[0];
  }
}

// ─── Singleton Export ─────────────────────────────────────

export const reviewResponsesRepo = new ReviewResponsesRepository();