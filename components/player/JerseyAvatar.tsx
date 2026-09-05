"use client";
// components/player/JerseyAvatar.tsx — headshot with team-jersey fallback.
import { useState } from "react";
import { textColorForBackground } from "@/lib/stats/formatters";

interface Props {
  headshotUrl: string | null;
  jerseyNumber: number | null;
  primaryColor: string;
  secondaryColor: string;
  playerName: string;
  size?: number; // px, default 56
}

export default function JerseyAvatar({
  headshotUrl, jerseyNumber, primaryColor, secondaryColor, playerName, size = 56,
}: Props) {
  const [broken, setBroken] = useState(false);
  if (headshotUrl && !broken) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- external host, unoptimized by design
      <img
        src={headshotUrl}
        alt={playerName}
        width={size}
        height={size}
        onError={() => setBroken(true)}
        className="rounded-md object-cover bg-slate-100 border-2"
        style={{ borderColor: primaryColor, width: size, height: size }}
      />
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 60 60" role="img" aria-label={playerName}>
      <path
        d="M14 8 L24 4 Q30 8 36 4 L46 8 L56 20 L46 27 L46 54 Q30 58 14 54 L14 27 L4 20 Z"
        fill={primaryColor} stroke={secondaryColor} strokeWidth="2.5"
      />
      {jerseyNumber != null && (
        // Light jerseys (e.g. CIN orange) need dark digits to stay readable.
        <text x="30" y="40" textAnchor="middle" fill={textColorForBackground(primaryColor)}
          fontSize="20" fontWeight="bold" fontFamily="var(--font-pixel), monospace">
          {jerseyNumber}
        </text>
      )}
    </svg>
  );
}
