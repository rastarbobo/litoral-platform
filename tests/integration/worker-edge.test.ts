/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { CF_CONTEXT_FIELDS } from "@/utils/cf-context-fields";
import {
  CLIENT_IP_HEADERS_TO_STRIP,
  TRUSTED_CLIENT_IP_HEADER,
} from "@/utils/trusted-client-ip";

const innerFetchMock = vi.hoisted(() => vi.fn());

vi.mock("vinext/cloudflare", () => ({
  KVCacheHandler: class KVCacheHandler {
    constructor(
      readonly kv: unknown,
      readonly options: unknown,
    ) {}
  },
}));

vi.mock("vinext/server/app-router-entry", () => ({
  default: {
    fetch: innerFetchMock,
  },
}));

vi.mock("vinext/server/image-optimization", () => ({
  DEFAULT_DEVICE_SIZES: [640],
  DEFAULT_IMAGE_SIZES: [128],
  IMAGE_OPTIMIZATION_PATH: "/_vinext/image",
  handleImageOptimization: vi.fn(),
}));

vi.mock("vinext/shims/cache", () => ({
  setCacheHandler: vi.fn(),
}));

const { default: worker } = await import("../../worker-entrypoint");

describe("worker edge integration", () => {
  beforeEach(() => {
    innerFetchMock.mockReset();
    innerFetchMock.mockImplementation(async (request: Request) => {
      const headers = Object.fromEntries(
        [
          TRUSTED_CLIENT_IP_HEADER,
          "cf-connecting-ip",
          "x-forwarded-for",
          ...CF_CONTEXT_FIELDS.map(({ header }) => header),
        ].map((header) => [header, request.headers.get(header)])
      );

      return Response.json({ headers });
    });
  });

  test("health endpoint short-circuits before the Vinext app handler", async () => {
    const response = await worker.fetch(
      new Request("https://example.com/_worker/health"),
      env as Env,
      createExecutionContext()
    );

    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(innerFetchMock).not.toHaveBeenCalled();
  });

  test("normal requests strip spoofed client headers and forward trusted Cloudflare context", async () => {
    const request = new Request("https://example.com/dashboard", {
      headers: {
        [TRUSTED_CLIENT_IP_HEADER]: "192.0.2.10",
        "cf-connecting-ip": "203.0.113.42",
        "x-forwarded-for": "198.51.100.12",
        "cf-ipcity": "Spoofed City",
        "cf-ipcountry": "ZZ",
        "x-cf-asn": "0",
      },
    });

    Object.defineProperty(request, "cf", {
      configurable: true,
      value: {
        asn: 64512,
        city: "Berlin",
        country: "DE",
        isEUCountry: true,
      },
    });

    const response = await worker.fetch(
      request,
      env as Env,
      createExecutionContext()
    );
    const body = await response.json() as {
      headers: Record<string, string | null>;
    };

    expect(innerFetchMock).toHaveBeenCalledOnce();
    expect(body.headers[TRUSTED_CLIENT_IP_HEADER]).toBe("203.0.113.42");
    expect(body.headers["cf-ipcity"]).toBe("Berlin");
    expect(body.headers["cf-ipcountry"]).toBe("DE");
    expect(body.headers["x-cf-asn"]).toBe("64512");
    expect(body.headers["x-cf-is-eu-country"]).toBe("true");

    for (const header of CLIENT_IP_HEADERS_TO_STRIP) {
      if (header === TRUSTED_CLIENT_IP_HEADER) continue;
      expect(body.headers[header] ?? null).toBeNull();
    }
  });

  test("opt-out endpoint reads from KV", async () => {
    // Seed KV
    await (env.OPT_OUT_KV as any).put("opt_out:res_123", "some_date");

    const response = await worker.fetch(
      new Request("https://example.com/api/prospects/res_123/opt-out"),
      env as Env,
      createExecutionContext()
    );

    await expect(response.json()).resolves.toEqual({
      optedOut: true,
      prospectId: "res_123",
    });

    const notOptedOut = await worker.fetch(
      new Request("https://example.com/api/prospects/res_456/opt-out"),
      env as Env,
      createExecutionContext()
    );

    await expect(notOptedOut.json()).resolves.toEqual({
      optedOut: false,
      prospectId: "res_456",
    });
  });

  test("reply webhook triggers state transition", async () => {
    // We must clear prospect_events and restaurants first to avoid constraint errors
    await env.NEXT_TAG_CACHE_D1.batch([
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM prospect_events"),
      env.NEXT_TAG_CACHE_D1.prepare("DELETE FROM restaurants"),
    ]);

    const { getDB } = await import("@/db");
    const { restaurantsTable } = await import("@/db/schema");
    const db = getDB();
    await db.insert(restaurantsTable).values({
      id: "res_reply_wh",
      name: "WH Restaurant",
      behavioralState: 2,
    }).execute();

    const request = new Request("https://example.com/api/webhooks/reply", {
      method: "POST",
      headers: { 
        "content-type": "application/json",
        "Authorization": `Bearer test-secret`
      },
      body: JSON.stringify({ prospectId: "res_reply_wh" }),
    });

    const mockEnv = {
      ...env,
      REPLY_WEBHOOK_SECRET: "test-secret"
    };

    const response = await worker.fetch(request, mockEnv as unknown as Env, createExecutionContext());
    const data = await response.json();
    
    expect(response.status).toBe(200);
    expect((data as any).success).toBe(true);
    expect((data as any).result.type).toBe("SUCCESS");

    // Verify D1 state is 5
    const dbRes = await env.NEXT_TAG_CACHE_D1.prepare("SELECT behavioral_state FROM restaurants WHERE id = ?").bind("res_reply_wh").first();
    expect(dbRes?.behavioral_state).toBe(5);
  });
});
