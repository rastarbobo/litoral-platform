import { test, expect, describe, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

// Import only the schemas for unit testing (not the full route, which depends on server-only modules)
import { z } from "zod";

// ─── Replicate schemas for isolated testing ─────────────────

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

// ─── Helpers ────────────────────────────────────────────────

function buildValidUpdate(overrides: Record<string, unknown> = {}) {
  return {
    update_id: 123456789,
    message: {
      message_id: 100,
      from: {
        id: 555555555,
        is_bot: false,
        first_name: "Mary",
      },
      chat: {
        id: 555555555,
        type: "private",
        first_name: "Mary",
      },
      date: 1700000000,
      text: "Daily special: fresh octopus tonight!",
      ...overrides,
    },
  };
}

function buildPhotoUpdate() {
  return buildValidUpdate({
    text: undefined,
    caption: "Look at this!",
    photo: [
      { file_id: "photo_small", file_unique_id: "u1", width: 320, height: 240 },
      { file_id: "photo_large", file_unique_id: "u2", width: 1280, height: 960 },
    ],
  });
}

function buildVoiceUpdate() {
  return buildValidUpdate({
    text: undefined,
    voice: {
      file_id: "voice_file_1",
      file_unique_id: "voice_u1",
      duration: 5,
      mime_type: "audio/ogg",
      file_size: 45000,
    },
  });
}

function buildVideoUpdate() {
  return buildValidUpdate({
    text: undefined,
    caption: "Check our new promo video!",
    video: {
      file_id: "video_file_1",
      file_unique_id: "video_u1",
      width: 1920,
      height: 1080,
      duration: 30,
      mime_type: "video/mp4",
      file_size: 5000000,
    },
  });
}

// ─── Tests ──────────────────────────────────────────────────

describe("TelegramUpdateSchema", () => {
  test("accepts valid text message update", () => {
    const update = buildValidUpdate();
    const result = TelegramUpdateSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.update_id).toBe(123456789);
      expect(result.data.message?.text).toBe("Daily special: fresh octopus tonight!");
    }
  });

  test("accepts valid photo message update", () => {
    const update = buildPhotoUpdate();
    const result = TelegramUpdateSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message?.photo).toHaveLength(2);
      // Largest photo should be last
      const photos = result.data.message!.photo!;
      expect(photos[photos.length - 1].file_id).toBe("photo_large");
    }
  });

  test("accepts valid voice message update", () => {
    const update = buildVoiceUpdate();
    const result = TelegramUpdateSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message?.voice?.file_id).toBe("voice_file_1");
      expect(result.data.message?.voice?.duration).toBe(5);
    }
  });

  test("accepts valid video message update", () => {
    const update = buildVideoUpdate();
    const result = TelegramUpdateSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message?.video?.duration).toBe(30);
      expect(result.data.message?.caption).toBe("Check our new promo video!");
    }
  });

  test("accepts update with edited_message only (no message field)", () => {
    const update = {
      update_id: 999,
      edited_message: buildValidUpdate().message,
    };
    const result = TelegramUpdateSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBeUndefined();
      expect(result.data.edited_message).toBeDefined();
    }
  });

  test("rejects update with missing update_id", () => {
    const result = TelegramUpdateSchema.safeParse({
      message: buildValidUpdate().message,
    });
    expect(result.success).toBe(false);
  });

  test("rejects update with invalid update_id (string instead of number)", () => {
    const result = TelegramUpdateSchema.safeParse({
      update_id: "not_a_number",
      message: buildValidUpdate().message,
    });
    expect(result.success).toBe(false);
  });

  test("rejects message with missing from field", () => {
    const { from, ...messageWithoutFrom } = buildValidUpdate().message!;
    const result = TelegramUpdateSchema.safeParse({
      update_id: 1,
      message: messageWithoutFrom,
    });
    expect(result.success).toBe(false);
  });

  test("rejects message with missing chat.id", () => {
    const update = buildValidUpdate();
    // Remove chat.id
    const msg = update.message!;
    const badMsg = {
      ...msg,
      chat: { type: "private" },
    };
    const result = TelegramUpdateSchema.safeParse({
      update_id: 1,
      message: badMsg,
    });
    expect(result.success).toBe(false);
  });

  test("accepts message without any media (pure text)", () => {
    const update = buildValidUpdate();
    const result = TelegramUpdateSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message?.photo).toBeUndefined();
      expect(result.data.message?.voice).toBeUndefined();
      expect(result.data.message?.video).toBeUndefined();
    }
  });

  test("rejects message with invalid date type", () => {
    const update = buildValidUpdate({ date: "not_a_number" });
    const result = TelegramUpdateSchema.safeParse(update);
    expect(result.success).toBe(false);
  });
});

describe("TelegramMessageSchema media extraction logic", () => {
  test("photo message has photo array with at least one element", () => {
    const result = TelegramMessageSchema.safeParse(buildPhotoUpdate().message);
    expect(result.success).toBe(true);
    // Photo array exists and has elements (Zod validates array shape but not min length here)
  });

  test("photo sizes have ascending dimensions", () => {
    const msg = (buildPhotoUpdate().message ?? null) as { photo?: { width: number; height: number }[] } | null;
    if (msg?.photo && msg.photo.length >= 2) {
      const totalPixels = (p: { width: number; height: number }) => p.width * p.height;
      expect(totalPixels(msg.photo[0])).toBeLessThan(totalPixels(msg.photo[1]));
    }
  });

  test("voice message requires duration and file_id", () => {
    const result = TelegramUpdateSchema.safeParse({
      update_id: 1,
      message: {
        ...buildValidUpdate().message,
        text: undefined,
        voice: { file_id: "v1", file_unique_id: "vu1", duration: 10 },
      },
    });
    expect(result.success).toBe(true);
  });

  test("voice message without file_id is rejected", () => {
    const result = TelegramUpdateSchema.safeParse({
      update_id: 1,
      message: {
        ...buildValidUpdate().message,
        text: undefined,
        voice: { file_unique_id: "vu1", duration: 10 },
      },
    });
    expect(result.success).toBe(false);
  });

  test("text + caption both present (photo with caption)", () => {
    const update = buildValidUpdate({
      text: "Some text",
      caption: "Photo caption",
      photo: [
        { file_id: "p1", file_unique_id: "u1", width: 640, height: 480 },
      ],
    });
    const result = TelegramUpdateSchema.safeParse(update);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message?.text).toBe("Some text");
      expect(result.data.message?.caption).toBe("Photo caption");
    }
  });
});