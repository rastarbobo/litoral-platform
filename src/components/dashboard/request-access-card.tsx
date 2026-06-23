"use client";

import React from "react";
import { MessageCircle } from "lucide-react";

/**
 * Request Access Card — shown when auth fails or no valid session exists.
 * Provides Telegram deep-link to request a new magic link.
 */
export function RequestAccessCard() {
  const TELEGRAM_BOT_USERNAME =
    process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME || "LitoralAgencyBot";
  const deepLink = `https://t.me/${TELEGRAM_BOT_USERNAME}?start=dashboard`;

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-[#F5F5F7]">
      <div
        className="w-full max-w-sm bg-white rounded-xl border border-[#E5E5E7]
                   shadow-[0px_4px_12px_rgba(0,0,0,0.05)] p-6 text-center"
      >
        <div className="w-12 h-12 mx-auto mb-4 rounded-full bg-[#d8e2ff] flex items-center justify-center">
          <MessageCircle className="w-6 h-6 text-[#0058bc]" />
        </div>

        <h2
          className="text-[22px] font-semibold text-[#1a1b1f] mb-2"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "28px" }}
        >
          Access Your Dashboard
        </h2>

        <p
          className="text-[16px] text-[#717786] mb-6 leading-[21px]"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          Request a secure access link through Telegram to view your campaigns, results, and settings.
        </p>

        <a
          href={deepLink}
          className="block w-full py-3 px-4 text-center text-white rounded-xl
                     bg-[#0058bc] active:bg-[#004493] touch-manipulation
                     text-[17px] font-semibold transition-colors"
          style={{ fontFamily: "Inter, sans-serif", lineHeight: "22px" }}
        >
          Request Access via Telegram
        </a>

        <p
          className="text-[13px] text-[#717786] mt-4 leading-[18px]"
          style={{ fontFamily: "Inter, sans-serif" }}
        >
          This keeps your account secure — no passwords needed.
        </p>
      </div>
    </div>
  );
}
