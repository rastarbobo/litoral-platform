import { MobileAppShell } from "@/components/dashboard/mobile-app-shell";
import { Paintbrush } from "lucide-react";

export default function TemplatePreferencesPage() {
  return (
    <MobileAppShell title="Template Preferences" showBack>
      <div className="flex flex-col items-center justify-center py-20 px-4 text-center min-h-[60vh]">
        <div className="w-16 h-16 rounded-full bg-[#eeedf3] flex items-center justify-center mb-4">
          <Paintbrush className="w-8 h-8 text-[#717786]" />
        </div>
        <h2 className="text-[20px] font-semibold text-[#1a1b1f] mb-2" style={{ fontFamily: "Inter, sans-serif" }}>
          Coming Soon
        </h2>
        <p className="text-[16px] text-[#717786] max-w-[280px]" style={{ fontFamily: "Inter, sans-serif" }}>
          Template preference settings will be available in a future update.
        </p>
      </div>
    </MobileAppShell>
  );
}
