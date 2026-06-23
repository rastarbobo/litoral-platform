import { NextRequest, NextResponse } from "next/server";
import { runOfflineMonitor } from "@/services/extension-offline-monitor";

/**
 * GET /api/cron/extension-offline-monitor
 *
 * Cloudflare Worker cron endpoint — runs every 30 minutes via Wrangler cron trigger.
 *
 * Detects campaigns in 'approved' status that have been sitting for >90 minutes
 * without being claimed, indicating the Chrome Extension is offline.
 *
 * Alert logic:
 * - >90 min: Owner Telegram alert (throttled: 1 per 24h)
 * - >120 min: P1 operator alert (throttled: 1 per 6h)
 *
 * Secured by Cloudflare Cron Trigger header validation.
 */
export async function GET(req: NextRequest) {
  if (req.headers.get("x-cron-trigger") !== "true") {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await runOfflineMonitor();
    return NextResponse.json({
      status: "success",
      data: result,
    });
  } catch (err) {
    console.error("Extension offline monitor: error", { error: err });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Monitor failed" },
      { status: 500 },
    );
  }
}