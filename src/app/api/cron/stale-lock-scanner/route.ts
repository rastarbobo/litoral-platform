import { NextRequest, NextResponse } from "next/server";
import { runStaleLockScanner } from "@/services/stale-lock-scanner";

/**
 * GET /api/cron/stale-lock-scanner
 *
 * Cloudflare Worker cron endpoint — runs every 30 minutes via Wrangler cron trigger.
 *
 * Finds campaigns in 'pending_schedule' state with claimed_at > 20 minutes ago
 * and no scheduled_at set, then reverts them to 'approved' + sends P1 operator alert.
 *
 * Secured by Cloudflare Cron Trigger header validation.
 */
export async function GET(req: NextRequest) {
  // Validate cron trigger: only Cloudflare Cron can call this
  if (req.headers.get("x-cron-trigger") !== "true") {
    return NextResponse.json(
      { status: "error", message: "Unauthorized" },
      { status: 401 },
    );
  }

  try {
    const result = await runStaleLockScanner();
    return NextResponse.json({
      status: "success",
      data: result,
    });
  } catch (err) {
    console.error("Stale lock scanner: error", { error: err });
    return NextResponse.json(
      { status: "error", message: err instanceof Error ? err.message : "Scanner failed" },
      { status: 500 },
    );
  }
}
