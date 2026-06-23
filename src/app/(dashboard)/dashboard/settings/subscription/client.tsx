"use client";

import { useState } from "react";
import { toast } from "sonner";

/**
 * Generic "Manage Billing" button that opens the Stripe Customer Portal
 * for full billing management (payment methods, invoices, cancellations).
 *
 * For targeted plan changes, use the individual tier cards instead.
 */
export function SubscriptionManageClient() {
  const [isLoading, setIsLoading] = useState(false);

  const handleManageBilling = async () => {
    setIsLoading(true);
    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });
      if (!res.ok) {
        const body = (await res.json()) as { message?: string };
        toast.error(body.message ?? "Failed to open billing portal.");
        setIsLoading(false);
        return;
      }

      const { data } = (await res.json()) as { data?: { url?: string } };
      if (data?.url) {
        // External redirect to Stripe hosted portal
        window.location.href = data.url;
      } else {
        toast.error("Billing portal URL not received.");
        setIsLoading(false);
      }
    } catch (err) {
      console.error("Billing portal error:", err);
      toast.error("An unexpected error occurred.");
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      disabled={isLoading}
      onClick={handleManageBilling}
      className="w-full px-8 py-[14px] bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[17px] font-semibold rounded-[12px] shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#005bc1] focus-visible:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
    >
      {isLoading ? "Opening Billing Portal…" : "Manage Billing"}
    </button>
  );
}