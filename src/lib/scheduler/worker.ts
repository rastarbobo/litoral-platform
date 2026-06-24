import { dispatchScheduledJobsToQueue, getSchedulerQueueDelayLimitSeconds } from "@/lib/scheduler/scheduler";
import { runScheduledJob } from "@/lib/scheduler/job-handlers";
import type { ScheduledQueueMessage } from "@/lib/scheduler/jobs";
import {
  dispatchDueCreditExpirationJobs,
  dispatchDueCreditRefreshJobs,
} from "@/utils/credit-scheduler";

function getRetryDelaySeconds(attempts: number): number {
  const baseDelaySeconds = 30;
  const delaySeconds = baseDelaySeconds * Math.max(1, attempts);
  return Math.min(delaySeconds, getSchedulerQueueDelayLimitSeconds());
}

function getSecondsUntilRunAt(runAt: string): number {
  return Math.ceil((new Date(runAt).getTime() - Date.now()) / 1000);
}

import { processSeasonProximityTriggers } from "@/lib/scheduler/retargeting-scheduler";

export async function handleSchedulerCron({
  env,
  now = new Date(),
}: {
  env: Env;
  now?: Date;
}): Promise<number> {
  const queue = env.SCHEDULER_QUEUE;

  // Run credit dispatch and season retargeting independently — a failure in one
  // must not cascade into the others.
  const results = await Promise.allSettled([
    dispatchScheduledJobsToQueue({ queue, now }),
    dispatchDueCreditExpirationJobs({ queue, now }),
    dispatchDueCreditRefreshJobs({ queue, now }),
    processSeasonProximityTriggers(env as unknown as Record<string, unknown>, now),
    (async () => {
      // Run weekly report on Sundays. Idempotency via KV to prevent duplicate runs
      // if the cron fires multiple times or is delayed into a later window.
      const WEEKLY_REPORT_KV_KEY = "analytics:last_weekly_report_iso";
      if (now.getUTCDay() === 0) {
        const lastRunIso = env.OPT_OUT_KV
          ? await env.OPT_OUT_KV.get(WEEKLY_REPORT_KV_KEY)
          : null;
        // Compute the ISO week key (Monday-based) to detect whether this week's report was already generated
        const monday = new Date(now);
        monday.setUTCDate(now.getUTCDate() - ((now.getUTCDay() + 6) % 7));
        const weekKey = monday.toISOString().slice(0, 10);
        const lastWeekKey = lastRunIso
          ? (() => { const d = new Date(lastRunIso); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); })()
          : null;

        if (lastWeekKey === weekKey) {
          return 0; // already generated this week
        }

        const { analyticsRepo } = await import("@/db/repositories/analytics-repository");
        const report = await analyticsRepo.generateWeeklyCohortReport(now);
        if (report.error) {
          console.error("Weekly cohort report generation failed", { error: report.error });
          return 0;
        }
        if (report.data) {
          console.log("Weekly Cohort Report:", report.data);
          if (env.N8N_WEBHOOK_ANALYTICS_REPORT_URL) {
            await fetch(env.N8N_WEBHOOK_ANALYTICS_REPORT_URL, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(report.data),
            }).catch(err => console.error("Failed to send analytics report webhook", err));
          }
          // Mark this week as processed
          if (env.OPT_OUT_KV) {
            await env.OPT_OUT_KV.put(WEEKLY_REPORT_KV_KEY, now.toISOString());
          }
        }
      }
      return 0;
    })(),
  ]);

  let total = 0;
  let failures = 0;

  for (const result of results) {
    if (result.status === 'fulfilled') {
      total += Math.max(0, result.value);
    } else {
      failures++;
      console.error("handleSchedulerCron: sub-task failed", { error: result.reason });
    }
  }

  if (failures > 0) {
    console.warn(`handleSchedulerCron: ${failures}/${results.length} sub-tasks failed`);
  }

  return total;
}

export async function handleSchedulerQueue(batch: MessageBatch<ScheduledQueueMessage>): Promise<void> {
  for (const message of batch.messages) {
    try {
      const secondsUntilRun = getSecondsUntilRunAt(message.body.runAt);

      if (secondsUntilRun > 0) {
        message.retry({
          delaySeconds: Math.min(secondsUntilRun, getSchedulerQueueDelayLimitSeconds()),
        });
        continue;
      }

      await runScheduledJob(message.body);
      message.ack();
    } catch (error) {
      console.error("Scheduled job failed", {
        error,
        messageId: message.id,
        type: message.body.type,
        attempts: message.attempts,
      });

      message.retry({
        delaySeconds: getRetryDelaySeconds(message.attempts),
      });
    }
  }
}
