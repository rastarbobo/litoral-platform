/**
 * BrandPersonaSkeleton — iOS-style shimmer loading placeholder.
 *
 * Renders a Level 1 card with animated gradient rectangles matching
 * the persona editor layout: text areas, voice pills, customer chips,
 * and a save button placeholder.
 *
 * Uses `animate-pulse` with Cupertino Logic surface-container tones.
 * Shown for < 100ms (SSR) → content transition.
 */

export function BrandPersonaSkeleton() {
  return (
    <div className="flex flex-col items-center pt-8 px-4 md:px-8 w-full max-w-2xl mx-auto font-sans">
      <div className="w-full space-y-6">
        {/* Header skeleton */}
        <div className="text-center space-y-3">
          <div className="h-8 w-40 mx-auto bg-[#eeedf3] rounded-[8px] animate-pulse" />
          <div className="h-5 w-72 mx-auto bg-[#eeedf3] rounded-[8px] animate-pulse" />
        </div>

        {/* Card */}
        <div className="bg-white border border-[#E5E5E7] rounded-[12px] p-4 shadow-[0px_4px_12px_rgba(0,0,0,0.05)] w-full">
          <div className="flex flex-col gap-6">
            {/* Cuisine Philosophy textarea */}
            <div>
              <div className="h-5 w-36 bg-[#eeedf3] rounded-[6px] animate-pulse mb-2" />
              <div className="h-[90px] w-full bg-[#eeedf3] rounded-[8px] animate-pulse" />
            </div>

            {/* Voice & Tone pills */}
            <div>
              <div className="h-5 w-28 bg-[#eeedf3] rounded-[6px] animate-pulse mb-2" />
              <div className="flex flex-col gap-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[44px] w-full bg-[#eeedf3] rounded-[8px] animate-pulse"
                    style={{ animationDelay: `${i * 100}ms` }}
                  />
                ))}
              </div>
            </div>

            {/* Target Customer chips */}
            <div>
              <div className="h-5 w-32 bg-[#eeedf3] rounded-[6px] animate-pulse mb-2" />
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-[32px] w-20 bg-[#eeedf3] rounded-[8px] animate-pulse"
                    style={{ animationDelay: `${i * 80}ms` }}
                  />
                ))}
              </div>
            </div>

            {/* Neighborhood Character input */}
            <div>
              <div className="h-5 w-44 bg-[#eeedf3] rounded-[6px] animate-pulse mb-2" />
              <div className="h-[44px] w-full bg-[#eeedf3] rounded-[8px] animate-pulse" />
            </div>

            {/* Values textarea */}
            <div>
              <div className="h-5 w-36 bg-[#eeedf3] rounded-[6px] animate-pulse mb-2" />
              <div className="h-[120px] w-full bg-[#eeedf3] rounded-[8px] animate-pulse" />
            </div>
          </div>
        </div>

        {/* Save button placeholder */}
        <div className="flex justify-end">
          <div className="h-[48px] w-36 bg-[#005bc1]/20 rounded-[12px] animate-pulse" />
        </div>
      </div>
    </div>
  );
}