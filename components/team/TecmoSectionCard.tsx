// components/team/TecmoSectionCard.tsx — the one card chrome every team-page
// section wears: white rounded card + team-color pixel band header, matching
// ScheduleSection and the player card/passing map. Sections keep their own
// interior markup; this only supplies the shell so the band isn't copy-pasted
// six times.
"use client";

import { textColorForBackground } from "@/lib/stats/formatters";

const PIXEL = "font-[family-name:var(--font-pixel)]";

interface TecmoSectionCardProps {
  /** Band label. Rendered uppercase by CSS — pass it in normal case. */
  title: string;
  primaryColor: string;
  secondaryColor: string;
  /** Body wrapper classes. Override to add interior spacing utilities. */
  bodyClassName?: string;
  children: React.ReactNode;
}

export default function TecmoSectionCard({
  title,
  primaryColor,
  secondaryColor,
  bodyClassName = "p-6",
  children,
}: TecmoSectionCardProps) {
  const bandText = textColorForBackground(primaryColor);

  return (
    <div className="bg-white rounded-xl shadow overflow-hidden">
      <h3
        className={`${PIXEL} px-3 py-2.5 lg:px-5 lg:py-3 text-[7px] sm:text-[9px] lg:text-[11px] uppercase tracking-wide`}
        style={{
          background: primaryColor,
          color: bandText,
          borderBottom: `2px solid ${secondaryColor}`,
        }}
      >
        {title}
      </h3>
      <div className={bodyClassName}>{children}</div>
    </div>
  );
}
