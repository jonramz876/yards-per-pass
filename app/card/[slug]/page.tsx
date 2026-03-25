// app/card/[slug]/page.tsx — Shareable stat card page
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getPlayerBySlug } from "@/lib/data/players";
import { getAllRBWeeklyStats, getRBWeeklyStats } from "@/lib/data/players";
import { getQBStats } from "@/lib/data/queries";
import { getReceiverStats } from "@/lib/data/receivers";
import { getTeam, getTeamColor } from "@/lib/data/teams";
import { computePercentile, computeRank, ordinal } from "@/lib/stats/percentiles";
import { qbFantasyPoints } from "@/lib/stats/fantasy";
import { wrFantasyPoints } from "@/lib/stats/fantasy";
import { rbFantasyPoints } from "@/lib/stats/fantasy";
import type { QBSeasonStat, ReceiverSeasonStat, RBWeeklyStat } from "@/lib/types";
import StatCardView from "@/components/player/StatCardView";
import CardPageActions from "./CardPageActions";

export const revalidate = 3600;

// --- QB helpers (mirrors PlayerOverviewQB.tsx) ---
const QB_RADAR_KEYS = ["epa_per_db", "cpoe", "dropbacks_game", "adot", "inv_int_pct", "success_rate"] as const;
const QB_RADAR_LABELS = ["EPA/DB", "CPOE", "DB/G", "aDOT", "INT Rate", "Success%"];
const QB_BAR_STATS = [
  { key: "yards_per_game", label: "Yds/G" },
  { key: "tds_per_game", label: "TD/G" },
  { key: "passer_rating", label: "Rating" },
  { key: "any_a", label: "ANY/A" },
  { key: "fantasy_pts", label: "FPts" },
];

function getQBRadarVal(qb: QBSeasonStat, key: string): number {
  switch (key) {
    case "epa_per_db": return qb.epa_per_db ?? NaN;
    case "cpoe": return qb.cpoe ?? NaN;
    case "dropbacks_game": return qb.games ? qb.dropbacks / qb.games : NaN;
    case "adot": return qb.adot ?? NaN;
    case "inv_int_pct": return qb.attempts > 0 ? 1 - (qb.interceptions / qb.attempts) : NaN;
    case "success_rate": return qb.success_rate ?? NaN;
    default: return NaN;
  }
}

function getQBBarVal(qb: QBSeasonStat, key: string): number {
  switch (key) {
    case "yards_per_game": return qb.games ? qb.passing_yards / qb.games : NaN;
    case "tds_per_game": return qb.games ? qb.touchdowns / qb.games : NaN;
    case "passer_rating": return qb.passer_rating;
    case "any_a": return qb.any_a;
    case "fantasy_pts": return qbFantasyPoints({
      passing_yards: qb.passing_yards, touchdowns: qb.touchdowns, interceptions: qb.interceptions,
      rush_yards: qb.rush_yards, rush_tds: qb.rush_tds, fumbles_lost: qb.fumbles_lost,
    });
    default: return NaN;
  }
}

function formatQBChip(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "epa_per_db": return val.toFixed(2);
    case "cpoe": return (val >= 0 ? "+" : "") + val.toFixed(1);
    case "dropbacks_game": return val.toFixed(1);
    case "adot": return val.toFixed(1);
    case "inv_int_pct": return ((1 - val) * 100).toFixed(1) + "%";
    case "success_rate": return (val * 100).toFixed(1) + "%";
    default: return val.toFixed(2);
  }
}

// --- WR/TE helpers (mirrors PlayerOverviewWR.tsx) ---
const WR_RADAR_KEYS = ["targets_game", "epa_per_target", "croe", "air_yards_per_target", "yac_per_reception", "yards_per_route_run"] as const;
const WR_RADAR_LABELS = ["Tgt/G", "EPA/Tgt", "CROE", "aDOT", "YAC/Rec", "YPRR"];
const WR_BAR_STATS: { key: string; label: string; pct: boolean }[] = [
  { key: "yards_per_game", label: "Yds/G", pct: false },
  { key: "tds_per_game", label: "TD/G", pct: false },
  { key: "receptions_per_game", label: "Rec/G", pct: false },
  { key: "yards_per_reception", label: "YPR", pct: false },
  { key: "fantasy_pts", label: "FPts", pct: false },
];

function getWRRadarVal(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "targets_game": return rec.games ? rec.targets / rec.games : NaN;
    case "epa_per_target": return rec.epa_per_target;
    case "croe": return rec.croe ?? NaN;
    case "air_yards_per_target": return rec.air_yards_per_target;
    case "yac_per_reception": return rec.yac_per_reception;
    case "yards_per_route_run": return rec.yards_per_route_run;
    default: return NaN;
  }
}

