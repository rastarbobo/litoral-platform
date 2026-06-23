import { notFound } from "next/navigation";
import { restaurantRepo, OPT_OUT_STATE } from "@/db/repositories/restaurant-repository";
import type { Metadata } from "next";
import { safeParseJson, escapeHtml } from "./_components/utils";
import { ExpiredOfferCard } from "./_components/ExpiredOfferCard";
import { 
  HeaderSection, 
  ScoreSection, 
  GapSection, 
  DemoSection, 
  CompetitorSection, 
  ErosionSection, 
  ScarcitySection, 
  SocialProofSection, 
  StickyCTABar 
} from "./_components/Sections";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const p = await params;
  const restaurant = await restaurantRepo.findBySlug(p.slug).catch(() => null);
  if (!restaurant) return { title: "Not Found" };
  const isExpired =
    (restaurant.offerExpiresAt && new Date(restaurant.offerExpiresAt) < new Date()) ||
    restaurant.behavioralState === OPT_OUT_STATE;
  if (isExpired) return { title: "Offer Expired" };
  return { title: `Your Diagnostic Package - ${escapeHtml(restaurant.name)}` };
}

export default async function ProspectLandingPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const p = await params;
  const restaurant = await restaurantRepo.findBySlug(p.slug);

  if (!restaurant) {
    notFound();
  }

  const isExpired =
    (restaurant.offerExpiresAt && new Date(restaurant.offerExpiresAt) < new Date()) ||
    restaurant.behavioralState === OPT_OUT_STATE;

  if (isExpired) {
    return (
      <div className="min-h-screen bg-[#F5F5F7] font-sans relative">
        <ExpiredOfferCard />
      </div>
    );
  }

  // Parse JSON fields safely, guarding against malformed stored strings
  const diagnosticPackage = safeParseJson(restaurant.diagnosticPackage);
  const competitorData = safeParseJson(restaurant.competitorData);

  const summary = typeof diagnosticPackage.summary === 'string' ? diagnosticPackage.summary : null;
  const postCaption = typeof diagnosticPackage.postCaption === 'string' ? diagnosticPackage.postCaption : null;

  const croVariant = restaurantRepo.resolveCroVariant(restaurant);

  const renderHeroSections = () => {
    switch (croVariant) {
      case 'B_VISUAL':
        return (
          <>
            <DemoSection 
              imageUrl={restaurant.enhancedPhotoUrl} 
              caption={postCaption} 
              restaurantName={restaurant.name} 
            />
            <ScoreSection 
              score={restaurant.marketingReadinessScore} 
              scoreBand={restaurant.scoreBand} 
            />
            <GapSection gap={restaurant.primaryGapExplanation} />
          </>
        );
      case 'C_NARRATIVE':
        return (
          <>
            <GapSection gap={restaurant.primaryGapExplanation} />
            <ScoreSection 
              score={restaurant.marketingReadinessScore} 
              scoreBand={restaurant.scoreBand} 
            />
            <DemoSection 
              imageUrl={restaurant.enhancedPhotoUrl} 
              caption={postCaption} 
              restaurantName={restaurant.name} 
            />
          </>
        );
      case 'A_SCORE':
      default:
        return (
          <>
            <ScoreSection 
              score={restaurant.marketingReadinessScore} 
              scoreBand={restaurant.scoreBand} 
            />
            <DemoSection 
              imageUrl={restaurant.enhancedPhotoUrl} 
              caption={postCaption} 
              restaurantName={restaurant.name} 
            />
            <GapSection gap={restaurant.primaryGapExplanation} />
          </>
        );
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F7] font-sans relative pb-24">
      {/* 
        pb-24 ensures content isn't hidden behind the sticky CTA bar on mobile 
        Level 0 Canvas is #F5F5F7
      */}
      <main className="flex flex-col items-center pt-8 px-4 md:px-8">
        <div className="max-w-xl w-full flex flex-col gap-6">
          <HeaderSection restaurantName={restaurant.name} />
          
          {renderHeroSections()}
          
          <CompetitorSection data={competitorData} summary={summary} />
          
          <ErosionSection />
          
          <ScarcitySection />
          
          <SocialProofSection />

        </div>
      </main>

      <StickyCTABar />
    </div>
  );
}
