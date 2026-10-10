// components/matchup/MatchupPicker.tsx — /matchup's two team pickers (team
// matchup spec 2026-10-10 §8): any away team at any home team; "Compare"
// opens the matchup.
//
// Each select changes ONLY itself. An earlier version swapped the two picks
// when one side chose the other side's team; a closed select fires `change`
// on every arrow key, so walking one list with the keyboard past the other
// side's team rewrote that pick (chaos pass on PR 2, finding 2). The same
// team on both sides is allowed here: Compare is then off and a line says
// why. Order needs no help either: the server redirects a reversed pair.
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
const SAME_TEAM = "Pick two different teams.";

export default function MatchupPicker({ teams }: MatchupPickerProps) {
  const router = useRouter();
  const [away, setAway] = useState("");
  const [home, setHome] = useState("");

  const known = (id: string) => id !== "" && parseMatchupTeamId(id) === id && teams.some((t) => t.id === id);
  const ready = known(away) && known(home) && away !== home;

  const sameTeam = known(away) && away === home;

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
          <select id="matchup-pick-away" data-pick="away" value={away} onChange={(e) => setAway(e.target.value)} className={SELECT}>
            {options}
          </select>
        </div>
        <div className="min-w-0 md:flex-1">
          <label htmlFor="matchup-pick-home" className={LABEL}>Home team</label>
          <select id="matchup-pick-home" data-pick="home" value={home} onChange={(e) => setHome(e.target.value)} className={SELECT}>
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
      {sameTeam && <p data-pick-same className="m-0 mt-2 text-[13px] text-slate-600">{SAME_TEAM}</p>}
    </div>
  );
}
