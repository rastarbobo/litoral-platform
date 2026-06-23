"use client";

import React, { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";
import {
  Card,
  PrimaryButton,
  SectionHeading,
  SectionSubheading,
} from "@/components/onboarding/shared";
import { VOICE_PRESETS, type VoicePreset } from "@/lib/brand-persona/types";
import type { BrandPersonaFull } from "@/lib/brand-persona/types";
import { useDashboardStore } from "@/store/dashboard-store";

// ─── Types ─────────────────────────────────────────────────

interface BrandPersonaDashboardEditorProps {
  initialPersona: BrandPersonaFull | null;
  restaurantId: string;
  slug: string;
}

const TARGET_OPTIONS = [
  "Couples",
  "Families",
  "Foodies",
  "Tourists",
  "Locals",
] as const;

// ─── Constants ─────────────────────────────────────────────

const INITIAL_VALUES: Record<string, string | string[]> = {
  cuisinePhilosophy: "",
  voice: "",
  targetCustomer: [],
  neighborhoodCharacter: "",
  values: "",
};

function getInitialValues(persona: BrandPersonaFull | null) {
  return {
    cuisinePhilosophy: persona?.cuisine_philosophy ?? "",
    voice: persona?.voice ?? "",
    targetCustomer: persona?.target_customer ?? [],
    neighborhoodCharacter: persona?.neighborhood_character ?? "",
    values: persona?.values ?? "",
  };
}

// ─── Component ─────────────────────────────────────────────

export function BrandPersonaDashboardEditor({
  initialPersona,
  restaurantId,
  slug,
}: BrandPersonaDashboardEditorProps) {
  const router = useRouter();
  const setPersonaUpdatedAt = useDashboardStore((s) => s.setPersonaUpdatedAt);
  const setPersonaFormDirty = useDashboardStore((s) => s.setPersonaFormDirty);

  const initialValues = getInitialValues(initialPersona);
  const isFirstEdit = !initialPersona;

  const [cuisinePhilosophy, setCuisinePhilosophy] = useState(initialValues.cuisinePhilosophy);
  const [voice, setVoice] = useState(initialValues.voice);
  const [targetCustomer, setTargetCustomer] = useState<string[]>(initialValues.targetCustomer as string[]);
  const [neighborhoodCharacter, setNeighborhoodCharacter] = useState(initialValues.neighborhoodCharacter);
  const [values, setValues] = useState(initialValues.values);
  const [isSaving, setIsSaving] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  // Track dirty state: any field differs from initial
  const isDirty =
    cuisinePhilosophy !== initialValues.cuisinePhilosophy ||
    voice !== initialValues.voice ||
    JSON.stringify(targetCustomer.sort()) !== JSON.stringify((initialValues.targetCustomer as string[]).sort()) ||
    neighborhoodCharacter !== initialValues.neighborhoodCharacter ||
    values !== initialValues.values;

  // Sync dirty state with store
  useEffect(() => {
    setPersonaFormDirty(isDirty);
  }, [isDirty, setPersonaFormDirty]);

  // Warn on browser back/refresh while dirty
  useEffect(() => {
    if (!isDirty) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isDirty]);

  function toggleTarget(option: string) {
    setTargetCustomer((prev) =>
      prev.includes(option)
        ? prev.filter((t) => t !== option)
        : [...prev, option],
    );
  }

  async function handleSave() {
    setIsSaving(true);

    const savePromise = (async () => {
      const res = await fetch("/api/dashboard/brand-persona", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          restaurantId,
          slug,
          cuisinePhilosophy,
          voice,
          targetCustomer,
          neighborhoodCharacter,
          values,
        }),
      });

      const body = (await res.json()) as { status: string; message?: string; data?: unknown };

      if (!res.ok || body.status === "error") {
        throw new Error(body.message ?? "Failed to save. Please try again.");
      }

      return body;
    })();

    toast.promise(savePromise, {
      loading: "Saving brand persona…",
      success: () => {
        setPersonaUpdatedAt(Date.now());
        setPersonaFormDirty(false);
        return "Brand persona saved — will be used for your next campaign generation";
      },
      error: (err) => {
        setIsSaving(false);
        return (err as Error).message ?? "Network error. Please check your connection.";
      },
      finally: () => {
        setIsSaving(false);
      },
    });
  }

  function handleBack() {
    if (isDirty) {
      setShowDiscardDialog(true);
    } else {
      router.back();
    }
  }

  function confirmDiscard() {
    setShowDiscardDialog(false);
    setPersonaFormDirty(false);
    router.back();
  }

  return (
    <div className="flex flex-col items-center pt-8 px-4 md:px-8 w-full max-w-2xl mx-auto font-sans">
      <div className="w-full space-y-6">
        {/* Back button */}
        <button
          type="button"
          onClick={handleBack}
          className="flex items-center gap-1 text-[15px] text-[#005bc1] font-medium hover:text-[#0070eb] transition-colors touch-manipulation"
        >
          <ChevronLeftIcon className="w-5 h-5" />
          Settings
        </button>

        {/* Header */}
        <div className="text-center space-y-3">
          <SectionHeading>Brand Persona</SectionHeading>
          <SectionSubheading>
            Update how your restaurant sounds and feels in every post. Changes
            take effect on the next campaign generation cycle.
          </SectionSubheading>
        </div>

        {/* First-edit guidance banner */}
        {isFirstEdit && (
          <div className="p-4 bg-[#005bc1]/5 border border-[#005bc1]/20 rounded-[12px] text-center">
            <p className="text-[15px] font-medium text-[#005bc1]">
              Your Brand Persona helps the AI write posts that sound like you — fill it out once and every campaign gets smarter.
            </p>
          </div>
        )}

        {/* Form */}
        <Card className="w-full">
          <div className="flex flex-col gap-6">
            {/* Cuisine Philosophy */}
            <div>
              <label htmlFor="cuisine-philosophy" className="text-[17px] font-semibold text-[#1a1b1f] block mb-2">
                Cuisine Philosophy
              </label>
              <textarea
                id="cuisine-philosophy"
                value={cuisinePhilosophy}
                onChange={(e) => setCuisinePhilosophy(e.target.value)}
                placeholder="In one sentence, what makes your food special?"
                rows={3}
                className="w-full px-3 py-2.5 bg-white border border-[#D1D1D6] rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20 resize-none"
              />
            </div>

            {/* Voice */}
            <div>
              <label className="text-[17px] font-semibold text-[#1a1b1f] block mb-2">
                Voice &amp; Tone
              </label>
              <div className="flex flex-col gap-2">
                {VOICE_PRESETS.map((preset) => (
                  <button
                    type="button"
                    key={preset}
                    onClick={() => setVoice(preset)}
                    className={`px-4 py-3 text-left text-[16px] rounded-[8px] border transition-colors min-h-[44px] ${
                      voice === preset
                        ? "border-[#005bc1] bg-[#005bc1]/5 text-[#005bc1] font-medium"
                        : "border-[#D1D1D6] text-[#1a1b1f] hover:border-[#005bc1]/30"
                    }`}
                  >
                    {preset}
                  </button>
                ))}
                <label htmlFor="custom-voice" className="sr-only">Custom voice & tone</label>
                <input
                  id="custom-voice"
                  type="text"
                  value={
                    VOICE_PRESETS.includes(voice as VoicePreset) ? "" : voice
                  }
                  onChange={(e) => setVoice(e.target.value)}
                  placeholder="Or write your own…"
                  className="w-full px-3 py-2.5 bg-white border border-[#D1D1D6] rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20 mt-2"
                />
              </div>
            </div>

            {/* Target Customer */}
            <div>
              <label className="text-[17px] font-semibold text-[#1a1b1f] block mb-2">
                Target Customer
              </label>
              <div className="flex flex-wrap gap-2">
                {TARGET_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option}
                    onClick={() => toggleTarget(option)}
                    className={`px-4 py-2 text-[15px] rounded-[8px] border transition-colors min-h-[44px] ${
                      targetCustomer.includes(option)
                        ? "border-[#005bc1] bg-[#005bc1] text-white font-medium"
                        : "border-[#D1D1D6] text-[#1a1b1f] hover:border-[#005bc1]/30"
                    }`}
                  >
                    {option}
                  </button>
                ))}
              </div>
            </div>

            {/* Neighborhood Character */}
            <div>
              <label htmlFor="neighborhood-character" className="text-[17px] font-semibold text-[#1a1b1f] block mb-2">
                Neighborhood Character
              </label>
              <input
                id="neighborhood-character"
                type="text"
                value={neighborhoodCharacter}
                onChange={(e) => setNeighborhoodCharacter(e.target.value)}
                placeholder="Describe your neighborhood in three words"
                className="w-full px-3 py-2.5 bg-white border border-[#D1D1D6] rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20"
              />
            </div>

            {/* Values */}
            <div>
              <label htmlFor="values-field" className="text-[17px] font-semibold text-[#1a1b1f] block mb-2">
                Values &amp; Feeling
              </label>
              <textarea
                id="values-field"
                value={values}
                onChange={(e) => setValues(e.target.value)}
                placeholder="What do you want people to feel when they see your posts?"
                rows={4}
                className="w-full px-3 py-2.5 bg-white border border-[#D1D1D6] rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20 resize-none"
              />
            </div>
          </div>
        </Card>

        {/* Save button */}
        <div className="flex justify-end">
          <PrimaryButton onClick={handleSave} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save Changes"}
          </PrimaryButton>
        </div>
      </div>

      {/* Discard Changes Dialog */}
      {showDiscardDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/20 backdrop-blur-[20px]"
            onClick={() => setShowDiscardDialog(false)}
          />
          {/* Modal */}
          <div className="relative bg-white rounded-[16px] border border-[#E5E5E7] shadow-[0px_8px_24px_rgba(0,0,0,0.12)] p-6 max-w-sm w-full space-y-4">
            <h2 className="text-[17px] font-semibold text-[#1a1b1f]">Discard Changes?</h2>
            <p className="text-[15px] text-[#414755]">
              You have unsaved changes to your Brand Persona.
            </p>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setShowDiscardDialog(false)}
                className="w-full px-4 py-[12px] bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[17px] font-semibold rounded-[12px] transition-colors min-h-[44px]"
              >
                Keep Editing
              </button>
              <button
                type="button"
                onClick={confirmDiscard}
                className="w-full px-4 py-[12px] bg-transparent hover:bg-[#ffdad6]/50 text-[#ba1a1a] text-[17px] font-medium rounded-[12px] transition-colors min-h-[44px]"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Icons ─────────────────────────────────────────────────

function ChevronLeftIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <polyline points="15 18 9 12 15 6" />
    </svg>
  );
}