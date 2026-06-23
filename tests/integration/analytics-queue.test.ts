import { describe, it, expect, beforeEach, vi } from "vitest";
import { handleAnalyticsQueue } from "@/lib/scheduler/analytics-queue";
import { analyticsRepo } from "@/db/repositories/analytics-repository";

describe("Analytics Queue Consumer Integration", () => {
  // Create a minimal mock for MessageBatch
  function createMockMessageBatch(
    messages: Array<{ prospectId: string; eventType: string; metadata?: Record<string, unknown> }>,
  ) {
    const ackMocks: Array<ReturnType<typeof vi.fn>> = [];
    const retryMocks: Array<ReturnType<typeof vi.fn>> = [];

    const batch = {
      queue: "test-analytics",
      messages: messages.map((body, idx) => {
        const ack = vi.fn();
        const retry = vi.fn();
        ackMocks.push(ack);
        retryMocks.push(retry);
        return {
          id: `msg-${idx}`,
          body,
          attempts: 1,
          ack,
          retry,
        };
      }),
    } as unknown as MessageBatch<{ prospectId: string; eventType: string; metadata?: Record<string, unknown> }>;

    return { batch, ackMocks, retryMocks };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should ack messages that are successfully recorded", async () => {
    vi.spyOn(analyticsRepo, "recordEvent").mockResolvedValue({ data: {} as never });

    const { batch, ackMocks, retryMocks } = createMockMessageBatch([
      { prospectId: "p1", eventType: "page_visit" },
      { prospectId: "p2", eventType: "click" },
    ]);

    await handleAnalyticsQueue(batch);

    // All messages should be acked, none retried
    ackMocks.forEach(m => expect(m).toHaveBeenCalledOnce());
    retryMocks.forEach(m => expect(m).not.toHaveBeenCalled());
  });

  it("should retry messages when recordEvent returns an error", async () => {
    vi.spyOn(analyticsRepo, "recordEvent")
      .mockResolvedValueOnce({ error: "DB error" })
      .mockResolvedValueOnce({ data: {} as never });

    const { batch, ackMocks, retryMocks } = createMockMessageBatch([
      { prospectId: "p1", eventType: "page_visit" },
      { prospectId: "p2", eventType: "click" },
    ]);

    await handleAnalyticsQueue(batch);

    // First message should be retried (error path)
    expect(retryMocks[0]).toHaveBeenCalled();
    // Second message should be acked (success)
    expect(ackMocks[1]).toHaveBeenCalledOnce();
  });

  it("should retry with backoff when recordEvent throws", async () => {
    vi.spyOn(analyticsRepo, "recordEvent").mockRejectedValue(new Error("Boom"));

    const { batch, ackMocks, retryMocks } = createMockMessageBatch([
      { prospectId: "p1", eventType: "page_visit" },
    ]);
    // Override attempts to simulate a retry
    (batch.messages[0] as { attempts: number }).attempts = 3;

    await handleAnalyticsQueue(batch);

    expect(ackMocks[0]).not.toHaveBeenCalled();
    expect(retryMocks[0]).toHaveBeenCalledWith({ delaySeconds: 90 }); // 30 * 3
  });

  it("should pass metadata correctly to recordEvent", async () => {
    const spy = vi.spyOn(analyticsRepo, "recordEvent").mockResolvedValue({ data: {} as never });

    const { batch, ackMocks } = createMockMessageBatch([
      { prospectId: "p1", eventType: "scroll", metadata: { scroll_depth: 75, path: "/landing" } },
    ]);

    await handleAnalyticsQueue(batch);

    expect(spy).toHaveBeenCalledWith("p1", "scroll", { scroll_depth: 75, path: "/landing" });
    expect(ackMocks[0]).toHaveBeenCalledOnce();
  });
});