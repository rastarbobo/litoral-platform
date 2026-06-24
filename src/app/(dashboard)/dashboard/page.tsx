import React from "react";

import { cookies } from "next/headers";
import { getDB } from "@/db";
import { restaurantsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { DashboardClient } from "@/components/dashboard/dashboard-client";

/**
 * Dashboard Page — Server Component for SSR.
 *
 * Handles session validation via cookie, renders initial data server-side.
 * Falls back to client-side auth for magic link hash-fragment tokens.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ rid?: string; t?: string }>;
}) {
  // Attempt server-side session resolution via cookie
  const session = await resolveServerSession();

  if (session) {
    // Server-rendered authenticated view
    return <DashboardClient initialRestaurantId={session.restaurantId} />;
  }

  // Check for magic-link params (if present, client will handle them)
  const params = await searchParams;
  const hasMagicLinkParams = Boolean(params.rid && params.t);

  if (hasMagicLinkParams) {
    // Client-side auth guard will handle hash fragment validation
    return <DashboardClient />;
  }

  // No session, no magic link — show the client which will show RequestAccessCard
  return <DashboardClient />;
}

// ─── Server Session Resolution ─────────────────────────

interface ServerSession {
  restaurantId: string;
}

async function resolveServerSession(): Promise<ServerSession | null> {
  try {
    const cookieStore = await cookies();
    const sessionCookie = cookieStore.get("litoral_dashboard_session");

    if (!sessionCookie) return null;

    const parsed = JSON.parse(sessionCookie.value) as { restaurantId: string; token: string };
    if (!parsed.restaurantId || !parsed.token) return null;

    // Validate restaurant exists
    const db = getDB();
    const row = await db
      .select({ id: restaurantsTable.id })
      .from(restaurantsTable)
      .where(eq(restaurantsTable.id, parsed.restaurantId));

    if (!row || row.length === 0) return null;

    return { restaurantId: parsed.restaurantId };
  } catch {
    return null;
  }
}