function getWRBarVal(rec: ReceiverSeasonStat, key: string): number {
  switch (key) {
    case "yards_per_game": return rec.games ? rec.receiving_yards / rec.games : NaN;
    case "tds_per_game": return rec.games ? rec.receiving_tds / rec.games : NaN;
    case "receptions_per_game": return rec.games ? rec.receptions / rec.games : NaN;
    case "yards_per_reception": return rec.yards_per_reception;
    case "fantasy_pts": return wrFantasyPoints({
      receiving_yards: rec.receiving_yards, receiving_tds: rec.receiving_tds,
      receptions: rec.receptions, fumbles_lost: rec.fumbles_lost,
    }, "ppr");
    default: return NaN;
  }
}

function formatWRChip(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "targets_game": return val.toFixed(1);
    case "epa_per_target": return val.toFixed(2);
    case "croe": return (val >= 0 ? "+" : "") + (val * 100).toFixed(1) + "%";
    case "air_yards_per_target": return val.toFixed(1);
    case "yac_per_reception": return val.toFixed(1);
    case "yards_per_route_run": return val.toFixed(2);
    default: return val.toFixed(2);
  }
}

// --- RB helpers (mirrors PlayerOverviewRB.tsx) ---
interface AggregatedRB {
  player_id: string;
  games: number;
  carries: number;
  rushing_yards: number;
  rushing_tds: number;
  epa_per_carry: number;
  success_rate: number;
  stuff_rate: number;
  explosive_rate: number;
  yards_per_carry: number;
  targets: number;
  receptions: number;
  receiving_yards: number;
  receiving_tds: number;
  fumbles_lost: number;
}

const RB_RADAR_KEYS = ["carries_game", "epa_per_carry", "stuff_avoidance", "explosive_rate", "targets_game", "success_rate"] as const;
const RB_RADAR_LABELS = ["Car/G", "EPA/Car", "Stuff Avoid%", "Explosive%", "Tgt/G", "Success%"];
const RB_BAR_STATS = [
  { key: "rush_yards_game", label: "Yds/G" },
  { key: "rush_tds_game", label: "TD/G" },
  { key: "yards_per_carry", label: "YPC" },
  { key: "success_rate", label: "Success%" },
  { key: "fantasy_pts", label: "FPts" },
];

function aggregateRBWeekly(rows: RBWeeklyStat[]): AggregatedRB {
  const games = rows.length;
  let carries = 0, rushYds = 0, rushTds = 0;
  let epaSum = 0, srSum = 0, stuffSum = 0, explSum = 0, ypcSum = 0;
  let epaCount = 0, srCount = 0, stuffCount = 0, explCount = 0, ypcCount = 0;
  let targets = 0, receptions = 0, recYds = 0, recTds = 0, fumblesLost = 0;

  for (const r of rows) {
    const c = r.carries || 0;
    carries += c;
    rushYds += r.rushing_yards || 0;
    rushTds += r.rushing_tds || 0;
    targets += r.targets || 0;
    receptions += r.receptions || 0;
    recYds += r.receiving_yards || 0;
    recTds += r.receiving_tds || 0;
    fumblesLost += r.fumbles_lost || 0;
    if (c > 0) {
      if (!isNaN(r.epa_per_carry)) { epaSum += r.epa_per_carry * c; epaCount += c; }
      if (!isNaN(r.success_rate)) { srSum += r.success_rate * c; srCount += c; }
      if (!isNaN(r.stuff_rate)) { stuffSum += r.stuff_rate * c; stuffCount += c; }
      if (!isNaN(r.explosive_rate)) { explSum += r.explosive_rate * c; explCount += c; }
      if (!isNaN(r.yards_per_carry)) { ypcSum += r.yards_per_carry * c; ypcCount += c; }
    }
  }

  return {
    player_id: rows[0]?.player_id ?? "",
    games, carries, rushing_yards: rushYds, rushing_tds: rushTds,
    epa_per_carry: epaCount > 0 ? epaSum / epaCount : NaN,
    success_rate: srCount > 0 ? srSum / srCount : NaN,
    stuff_rate: stuffCount > 0 ? stuffSum / stuffCount : NaN,
    explosive_rate: explCount > 0 ? explSum / explCount : NaN,
    yards_per_carry: ypcCount > 0 ? ypcSum / ypcCount : NaN,
    targets, receptions, receiving_yards: recYds, receiving_tds: recTds, fumbles_lost: fumblesLost,
  };
}

