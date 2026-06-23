"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Card } from "@/components/onboarding/shared";

interface ExtensionTokenDisplayProps {
  restaurantId: string;
  initialToken: string | null;
  isSubscriptionActive: boolean;
}

/**
 * Client component for the Extension Settings page.
 *
 * Handles:
 * - Token display with show/hide toggle
 * - Copy-to-clipboard
 * - Generate token (POST /api/extension/token/generate)
 * - Regenerate token (POST /api/extension/token/generate?force=true)
 * - Confirm dialog before regeneration
 */
export function ExtensionTokenDisplay({
  restaurantId,
  initialToken,
  isSubscriptionActive,
}: ExtensionTokenDisplayProps) {
  const [token, setToken] = useState<string | null>(initialToken);
  const [isVisible, setIsVisible] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [showRegenConfirm, setShowRegenConfirm] = useState(false);

  // restaurantId is available for future use (e.g., direct API calls from client)
  void restaurantId;

  // ─── No subscription ─────────────────────────────
  if (!isSubscriptionActive) {
    return (
      <Card>
        <div className="text-center py-6">
          <p className="text-[17px] font-semibold text-[#1a1b1f] mb-2">
            Extension requires an active subscription
          </p>
          <p className="text-[15px] text-[#717786]">
            Subscribe to a plan to access the Chrome Extension publishing feature.
          </p>
        </div>
      </Card>
    );
  }

  // ─── Generate token ──────────────────────────────
  const handleGenerate = async (force: boolean) => {
    setIsGenerating(true);
    try {
      const url = force
        ? "/api/extension/token/generate?force=true"
        : "/api/extension/token/generate";

      const res = await fetch(url, { method: "POST" });
      const body = (await res.json()) as {
        status: string;
        data?: { extensionAuthToken?: string };
        message?: string;
      };

      if (!res.ok || body.status === "error") {
        toast.error(body.message ?? "Failed to generate token. Please try again.");
        return;
      }

      const newToken = body.data?.extensionAuthToken ?? null;
      setToken(newToken);
      setShowRegenConfirm(false);

      if (force) {
        toast.success("Token regenerated. Your old token is now invalid.");
      } else {
        toast.success("Extension token generated!");
      }
    } catch {
      toast.error("Network error. Please check your connection and try again.");
    } finally {
      setIsGenerating(false);
    }
  };

  // ─── Copy to clipboard ──────────────────────────
  const handleCopy = async () => {
    if (!token) return;
    try {
      await navigator.clipboard.writeText(token);
      toast.success("Token copied to clipboard!");
    } catch {
      toast.error("Failed to copy. Please copy manually.");
    }
  };

  // ─── Masked token display ────────────────────────
  const maskedToken = token
    ? token.length <= 12
      ? "•".repeat(token.length)
      : `${token.slice(0, 8)}${"•".repeat(Math.min(token.length - 12, 20))}${token.slice(-4)}`
    : null;

  // ─── No token yet ────────────────────────────────
  if (!token) {
    return (
      <Card>
        <div className="text-center py-6">
          <p className="text-[17px] font-semibold text-[#1a1b1f] mb-2">
            Connect Your Extension
          </p>
          <p className="text-[15px] text-[#717786] mb-4">
            Generate a token to connect the Litoral Agency Chrome Extension to your account.
          </p>
          <button
            type="button"
            onClick={() => handleGenerate(false)}
            disabled={isGenerating}
            className="px-8 py-[14px] bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[17px] font-semibold rounded-[12px] shadow-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px]"
          >
            {isGenerating ? "Generating…" : "Generate Token"}
          </button>
        </div>
      </Card>
    );
  }

  // ─── Token exists — show display + actions ─────────
  return (
    <Card>
      <div className="space-y-4">
        {/* Token display */}
        <div>
          <p className="text-[13px] font-semibold leading-[16px] tracking-[0.05em] uppercase text-[#717786] mb-2">
            Your Extension Token
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-[#F5F5F7] rounded-lg px-3 py-2.5 text-[15px] font-mono text-[#1a1b1f] break-all select-all">
              {isVisible ? token : maskedToken}
            </code>
            <button
              type="button"
              onClick={() => setIsVisible(!isVisible)}
              className="shrink-0 px-3 py-2 text-[13px] font-semibold text-[#0070eb] hover:bg-[#0070eb]/10 rounded-lg transition-colors"
            >
              {isVisible ? "Hide" : "Show"}
            </button>
          </div>
        </div>

        {/* Warning */}
        <div className="bg-[#FFF3CD] border border-[#E5A100] rounded-xl px-4 py-3">
          <p className="text-[13px] text-[#7A5D00] font-medium">
            ⚠️ This token grants full publishing access. Never share it. It will only be shown here.
          </p>
        </div>

        <div className="h-px bg-[#E5E5E7]" />

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={handleCopy}
            className="flex-1 px-6 py-[12px] bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[15px] font-semibold rounded-[12px] shadow-sm transition-colors min-h-[44px]"
          >
            Copy Token
          </button>

          {!showRegenConfirm ? (
            <button
              type="button"
              onClick={() => setShowRegenConfirm(true)}
              className="flex-1 px-6 py-[12px] bg-white border border-[#D1D1D6] hover:bg-[#F5F5F7] text-[#BA1A1A] text-[15px] font-semibold rounded-[12px] transition-colors min-h-[44px]"
            >
              Regenerate
            </button>
          ) : (
            <div className="flex-1 flex items-center gap-2">
              <button
                type="button"
                onClick={() => handleGenerate(true)}
                disabled={isGenerating}
                className="flex-1 px-4 py-[12px] bg-[#BA1A1A] hover:bg-[#D32F2F] text-white text-[13px] font-semibold rounded-[12px] transition-colors disabled:opacity-50 min-h-[44px]"
              >
                {isGenerating ? "Regenerating…" : "Confirm Regenerate"}
              </button>
              <button
                type="button"
                onClick={() => setShowRegenConfirm(false)}
                className="px-3 py-[12px] text-[13px] text-[#717786] hover:text-[#1a1b1f] transition-colors"
              >
                Cancel
              </button>
            </div>
          )}
        </div>

        {showRegenConfirm && (
          <p className="text-[13px] text-[#BA1A1A]">
            This will immediately disconnect any currently connected extension.
          </p>
        )}

        {/* Instructions */}
        <div className="bg-[#F5F5F7] rounded-xl p-4">
          <p className="text-[13px] font-semibold text-[#1a1b1f] mb-2">How to connect:</p>
          <ol className="list-decimal list-inside text-[13px] text-[#717786] space-y-1">
            <li>Install the Litoral Agency Chrome Extension</li>
            <li>Click the extension icon in your browser toolbar</li>
            <li>Paste this token into the &quot;Connect&quot; field</li>
            <li>Click &quot;Connect&quot; — campaigns will begin publishing automatically</li>
          </ol>
        </div>
      </div>
    </Card>
  );
}