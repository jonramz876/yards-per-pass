// components/game/Scoreboard.tsx — Tecmo scoreboard header for one game.
// Dark panel, a slate band ("WEEK 1 · SUN SEP 13" left, "FINAL" right) in the
// pixel font, away team left / home team right — logo, abbreviation in the
// pixel font, nickname + record after this game in the regular font — and the
// big score with the winner's number in gold. Numbers never use the pixel
// font (site convention). No "use client": the game page renders it on the
// server, and PR 4's /scores cards and homepage strip reuse the same
// buildScoreboard model from lib/stats/box-score.ts.
import Image from "next/image";
import Link from "next/link";
import type { ScoreboardModel, ScoreboardTeam } from "@/lib/stats/box-score";

const PIXEL = "font-[family-name:var(--font-pixel)]";
const PANEL_BG = "#0f172a";
const BAND_BG = "#1e3a5f";
const GOLD = "#fbbf24";

function TeamSide({ team, side }: { team: ScoreboardTeam; side: "away" | "home" }) {
  const home = side === "home";
  return (
    <Link
      href={`/team/${team.id}`}
      title={`${team.name} team page`}
      data-scoreboard-team={side}
      className={`group flex min-w-0 items-center gap-2 md:gap-3.5 ${home ? "flex-row-reverse text-right" : ""}`}
    >
      {team.logo && (
        <Image
          src={team.logo}
          alt={team.name}
          width={46}
          height={46}
          className="h-[30px] w-[30px] shrink-0 object-contain md:h-[46px] md:w-[46px]"
        />
      )}
      <span className="flex min-w-0 flex-col gap-1.5">
        <span
          className={`${PIXEL} text-[12px] leading-none text-white group-hover:underline group-hover:underline-offset-4 md:text-[17px]`}
        >
          {team.abbreviation}
        </span>
        <span className="whitespace-nowrap text-[12px] text-slate-400 md:text-[12.5px]">
          <span className="hidden md:inline">{team.nickname} · </span>
          <b className="font-bold tabular-nums text-slate-200">{team.record}</b>
        </span>
      </span>
    </Link>
  );
}

export default function Scoreboard({ model }: { model: ScoreboardModel }) {
  const { away, home } = model;
  return (
    <section
      data-scoreboard
      className="overflow-hidden rounded-xl text-slate-200 shadow"
      style={{ background: PANEL_BG }}
    >
      <div
        className={`${PIXEL} flex justify-between gap-3 px-3.5 py-2.5 text-[8px] tracking-wider text-slate-300 md:px-5 md:text-[10px]`}
        style={{ background: BAND_BG }}
      >
        <span data-scoreboard-label>
          {model.label}
          {model.dateLabel ? ` · ${model.dateLabel}` : ""}
        </span>
        <span className="text-white">FINAL</span>
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-3.5 py-4 md:gap-3 md:px-6 md:py-5">
        <TeamSide team={away} side="away" />
        <div
          data-scoreboard-score
          className="whitespace-nowrap text-[28px] font-extrabold leading-none tracking-tight tabular-nums md:text-[42px]"
        >
          <span data-score="away" style={away.winner ? { color: GOLD } : undefined}>
            {away.score}
          </span>
          <span className="mx-1.5 font-semibold text-slate-600 md:mx-3">–</span>
          <span data-score="home" style={home.winner ? { color: GOLD } : undefined}>
            {home.score}
          </span>
        </div>
        <TeamSide team={home} side="home" />
      </div>
    </section>
  );
}
