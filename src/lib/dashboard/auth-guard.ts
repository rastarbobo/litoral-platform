"use client";

import { type DashboardSession } from "./types";

const STORAGE_KEY = "litoral_dashboard_session";
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

interface StoredSession {
  restaurantId: string;
  token: string;
  lastVerifiedAt: number; // epoch ms
}

export interface AuthGuardResult {
  session: DashboardSession | null;
  isValid: boolean;
}

export async function resolveSession(): Promise<AuthGuardResult> {
  const urlParams = getSessionFromHashParams();

  if (urlParams) {
    const valid = await validateAndStore(urlParams.restaurantId, urlParams.token);
    if (valid) {
      return { session: { ...urlParams, expiresAt: null }, isValid: true };
    }
  }

  const stored = getStoredSession();
  if (stored) {
    const elapsed = Date.now() - stored.lastVerifiedAt;
    if (elapsed < SESSION_TIMEOUT_MS) {
      return {
        session: {
          restaurantId: stored.restaurantId,
          token: stored.token,
          expiresAt: new Date(stored.lastVerifiedAt + SESSION_TIMEOUT_MS),
        },
        isValid: true,
      };
    }

    const valid = await validateAndStore(stored.restaurantId, stored.token);
    if (valid) {
      return {
        session: {
          restaurantId: stored.restaurantId,
          token: stored.token,
          expiresAt: new Date(Date.now() + SESSION_TIMEOUT_MS),
        },
        isValid: true,
      };
    }
  }

  return { session: null, isValid: false };
}

function getSessionFromHashParams(): { restaurantId: string; token: string } | null {
  if (typeof window === "undefined") return null;

  const hash = window.location.hash.replace(/^#/, "");
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const rid = params.get("rid");
  const token = params.get("t");

  if (!rid || !token) return null;
  return { restaurantId: rid, token };
}

function getStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (!parsed.restaurantId || !parsed.token || !parsed.lastVerifiedAt) return null;
    return {
      restaurantId: parsed.restaurantId,
      token: parsed.token,
      lastVerifiedAt: parsed.lastVerifiedAt,
    };
  } catch {
    return null;
  }
}

function storeSession(restaurantId: string, token: string) {
  if (typeof window === "undefined") return;
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ restaurantId, token, lastVerifiedAt: Date.now() })
  );
}

function clearStoredSession() {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY);
}

async function validateAndStore(restaurantId: string, token: string): Promise<boolean> {
  try {
    const res = await fetch("/api/dashboard/validate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ restaurantId, token }),
    });

    const json = (await res.json()) as { status: string };

    if (json.status === "success") {
      storeSession(restaurantId, token);
      clearHashFragment();
      return true;
    }
  } catch (e) {
    console.error("Dashboard auth validation failed:", e);
  }

  clearStoredSession();
  return false;
}

function clearHashFragment() {
  if (typeof window === "undefined") return;
  history.replaceState(null, "", window.location.pathname + window.location.search);
}
