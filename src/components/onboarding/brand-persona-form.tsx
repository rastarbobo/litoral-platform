"use client";

import React, { useState } from "react";
import { useRouter } from "next/navigation";
import {
  Card,
  PrimaryButton,
  SectionHeading,
  SectionSubheading,
} from "@/components/onboarding/shared";
import { VOICE_PRESETS, type VoicePreset } from "@/lib/brand-persona/types";

// ─── Types ─────────────────────────────────────────────────

interface BrandPersonaFormData {
  cuisinePhilosophy: string;
  voice: string;
  targetCustomer: string[];
  neighborhoodCharacter: string;
  values: string;
}

interface BrandPersonaFormProps {
  /** Pre-filled values from D1 fragment (if returning to complete) */
  initialValues?: Partial<BrandPersonaFormData>;
  /** The onboarding token for API authentication */
  token: string;
}

const TARGET_OPTIONS = [
  "Couples",
  "Families",
  "Foodies",
  "Tourists",
  "Locals",
] as const;

const TOTAL_STEPS = 5;

// ─── Component ─────────────────────────────────────────────

export function BrandPersonaForm({ initialValues, token }: BrandPersonaFormProps) {
  const router = useRouter();

  const [step, setStep] = useState(1);
  const [formData, setFormData] = useState<BrandPersonaFormData>({
    cuisinePhilosophy: initialValues?.cuisinePhilosophy ?? "",
    voice: initialValues?.voice ?? "",
    targetCustomer: initialValues?.targetCustomer ?? [],
    neighborhoodCharacter: initialValues?.neighborhoodCharacter ?? "",
    values: initialValues?.values ?? "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSkipping, setIsSkipping] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  // ── Helpers ─────────────────────────────────────────────

  function updateField<K extends keyof BrandPersonaFormData>(
    key: K,
    value: BrandPersonaFormData[K],
  ) {
    setFormData((prev) => ({ ...prev, [key]: value }));
    setServerError(null);
  }

  function toggleTarget(option: string) {
    setFormData((prev) => {
      const current = prev.targetCustomer;
      const next = current.includes(option)
        ? current.filter((t) => t !== option)
        : [...current, option];
      return { ...prev, targetCustomer: next };
    });
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setServerError(null);

    try {
      const res = await fetch("/api/onboarding/brand-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, ...formData }),
      });

      const body = await res.json() as { status: string; message?: string; data?: { nextStep?: string } };

      if (!res.ok || body.status === "error") {
        setServerError(body.message ?? "Something went wrong. Please try again.");
        setIsSubmitting(false);
        return;
      }

      const nextStep = body.data?.nextStep ?? "subscription";
      router.push(`/onboarding/${token}/${nextStep}`);
    } catch {
      setServerError("Network error. Please check your connection and try again.");
      setIsSubmitting(false);
    }
  }

  async function handleSkip() {
    setIsSkipping(true);
    setServerError(null);

    try {
      // Advance onboarding state past brand_persona so the user isn't stuck
      const res = await fetch("/api/onboarding/brand-persona/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });

      const body = await res.json() as { status: string; message?: string };

      if (!res.ok || body.status === "error") {
        setServerError(body.message ?? "Failed to skip. Please try again.");
        setIsSkipping(false);
        return;
      }

      router.push(`/onboarding/${token}/subscription`);
    } catch {
      setServerError("Network error. Please check your connection and try again.");
      setIsSkipping(false);
    }
  }

  // ── Step Renderers ──────────────────────────────────────

  const isLastStep = step === TOTAL_STEPS;
  const canAdvance = () => {
    switch (step) {
      case 1:
        return true; // all fields optional
      case 2:
        return true;
      case 3:
        return true;
      case 4:
        return true;
      case 5:
        return true;
      default:
        return false;
    }
  };

  const progressDots = Array.from({ length: TOTAL_STEPS }, (_, i) => (
    <div
      key={i}
      className={`w-2 h-2 rounded-full transition-colors ${
        i + 1 === step
          ? "bg-[#005bc1]"
          : i + 1 < step
            ? "bg-[#D1D1D6]"
            : "bg-[#E5E5E7]"
      }`}
    />
  ));

  return (
    <div className="flex flex-col items-center pt-8 px-4 md:px-8 w-full max-w-xl mx-auto font-sans">
      <div className="w-full space-y-6">
        {/* Header */}
        <div className="text-center space-y-3">
          <SectionHeading>Your Brand Voice</SectionHeading>
          <SectionSubheading>
            Help our AI adopt your restaurant&apos;s authentic tone. All questions
            are optional — you can skip or fill in later.
          </SectionSubheading>
        </div>

        {/* Progress */}
        <div className="flex items-center justify-center gap-2">{progressDots}</div>
        <p className="text-center text-[13px] text-[#717786]">
          Step {step} of {TOTAL_STEPS}
        </p>

        {/* Step Content */}
        <Card className="w-full">
          {step === 1 && (
            <StepWrapper>
              <label className="text-[17px] font-semibold text-[#1a1b1f] block mb-3">
                In one sentence, what makes your food special?
              </label>
              <textarea
                value={formData.cuisinePhilosophy}
                onChange={(e) => updateField("cuisinePhilosophy", e.target.value)}
                placeholder="e.g., We serve the freshest catch from Nazaré, grilled over open flames with recipes passed down three generations."
                rows={3}
                className="w-full px-3 py-2.5 bg-white border border-[#D1D1D6] rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20 resize-none"
              />
            </StepWrapper>
          )}

          {step === 2 && (
            <StepWrapper>
              <label className="text-[17px] font-semibold text-[#1a1b1f] block mb-3">
                What&apos;s your restaurant&apos;s voice?
              </label>
              <div className="flex flex-col gap-2">
                {VOICE_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    onClick={() => updateField("voice", preset)}
                    className={`px-4 py-3 text-left text-[16px] rounded-[8px] border transition-colors ${
                      formData.voice === preset
                        ? "border-[#005bc1] bg-[#005bc1]/5 text-[#005bc1] font-medium"
                        : "border-[#D1D1D6] text-[#1a1b1f] hover:border-[#005bc1]/30"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <div className="mt-2">
                  <input
                    type="text"
                    value={
                      VOICE_PRESETS.includes(formData.voice as VoicePreset)
                        ? ""
                        : formData.voice
                    }
                    onChange={(e) => updateField("voice", e.target.value)}
                    placeholder="Or write your own…"
                    className="w-full px-3 py-2.5 bg-white border border-[#D1D1D6] rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20"
                  />
                </div>
              </div>
            </StepWrapper>
          )}

          {step === 3 && (
            <StepWrapper>
              <label className="text-[17px] font-semibold text-[#1a1b1f] block mb-3">
                Who sits at your best table?
              </label>
              <p className="text-[15px] text-[#717786] mb-3">
                Select all that apply.
              </p>
              <div className="flex flex-wrap gap-2">
                {TARGET_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    onClick={() => toggleTarget(option)}
                    className={`px-4 py-2 text-[15px] rounded-[8px] border transition-colors ${
                      formData.targetCustomer.includes(option)
                        ? "border-[#005bc1] bg-[#005bc1] text-white font-medium"
                        : "border-[#D1D1D6] text-[#1a1b1f] hover:border-[#005bc1]/30"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </StepWrapper>
          )}

          {step === 4 && (
            <StepWrapper>
              <label className="text-[17px] font-semibold text-[#1a1b1f] block mb-3">
                Describe your neighborhood in three words
              </label>
              <input
                type="text"
                value={formData.neighborhoodCharacter}
                onChange={(e) => updateField("neighborhoodCharacter", e.target.value)}
                placeholder="e.g., Seaside, historic, lively"
                className="w-full px-3 py-2.5 bg-white border border-[#D1D1D6] rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20"
              />
            </StepWrapper>
          )}

          {step === 5 && (
            <StepWrapper>
              <label className="text-[17px] font-semibold text-[#1a1b1f] block mb-3">
                What do you want people to feel when they see your posts?
              </label>
              <textarea
                value={formData.values}
                onChange={(e) => updateField("values", e.target.value)}
                placeholder="e.g., Hungry. Welcome. Like they're already sitting at a table with an ocean view."
                rows={4}
                className="w-full px-3 py-2.5 bg-white border border-[#D1D1D6] rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20 resize-none"
              />
            </StepWrapper>
          )}
        </Card>

        {/* Server error */}
        {serverError && (
          <div className="p-3 bg-[#ffdad6] border border-[#ba1a1a]/20 rounded-[8px] text-[15px] text-[#ba1a1a] text-center">
            {serverError}
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            className={`px-4 py-2.5 text-[15px] font-medium rounded-[12px] transition-colors ${
              step === 1
                ? "text-[#D1D1D6] cursor-not-allowed"
                : "text-[#005bc1] hover:bg-[#005bc1]/5"
            }`}
          >
            ← Back
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSkip}
              disabled={isSkipping}
              className="px-4 py-2.5 text-[15px] text-[#717786] hover:text-[#414755] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSkipping ? "Skipping…" : "Skip for now"}
            </button>

            {isLastStep ? (
              <PrimaryButton
                onClick={handleSubmit}
                disabled={isSubmitting || isSkipping}
                className="!px-6"
              >
                {isSubmitting ? "Saving…" : "Save & Continue"}
              </PrimaryButton>
            ) : (
              <PrimaryButton
                onClick={() => setStep((s) => Math.min(TOTAL_STEPS, s + 1))}
                disabled={!canAdvance() || isSkipping}
                className="!px-6"
              >
                Next →
              </PrimaryButton>
            )}
          </div>
        </div>

        {/* Footer */}
        <p className="text-center text-[13px] text-[#717786]">
          Your answers help our AI craft authentic, on-brand content. You can
          update these anytime from the dashboard.
        </p>
      </div>
    </div>
  );
}

// ─── Step Wrapper ──────────────────────────────────────────

function StepWrapper({ children }: { children: React.ReactNode }) {
  return <div className="py-2">{children}</div>;
}