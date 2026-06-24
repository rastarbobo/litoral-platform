import React from "react";
import { escapeHtml, isValidImageUrl, safeStringify } from "./utils";

interface SectionProps {
  children: React.ReactNode;
  className?: string;
}

// Reusable card container (Level 1 Elevation)
export function Card({ children, className = "" }: SectionProps) {
  return (
    <div className={`bg-white rounded-[16px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] border border-[#E5E5E7] p-6 ${className}`}>
      {children}
    </div>
  );
}

// 1. Header / Hero
export function HeaderSection({ restaurantName }: { restaurantName: string }) {
  return (
    <header className="flex flex-col gap-2 text-center pt-8 pb-4">
      <h1 className="text-[34px] font-bold leading-[41px] tracking-[-0.02em] text-[#1a1b1f] text-balance">
        {escapeHtml(restaurantName)}
      </h1>
      <p className="text-[#414755] text-[17px] leading-[22px]">
        Personalized Growth Diagnostic
      </p>
    </header>
  );
}

// 2. Score
export function ScoreSection({ score, scoreBand }: { score: number | null, scoreBand: string | null }) {
  const displayScore = score !== null && score !== undefined ? score : 'N/A';
  const displayBand = scoreBand?.trim() || 'Unknown';
  return (
    <Card>
      <h2 className="text-[22px] font-semibold leading-[28px] text-[#1a1b1f] mb-4">Readiness Score</h2>
      <div className="flex flex-col gap-3">
        <div className="flex justify-between items-center border-b border-[#E5E5E7] pb-3">
          <span className="text-[17px] text-[#414755]">Marketing Readiness</span>
          <span className="text-[‑17px] font-bold text-[#005bc1]">{displayScore}/100</span>
        </div>
        <div className="flex justify-between items-center pt-1">
          <span className="text-[17px] text-[#414755]">Score Band</span>
          <span className="text-[17px] font-semibold text-[#1a1b1f] capitalize">{displayBand}</span>
        </div>
      </div>
    </Card>
  );
}

// 3. Gap Analysis
export function GapSection({ gap }: { gap: string | null }) {
  if (!gap || !gap.trim()) return null;
  return (
    <Card className="bg-[#f4f3f8]">
      <h2 className="text-[20px] font-semibold leading-[25px] text-[#1a1b1f] mb-3">Primary Gap</h2>
      <p className="text-[17px] text-[#414755] leading-[22px]">
        {escapeHtml(gap)}
      </p>
    </Card>
  );
}

// 4. Demo Asset
export function DemoSection({ imageUrl, caption, restaurantName }: { imageUrl: string | null, caption: string | null, restaurantName: string }) {
  if (!imageUrl || !isValidImageUrl(imageUrl)) return null;
  return (
    <Card>
      <h2 className="text-[22px] font-semibold leading-[28px] text-[#1a1b1f] mb-4">Generated Media Preview</h2>
      <div className="rounded-[8px] overflow-hidden shadow-inner border border-[#E5E5E7] mb-3">
        {/* oxlint-disable-next-line next/no-img-element -- next/image not available in prospect preview */}
        <img
          src={imageUrl}
          alt={`Enhanced photo for ${escapeHtml(restaurantName)}`}
          className="w-full h-auto object-cover block"
          loading="eager"
          width={800}
          height={600}
        />
      </div>
      {caption?.trim() && (
        <p className="text-[15px] text-[#717786] text-center italic leading-[20px]">
          {escapeHtml(caption)}
        </p>
      )}
    </Card>
  );
}

// 5. Competitor Intelligence
export function CompetitorSection({ data, summary }: { data: Record<string, unknown> | null, summary: string | null }) {
  const safeData = data ?? {};
  return (
    <Card>
      <h2 className="text-[22px] font-semibold leading-[28px] text-[#1a1b1f] mb-4">Competitor Intelligence</h2>
      <div className="bg-[#f4f3f8] rounded-[8px] p-4 text-[13px] overflow-x-auto text-[#414755] border border-[#E5E5E7]">
        {Object.keys(safeData).length > 0 ? (
          <pre className="whitespace-pre-wrap font-mono">
            {safeStringify(safeData)}
          </pre>
        ) : (
          <p className="text-center italic">No competitor data gathered yet.</p>
        )}
      </div>
      {summary?.trim() && (
        <p className="mt-4 text-[15px] text-[#414755] leading-[20px]">
          {escapeHtml(summary)}
        </p>
      )}
    </Card>
  );
}

// 6. Season Erosion Counter
export function ErosionSection() {
  // Hardcoded for now per requirements to show impact of waiting
  return (
    <Card className="border-[#ffdad6] bg-[#fffbff]">
      <h2 className="text-[20px] font-semibold leading-[25px] text-[#ba1a1a] mb-2 flex items-center gap-2">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        Season Erosion Alert
      </h2>
      <p className="text-[17px] text-[#414755] leading-[22px]">
        Every week without optimization before the season starts costs an estimated <strong className="text-[#1a1b1f]">4.2%</strong> in peak organic reach.
      </p>
    </Card>
  );
}

// 7. Scarcity Signal
export function ScarcitySection() {
  return (
    <Card className="bg-[#d8e2ff] border-[#adc6ff]">
      <div className="flex items-start gap-3">
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#005bc1" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 mt-0.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
        <div>
          <h2 className="text-[17px] font-bold leading-[22px] text-[#001a41] mb-1">Area Exclusivity Active</h2>
          <p className="text-[15px] text-[#004493] leading-[20px]">
            We only accept <strong>2 SaaS clients</strong> per cuisine/area to prevent algorithm cannibalization. Spots are currently limited.
          </p>
        </div>
      </div>
    </Card>
  );
}

// 8. Social Proof
export function SocialProofSection() {
  return (
    <div className="flex flex-col items-center gap-2 py-8 opacity-60">
      <div className="w-10 h-10 rounded-full bg-[#c1c6d7] flex items-center justify-center">
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 12h4l3-9 5 18 3-9h5"/></svg>
      </div>
      <p className="text-[13px] font-semibold tracking-widest uppercase text-[#717786]">
        Litoral Agency
      </p>
    </div>
  );
}

// 9. Sticky CTA Bar
export function StickyCTABar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 p-4 border-t border-[#E5E5E7] bg-white/80 backdrop-blur-[20px] z-50 flex justify-center">
      <div className="w-full max-w-xl">
        <button
          type="button"
          aria-label="Request contact from Litoral Agency"
          className="w-full bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[17px] font-semibold py-[14px] rounded-[12px] shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#005bc1] focus-visible:ring-offset-2"
        >
          Request Contact
        </button>
        <p className="text-center text-[12px] text-[#717786] mt-2 font-medium">
          Secure your spot before competitors
        </p>
      </div>
    </div>
  );
}
