import React from "react";
import { Card } from "@/components/onboarding/shared";

/**
 * Graceful expired/invalid magic link card.
 *
 * Renders when the onboarding magic link is expired, already used,
 * or invalid. Displays a centered Cupertino Logic card with a Telegram
 * deep-link CTA (Telegram is the only channel to request a new link).
 */
export function ExpiredLinkCard() {
  return (
    <div
      aria-labelledby="expired-link-title"
      className="flex flex-col items-center justify-center pt-16 px-4 md:px-8 w-full max-w-xl mx-auto font-sans"
    >
      <Card className="w-full text-center flex flex-col items-center gap-6 py-10 px-6">
        {/* Clock icon */}
        <div className="w-16 h-16 rounded-full bg-[#f4f3f8] flex items-center justify-center text-[#717786] mb-2">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="32"
            height="32"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <polyline points="12 6 12 12 16 14" />
          </svg>
        </div>

        <div className="space-y-3">
          <h1
            id="expired-link-title"
            className="text-[28px] font-bold leading-[34px] tracking-[-0.02em] text-[#1a1b1f]"
          >
            This link has expired
          </h1>
          <p className="text-[#414755] text-[17px] leading-[24px] max-w-sm mx-auto">
            Onboarding links are single-use and expire after 7 days. To get a new
            link, message us on Telegram — we&apos;ll send one right away.
          </p>
        </div>

        <a
          href="https://t.me/LitoralAgencyBot"
          target="_blank"
          rel="noopener noreferrer"
          className="w-full sm:w-auto mt-4 px-8 py-[14px] bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[17px] font-semibold rounded-[12px] shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#005bc1] focus-visible:ring-offset-2 block"
        >
          Request a New Link
        </a>
      </Card>
    </div>
  );
}