function getRBRadarVal(agg: AggregatedRB, key: string): number {
  switch (key) {
    case "carries_game": return agg.games ? agg.carries / agg.games : NaN;
    case "epa_per_carry": return agg.epa_per_carry;
    case "stuff_avoidance": return !isNaN(agg.stuff_rate) ? 1 - agg.stuff_rate : NaN;
    case "explosive_rate": return agg.explosive_rate;
    case "targets_game": return agg.games ? agg.targets / agg.games : NaN;
    case "success_rate": return agg.success_rate;
    default: return NaN;
  }
}

function getRBBarVal(agg: AggregatedRB, key: string): number {
  switch (key) {
    case "rush_yards_game": return agg.games ? agg.rushing_yards / agg.games : NaN;
    case "rush_tds_game": return agg.games ? agg.rushing_tds / agg.games : NaN;
    case "yards_per_carry": return agg.yards_per_carry;
    case "success_rate": return agg.success_rate;
    case "fantasy_pts": return rbFantasyPoints({
      rushing_yards: agg.rushing_yards, rushing_tds: agg.rushing_tds,
      receiving_yards: agg.receiving_yards, receiving_tds: agg.receiving_tds,
      receptions: agg.receptions, fumbles_lost: agg.fumbles_lost,
    }, "ppr");
    default: return NaN;
  }
}

function formatRBChip(key: string, val: number): string {
  if (isNaN(val)) return "\u2014";
  switch (key) {
    case "carries_game":
    case "targets_game": return val.toFixed(1);
    case "epa_per_carry": return val.toFixed(2);
    case "stuff_avoidance":
    case "explosive_rate":
    case "success_rate": return (val * 100).toFixed(1) + "%";
    default: return val.toFixed(2);
  }
}

// --- Generic bar stat builder ---
function buildBarStat(
  val: number,
  poolVals: number[],
  label: string,
  isPct: boolean = false,
): { label: string; value: string; delta: number; pct: number } {
  const clean = poolVals.filter((v) => !isNaN(v));
  const avg = clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : 0;
  const delta = val - avg;
  const barPct = avg !== 0 ? Math.min(Math.abs(delta / avg) * 100, 45) : 0;
  let valueStr: string;
  if (isNaN(val)) {
    valueStr = "\u2014";
  } else if (isPct) {
    valueStr = (val * 100).toFixed(1) + "%";
  } else {
    valueStr = val.toFixed(1);
  }
  return { label, value: valueStr, delta: isNaN(delta) ? 0 : delta, pct: barPct };
}

// -------------------------------------------------------------------
// Metadata
// -------------------------------------------------------------------
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  const base = process.env.NEXT_PUBLIC_SITE_URL || "https://yardsperpass.com";
  if (!player) {
    return { title: "Player Not Found — Yards Per Pass" };
  }
  return {
    title: `${player.player_name} Stat Card — Yards Per Pass`,
    description: `${player.player_name} advanced performance card with radar chart, percentiles, and league comparisons.`,
    alternates: { canonical: `${base}/card/${slug}` },
    openGraph: {
      title: `${player.player_name} Stat Card — Yards Per Pass`,
      description: `${player.player_name} advanced stat card with radar chart and league comparisons.`,
      url: `${base}/card/${slug}`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: `${player.player_name} Stat Card — Yards Per Pass`,
      description: `${player.player_name} advanced stat card with radar chart and league comparisons.`,
    },
  };
}

