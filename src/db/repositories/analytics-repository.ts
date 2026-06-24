import { eq, sql, gte, and } from "drizzle-orm";
import { getDB } from "@/db";
import { analyticsEventsTable, prospectEventsTable } from "@/db/schema";
import type { AnalyticsEvent } from "@/db/schema";

type MetricTier = 'Revenue' | 'Conversion' | 'Engagement' | 'System Health';

interface CohortReport {
  startDate: string;
  endDate: string;
  metrics: {
    revenue: number; // e.g. amount or count of closed deals
    conversion: number; // e.g. reply rate -> demo rate
    engagement: number; // e.g. email open rates, click rates, scroll depth
    systemHealth: number; // e.g. delivery success rate
  };
  recommendation: {
    underperformingTier: MetricTier;
    action: string;
  };
}

export class AnalyticsRepository {
  async recordEvent(
    prospectId: string,
    eventType: string,
    metadata?: Record<string, unknown>
  ): Promise<{ data?: AnalyticsEvent; error?: string }> {
    try {
      const db = getDB();
      const [inserted] = await db.insert(analyticsEventsTable)
        .values({
          prospectId,
          eventType,
          metadata,
        })
        .returning();
      
      return { data: inserted };
    } catch (err: unknown) {
      console.error("Failed to record analytics event", err);
      return { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }

  async generateWeeklyCohortReport(now = new Date()): Promise<{ data?: CohortReport; error?: string }> {
    try {
      const db = getDB();
      
      // Calculate boundaries
      const endDate = new Date(now);
      const startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);

      // Example simplified metric aggregation
      // Revenue Proxy: Count of prospects that reached state 6 (Won) or similar conversion
      const revenueResult = await db.select({ count: sql<number>`count(*)` })
        .from(prospectEventsTable)
        .where(
          and(
            gte(prospectEventsTable.createdAt, startDate),
            eq(prospectEventsTable.toState, 6)
          )
        );
      
      // Conversion Proxy: Count of replies
      const conversionResult = await db.select({ count: sql<number>`count(*)` })
        .from(prospectEventsTable)
        .where(
          and(
            gte(prospectEventsTable.createdAt, startDate),
            eq(prospectEventsTable.trigger, 'reply')
          )
        );

      // Engagement Proxy: Page views and scroll depth events
      const engagementResult = await db.select({ count: sql<number>`count(*)` })
        .from(analyticsEventsTable)
        .where(
          and(
            gte(analyticsEventsTable.createdAt, startDate),
            sql`${analyticsEventsTable.eventType} IN ('page_visit', 'scroll', 'click')`
          )
        );

      // System Health Proxy: Number of prospects successfully ingested/contacted (state 1)
      const systemHealthResult = await db.select({ count: sql<number>`count(*)` })
        .from(prospectEventsTable)
        .where(
          and(
            gte(prospectEventsTable.createdAt, startDate),
            eq(prospectEventsTable.toState, 1)
          )
        );

      const metrics = {
        revenue: revenueResult[0]?.count || 0,
        conversion: conversionResult[0]?.count || 0,
        engagement: engagementResult[0]?.count || 0,
        systemHealth: systemHealthResult[0]?.count || 0,
      };

      // Determine underperforming tier
      // Normalizing the scores to find the lowest performer. This logic can be expanded.
      const scores: Array<{ tier: MetricTier; score: number }> = [
        { tier: 'Revenue', score: metrics.revenue * 100 }, // weight revenue higher
        { tier: 'Conversion', score: metrics.conversion * 10 }, // weight conversion
        { tier: 'Engagement', score: metrics.engagement },
        { tier: 'System Health', score: metrics.systemHealth * 2 },
      ];

      // If all metrics are zero, no data was collected — avoid flagging a false underperformer
      const allZero = scores.every(s => s.score === 0);

      const underperforming = allZero
        ? { tier: 'System Health' as MetricTier, score: 0 }
        : scores.reduce((min, p) => p.score < min.score ? p : min, scores[0]);

      let action = "Insufficient data collected this week — ensure tracking beacons are active on all assets.";
      if (!allZero) {
        if (underperforming.tier === 'Engagement') {
          action = "Optimize email subject lines and landing page above-the-fold content to increase engagement.";
        } else if (underperforming.tier === 'Conversion') {
          action = "Review the offer and CRO variants to improve the demo booking rate.";
        } else if (underperforming.tier === 'Revenue') {
          action = "Check closing strategies on demos and follow-ups.";
        } else if (underperforming.tier === 'System Health') {
          action = "Investigate system health and ingestion pipelines.";
        }
      }

      return {
        data: {
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          metrics,
          recommendation: {
            underperformingTier: underperforming.tier,
            action,
          }
        }
      };
    } catch (err: unknown) {
      console.error("Failed to generate weekly cohort report", err);
      return { error: err instanceof Error ? err.message : "Unknown error" };
    }
  }
}

export const analyticsRepo = new AnalyticsRepository();
