import React from "react";

/**
 * Cupertino Logic Level 1 Card wrapper.
 *
 * White card on #F5F5F7 canvas with 1px #E5E5E7 border,
 * soft shadow, 16px padding, and 12px continuous corner radius.
 */
export function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`bg-white border border-[#E5E5E7] rounded-[12px] p-4 shadow-[0px_4px_12px_rgba(0,0,0,0.05)] ${className}`}
    >
      {children}
    </div>
  );
}

/**
 * Primary button — solid blue (#005bc1) bg, white text, 12px radius.
 */
export function PrimaryButton({
  children,
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { children: React.ReactNode }) {
  return (
    <button
      type="button"
      className={`w-full sm:w-auto px-8 py-[14px] bg-[#005bc1] hover:bg-[#0070eb] active:bg-[#004493] text-white text-[17px] font-semibold rounded-[12px] shadow-sm transition-colors focus-visible:ring-2 focus-visible:ring-[#005bc1] focus-visible:ring-offset-2 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

/**
 * Text input styled per Cupertino Logic.
 * White bg, 1px #D1D1D6 border, focus → blue border.
 */
export function TextInput({
  label,
  error,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[15px] font-medium text-[#1a1b1f]">{label}</label>
      <input
        className={`w-full px-3 py-2.5 bg-white border rounded-[8px] text-[17px] text-[#1a1b1f] placeholder-[#717786] transition-colors outline-none ${
          error
            ? "border-[#ba1a1a] focus:border-[#ba1a1a] focus:ring-2 focus:ring-[#ba1a1a]/20"
            : "border-[#D1D1D6] focus:border-[#005bc1] focus:ring-2 focus:ring-[#005bc1]/20"
        }`}
        {...props}
      />
      {error && <p className="text-[13px] text-[#ba1a1a]">{error}</p>}
    </div>
  );
}

/**
 * Verified social badge component.
 * Shows a checkmark icon + platform name when connected,
 * or an empty state with "Connect" when not available.
 */
export function VerifiedBadge({
  platform,
  isConnected,
  handle,
}: {
  platform: string;
  isConnected: boolean;
  handle?: string;
}) {
  if (isConnected && handle) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f4f3f8] rounded-[8px] text-[15px] text-[#1a1b1f]">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#005bc1"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="20 6 9 17 4 12" />
        </svg>
        <span className="font-medium">{platform}:</span>
        <span className="text-[#414755]">{handle}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-[#f4f3f8] rounded-[8px] text-[15px] text-[#717786]">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <line x1="12" y1="5" x2="12" y2="19" />
        <line x1="5" y1="12" x2="19" y2="12" />
      </svg>
      <span>{platform}: Not connected</span>
    </div>
  );
}

/**
 * Section heading — Inter Display (34px desktop, 28px mobile).
 */
export function SectionHeading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <h1
      className={`text-[28px] sm:text-[34px] font-bold leading-[34px] sm:leading-[41px] tracking-[-0.02em] text-[#1a1b1f] ${className}`}
    >
      {children}
    </h1>
  );
}

/**
 * Section subheading — Inter Callout (16px).
 */
export function SectionSubheading({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={`text-[16px] leading-[21px] text-[#414755] ${className}`}>
      {children}
    </p>
  );
}