// -------------------------------------------------------------------
// Page
// -------------------------------------------------------------------
export default async function CardPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const player = await getPlayerBySlug(slug);
  if (!player) notFound();

  const season = 2025;
  const team = getTeam(player.current_team_id);
  const teamColor = getTeamColor(player.current_team_id);
  const teamName = team?.name || player.current_team_id;

  let radarValues: number[] = [];
  let radarLabels: string[] = [];
  let chipStats: { label: string; value: string; rank: string }[] = [];
  let barStats: { label: string; value: string; delta: number; pct: number }[] = [];

  try {
    if (player.position === "QB") {
      const allQBs = await getQBStats(season);
      const me = allQBs.find((q) => q.player_id === player.player_id);
      if (!me) notFound();

      const PFR_MIN = 238;
      const pool = allQBs.filter((q) => q.attempts >= PFR_MIN);
      const total = pool.length;

      radarLabels = QB_RADAR_LABELS;
      radarValues = QB_RADAR_KEYS.map((key) => {
        const sorted = pool.map((q) => getQBRadarVal(q, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b);
        return computePercentile(sorted, getQBRadarVal(me!, key));
      });

      chipStats = QB_RADAR_KEYS.map((key) => {
        const val = getQBRadarVal(me!, key);
        const poolVals = pool.map((q) => getQBRadarVal(q, key)).filter((v) => !isNaN(v));
        const rank = computeRank(poolVals, val);
        return { label: QB_RADAR_LABELS[QB_RADAR_KEYS.indexOf(key)], value: formatQBChip(key, val), rank: `${ordinal(rank)} of ${total}` };
      });

      barStats = QB_BAR_STATS.map((stat) => {
        const val = getQBBarVal(me!, stat.key);
        const poolVals = pool.map((q) => getQBBarVal(q, stat.key));
        return buildBarStat(val, poolVals, stat.label);
      });
    } else if (player.position === "WR" || player.position === "TE") {
      const allRec = await getReceiverStats(season);
      const me = allRec.find((r) => r.player_id === player.player_id);
      if (!me) notFound();

      const isTE = me.position === "TE";
      const PFR_MIN = 32;
      const pool = allRec.filter((r) => (isTE ? r.position === "TE" : r.position === "WR") && r.targets >= PFR_MIN);
      const total = pool.length;

      radarLabels = WR_RADAR_LABELS;
      radarValues = WR_RADAR_KEYS.map((key) => {
        const sorted = pool.map((r) => getWRRadarVal(r, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b);
        return computePercentile(sorted, getWRRadarVal(me, key));
      });

      chipStats = WR_RADAR_KEYS.map((key) => {
        const val = getWRRadarVal(me, key);
        const poolVals = pool.map((r) => getWRRadarVal(r, key)).filter((v) => !isNaN(v));
        const rank = computeRank(poolVals, val);
        return { label: WR_RADAR_LABELS[WR_RADAR_KEYS.indexOf(key)], value: formatWRChip(key, val), rank: `${ordinal(rank)} of ${total}` };
      });

      barStats = WR_BAR_STATS.map((stat) => {
        const val = getWRBarVal(me, stat.key);
        const poolVals = pool.map((r) => getWRBarVal(r, stat.key));
        return buildBarStat(val, poolVals, stat.label, stat.pct);
      });
    } else if (player.position === "RB") {
      const [weekly, allRBWeekly] = await Promise.all([
        getRBWeeklyStats(player.player_id, season),
        getAllRBWeeklyStats(season),
      ]);

      if (weekly.length === 0) notFound();
      const playerAgg = aggregateRBWeekly(weekly);

      const PFR_MIN = 106;
      const byPlayer = new Map<string, RBWeeklyStat[]>();
      for (const r of allRBWeekly) {
        const rows = byPlayer.get(r.player_id) || [];
        rows.push(r);
        byPlayer.set(r.player_id, rows);
      }
      const leaguePool: AggregatedRB[] = [];
      byPlayer.forEach((rows) => {
        const agg = aggregateRBWeekly(rows);
        if (agg.carries >= PFR_MIN) leaguePool.push(agg);
      });
      const total = leaguePool.length;

      radarLabels = RB_RADAR_LABELS;
      radarValues = RB_RADAR_KEYS.map((key) => {
        const sorted = leaguePool.map((p) => getRBRadarVal(p, key)).filter((v) => !isNaN(v)).sort((a, b) => a - b);
        return computePercentile(sorted, getRBRadarVal(playerAgg, key));
      });

      chipStats = RB_RADAR_KEYS.map((key) => {
        const val = getRBRadarVal(playerAgg, key);
        const poolVals = leaguePool.map((p) => getRBRadarVal(p, key)).filter((v) => !isNaN(v));
        const rank = computeRank(poolVals, val);
        return { label: RB_RADAR_LABELS[RB_RADAR_KEYS.indexOf(key)], value: formatRBChip(key, val), rank: `${ordinal(rank)} of ${total}` };
      });

      barStats = RB_BAR_STATS.map((stat) => {
        const isPct = stat.key === "success_rate";
        const val = getRBBarVal(playerAgg, stat.key);
        const poolVals = leaguePool.map((p) => getRBBarVal(p, stat.key));
        return buildBarStat(val, poolVals, stat.label, isPct);
      });
    } else {
      notFound();
    }
  } catch {
    notFound();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f8fafc",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* The card */}
      <StatCardView
        playerName={player.player_name}
        position={player.position}
        teamName={teamName}
        teamColor={teamColor}
        season={season}
        radarValues={radarValues}
        radarLabels={radarLabels}
        chipStats={chipStats}
        barStats={barStats}
      />

      {/* Actions below the card */}
      <CardPageActions slug={slug} />

      {/* Link back to player profile */}
      <a
        href={`/player/${slug}`}
        style={{
          marginTop: 12,
          fontSize: 14,
          color: "#64748b",
          textDecoration: "none",
        }}
      >
        View full player profile &rarr;
      </a>
    </div>
  );
}
