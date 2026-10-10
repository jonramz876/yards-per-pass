// components/matchup/MatchupBallToggle.tsx — the possession toggle (team
// matchup spec 2026-10-10 §4.3, §8). Two tabs at every width; the selected
// one shows ONE whole wrapper (that side's ladder and its radar) and hides the
// other, so the two always move together.
//
// BUNDLE RULE: this file imports React and lib/stats/matchup-links only. It
// receives both wrappers ALREADY RENDERED by the server (`away`, `home`), so
// the ladder, the panel, the chart and the stat modules behind them never
// enter the browser bundle. Never import a matchup component or
// lib/stats/matchup.ts here (a test walks the imports).
"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { matchupHref, parseBall, type Ball } from "@/lib/stats/matchup-links";

interface MatchupBallToggleProps {
  awayId: string;
  homeId: string;
  season: number;
  defaultSeason: number;
  /** From ?ball= on the server, so the first paint is already the right side. */
  initialBall: Ball;
  /** model.awayBall and model.homeBall, each rendered as one MatchupBallView. */
  away: ReactNode;
  home: ReactNode;
}

const BARLOW = "font-[family-name:var(--font-barlow)]";
const TAB = `${BARLOW} flex-1 min-w-0 cursor-pointer border px-1 pb-2 pt-[10px] text-[16px] font-semibold leading-tight tracking-[0.03em] md:px-[10px] md:pb-[9px] md:pt-[11px] md:text-[21px]`;
// Navy, not red: red on this page means "these two ranks are 5+ apart" and nothing else.
const TAB_ON = "border-navy bg-navy text-white";
const TAB_OFF = "border-slate-300 border-b-[3px] bg-white text-slate-600";

/**
 * The side the address names, by the server's rule: a repeated key is absent
 * (Next hands the page an array for it), so only a single `ball` counts.
 */
const addressBall = (): Ball => {
  const values = new URLSearchParams(window.location.search).getAll("ball");
  return parseBall(values.length === 1 ? values[0] : null);
};

export default function MatchupBallToggle({ awayId, homeId, season, defaultSeason, initialBall, away, home }: MatchupBallToggleProps) {
  const [ball, setBall] = useState<Ball>(initialBall);

  // After the first paint the address is the source of truth. Back from a
  // player page restores this page from Next's client cache, rendered for the
  // ORIGINAL request, while the address may say ?ball=home from an earlier
  // tab press; without this the page would show one side and the address the
  // other. On a fresh load the two already agree, so nothing flashes.
  useEffect(() => {
    const sync = () => setBall(addressBall());
    sync();
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  const pick = useCallback(
    (next: Ball) => {
      if (next === ball) return;
      setBall(next);
      // replaceState, not a router call: the choice only changes which block
      // is visible, and a router call would re-run the whole dynamic page.
      window.history.replaceState(null, "", matchupHref(awayId, homeId, { season, defaultSeason, ball: next }));
    },
    [ball, awayId, homeId, season, defaultSeason],
  );

  const tab = (which: Ball, teamId: string) => (
    <button
      type="button"
      data-ball-tab={which}
      aria-pressed={ball === which}
      onClick={() => pick(which)}
      className={`${TAB} ${ball === which ? TAB_ON : TAB_OFF}`}
    >
      {`WHEN ${teamId} HAS THE BALL`}
    </button>
  );

  return (
    <div data-ball-toggle>
      <div className="flex items-stretch">
        {tab("away", awayId)}
        {tab("home", homeId)}
      </div>
      {/* `hidden` is display:none at every width; never overflow-hidden (it would switch the panel's sticky off). */}
      <div data-ball-slot="away" className={ball === "away" ? undefined : "hidden"}>
        {away}
      </div>
      <div data-ball-slot="home" className={ball === "home" ? undefined : "hidden"}>
        {home}
      </div>
    </div>
  );
}
