/**
 * SubscriptionSkeleton — iOS-style shimmer loading placeholder.
 *
 * Renders a Level 1 card with animated gradient rectangles matching
 * the subscription page layout: header, data rows, tier comparison cards.
 */

export function SubscriptionSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
      <div className="w-full max-w-2xl mx-auto px-4 py-8 sm:py-12">
        {/* Header skeleton */}
        <div className="h-8 w-40 bg-[#eeedf3] rounded-[8px] animate-pulse mb-2" />
        <div className="h-5 w-72 bg-[#eeedf3] rounded-[8px] animate-pulse mb-6" />

        {/* Current Plan card */}
        <div className="bg-white border border-[#E5E5E7] rounded-[12px] p-4 shadow-[0px_4px_12px_rgba(0,0,0,0.05)] mb-6">
          <div className="space-y-4">
            <div>
              <div className="h-4 w-24 bg-[#eeedf3] rounded-[6px] animate-pulse mb-1" />
              <div className="flex items-center justify-between">
                <div className="h-6 w-20 bg-[#eeedf3] rounded-[6px] animate-pulse" />
                <div className="h-5 w-16 bg-[#eeedf3] rounded-[6px] animate-pulse" />
              </div>
            </div>
            <div className="h-px bg-[#E5E5E7]" />
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="h-4 w-28 bg-[#eeedf3] rounded-[6px] animate-pulse mb-1" />
                <div className="h-6 w-24 bg-[#eeedf3] rounded-[6px] animate-pulse" />
              </div>
              <div>
                <div className="h-4 w-16 bg-[#eeedf3] rounded-[6px] animate-pulse mb-1" />
                <div className="h-6 w-20 bg-[#eeedf3] rounded-[6px] animate-pulse" />
              </div>
            </div>
          </div>
        </div>

        {/* Tier cards skeleton */}
        <div className="h-4 w-28 bg-[#eeedf3] rounded-[6px] animate-pulse mb-3 px-1" />

        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="bg-white border border-[#E5E5E7] rounded-[12px] p-4 shadow-[0px_4px_12px_rgba(0,0,0,0.05)]"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="h-6 w-24 bg-[#eeedf3] rounded-[6px] animate-pulse" />
                  <div className="h-5 w-16 bg-[#eeedf3] rounded-[6px] animate-pulse mt-1" />
                </div>
              </div>
              <div className="space-y-1.5 mb-4">
                {Array.from({ length: 4 + i }).map((_, j) => (
                  <div
                    key={j}
                    className="h-5 bg-[#eeedf3] rounded-[4px] animate-pulse"
                    style={{ width: `${70 + j * 10}%`, animationDelay: `${j * 80}ms` }}
                  />
                ))}
              </div>
              <div className="h-[44px] w-full bg-[#eeedf3] rounded-[12px] animate-pulse" />
            </div>
          ))}
        </div>

        {/* Manage Billing button */}
        <div className="mt-6">
          <div className="h-[52px] w-full bg-[#005bc1]/20 rounded-[12px] animate-pulse" />
        </div>
      </div>
    </div>
  );
}