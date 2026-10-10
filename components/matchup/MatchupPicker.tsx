// components/matchup/MatchupPicker.tsx — /matchup's two team pickers (team
// matchup spec 2026-10-10 §8): any away team at any home team. Picking the
// team already on the other side swaps the two; "Compare" opens the matchup.
//
// BUNDLE RULE: imports React, next/navigation and lib/stats/matchup-links
// only. The team list comes in as a prop (id + name), so no data or stat
// module reaches the browser through this file.
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { matchupHref, parseMatchupTeamId } from "@/lib/stats/matchup-links";

interface MatchupPickerProps {
  teams: ReadonlyArray<{ id: string; name: string }>;
}

const BARLOW = "font-[family-name:var(--font-barlow)]";
const SELECT = "w-full min-w-0 border border-slate-300 bg-white px-2 py-2 text-[14px] font-semibold text-slate-900";
const LABEL = "mb-1 block text-[12px] font-semibold text-slate-500";

export default function MatchupPicker({ teams }: MatchupPickerProps) {
  const router = useRouter();
  const [away, setAway] = useState("");
  const [home, setHome] = useState("");

  const known = (id: string) => id !== "" && parseMatchupTeamId(id) === id && teams.some((t) => t.id === id);
  const ready = known(away) && known(home) && away !== home;

  // Picking the team that is already on the other side swaps the two.
  const pickAway = (id: string) => {
    if (id !== "" && id === home) setHome(away);
    setAway(id);
  };
  const pickHome = (id: string) => {
    if (id !== "" && id === away) setAway(home);
    setHome(id);
  };

  const options = (
    <>
      <option value="">Pick a team</option>
      {teams.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </>
  );

  return (
    <div data-matchup-picker>
      <div data-pick-row className="flex flex-col gap-3 md:flex-row md:items-end">
        <div className="min-w-0 md:flex-1">
          <label htmlFor="matchup-pick-away" className={LABEL}>Away team</label>
          <select id="matchup-pick-away" data-pick="away" value={away} onChange={(e) => pickAway(e.target.value)} className={SELECT}>
            {options}
          </select>
        </div>
        <div className="min-w-0 md:flex-1">
          <label htmlFor="matchup-pick-home" className={LABEL}>Home team</label>
          <select id="matchup-pick-home" data-pick="home" value={home} onChange={(e) => pickHome(e.target.value)} className={SELECT}>
            {options}
          </select>
        </div>
        <button
          type="button"
          data-pick-go
          disabled={!ready}
          onClick={() => {
            if (ready) router.push(matchupHref(away, home));
          }}
          className={`${BARLOW} border border-navy bg-navy px-5 py-[7px] text-[19px] font-semibold tracking-[0.03em] text-white disabled:cursor-not-allowed disabled:border-slate-300 disabled:bg-slate-100 disabled:text-slate-400`}
        >
          COMPARE
        </button>
      </div>
    </div>
  );
}
