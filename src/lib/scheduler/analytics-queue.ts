import { analyticsRepo } from "@/db/repositories/analytics-repository";

export interface AnalyticsQueueMessage {
  prospectId: string;
  eventType: string;
  metadata?: Record<string, any>;
}

export async function handleAnalyticsQueue(batch: MessageBatch<AnalyticsQueueMessage>): Promise<void> {
  for (const message of batch.messages) {
    try {
      const { prospectId, eventType, metadata } = message.body;
      const result = await analyticsRepo.recordEvent(prospectId, eventType, metadata);
      
      if (result.error) {
        console.error("Failed to record analytics event from queue", result.error);
        message.retry({ delaySeconds: 30 * Math.max(1, message.attempts) });
      } else {
        message.ack();
      }
    } catch (error) {
      console.error("Analytics job failed", {
        error,
        messageId: message.id,
        attempts: message.attempts,
      });
      message.retry({ delaySeconds: 30 * Math.max(1, message.attempts) });
    }
  }
}
