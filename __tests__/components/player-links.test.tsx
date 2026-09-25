import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import type {
  QBSeasonStat,
  ReceiverSeasonStat,
  RBSeasonStat,
  RBGapStat,
  CrossLinkReceiver,
  CrossLinkQB,
} from "@/lib/types";
import type { WeeklyValue } from "@/lib/stats/surge";
import type { StatDef } from "@/lib/data/trends";

// Every link from a season-specific view to a player page: a past season is
// carried as ?season=, the default season stays the bare canonical URL.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/components/player/TecmoPlayerCard", () => ({ default: () => null }));
vi.mock("@/lib/stats/tecmo-card", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stats/tecmo-card")>()),
  buildQBCardData: () => ({}),
  buildWRCardData: () => ({}),
}));

import QBLeaderboard from "@/components/tables/QBLeaderboard";
import ReceiverLeaderboard from "@/components/tables/ReceiverLeaderboard";
import RBLeaderboard from "@/components/tables/RBLeaderboard";
import PassingSection from "@/components/team/PassingSection";
import GroundGameSection from "@/components/team/GroundGameSection";
import PlayerOverviewQB from "@/components/player/PlayerOverviewQB";
import PlayerOverviewWR from "@/components/player/PlayerOverviewWR";
import PlayerGapCards from "@/components/charts/PlayerGapCards";
import SurgeDetector from "@/components/trends/SurgeDetector";

const PAST = { season: 2024, defaultSeason: 2026 };
const CURRENT = { season: 2026, defaultSeason: 2026 };

const qb: QBSeasonStat = {
  id: "q1", player_id: "00-0034857", player_name: "Josh Allen", team_id: "BUF", season: 2024,
  games: 1, completions: 20, attempts: 30, dropbacks: 33, epa_per_db: 0.2, epa_per_play: 0.2,
  cpoe: 3, completion_pct: 66.7, success_rate: 0.5, passing_yards: 250, touchdowns: 2,
  interceptions: 0, sacks: 2, sack_yards_lost: 10, adot: 8, ypa: 8.3, passer_rating: 110,
  any_a: 8, rush_attempts: 5, rush_yards: 30, rush_tds: 1, rush_epa_per_play: 0.1, fumbles: 0,
  fumbles_lost: 0, td_pct: 6.7, int_pct: 0, sack_pct: 6, scramble_pct: 3, total_epa: 6,
};

const rec: ReceiverSeasonStat = {
  id: "r1", player_id: "00-0039338", player_name: "Brock Bowers", position: "TE", team_id: "LV",
  season: 2024, games: 1, targets: 10, receptions: 8, receiving_yards: 90, receiving_tds: 1,
  catch_rate: 0.8, yards_per_target: 9, yards_per_reception: 11.25, epa_per_target: 0.3, yac: 40,
  yac_per_reception: 5, air_yards: 60, air_yards_per_target: 6, target_share: 0.25, fumbles: 0,
  fumbles_lost: 0, routes_run: 30, yards_per_route_run: 3, targets_per_route_run: 0.33,
  total_snaps: 60, snap_share: 0.9, route_participation_rate: 0.8, air_yards_share: 0.2, croe: 0.05,
  receiving_success_rate: 0.6, total_receiving_epa: 3,
};

const rb: RBSeasonStat = {
  id: "b1", player_id: "00-0036223", player_name: "Jonathan Taylor", position: "RB", team_id: "IND",
  season: 2024, games: 1, carries: 20, rushing_yards: 100, rushing_tds: 1, yards_per_carry: 5,
  epa_per_carry: 0.1, success_rate: 0.45, stuff_rate: 0.15, explosive_rate: 0.1, fumbles: 0,
  fumbles_lost: 0, targets: 3, receptions: 2, receiving_yards: 15, receiving_tds: 0,
  total_touches: 22, touches_per_game: 22, total_rushing_epa: 2,
};

const gapRow = (gap: string, carries: number): RBGapStat => ({
  id: `g-${gap}`, player_id: "00-0036223", player_name: "Jonathan Taylor", team_id: "IND",
  season: 2024, gap, carries, epa_per_carry: 0.1, yards_per_carry: 4.5, success_rate: 0.45,
  stuff_rate: 0.15, explosive_rate: 0.1,
});

function hrefs(container: HTMLElement, prefix = "/player/") {
  return Array.from(container.querySelectorAll("a"))
    .map((a) => a.getAttribute("href") ?? "")
    .filter((h) => h.startsWith(prefix));
}

describe("leaderboards", () => {
  const cases = [
    ["QBLeaderboard", (s: typeof PAST) => <QBLeaderboard data={[qb]} throughWeek={1} slugMap={{ [qb.player_id]: "josh-allen" }} {...s} />, "josh-allen", "BUF"],
    ["ReceiverLeaderboard", (s: typeof PAST) => <ReceiverLeaderboard data={[rec]} throughWeek={1} slugMap={{ [rec.player_id]: "brock-bowers" }} {...s} />, "brock-bowers", "LV"],
    ["RBLeaderboard", (s: typeof PAST) => <RBLeaderboard data={[rb]} throughWeek={1} slugMap={{ [rb.player_id]: "jonathan-taylor" }} {...s} />, "jonathan-taylor", "IND"],
  ] as const;

  it.each(cases)("%s: past season carries ?season=", (_n, el, slug) => {
    const { container } = render(el(PAST));
    expect(hrefs(container)).toEqual([`/player/${slug}?season=2024`]);
  });

  it.each(cases)("%s: default season stays bare (guard)", (_n, el, slug) => {
    const { container } = render(el(CURRENT));
    expect(hrefs(container)).toEqual([`/player/${slug}`]);
  });

  it.each(cases)("%s: team link unchanged (guard)", (_n, el, _slug, team) => {
    const { container } = render(el(PAST));
    expect(hrefs(container, "/team/")).toEqual([`/team/${team}`]);
  });

  it("a row without a slug falls back to player_id and keeps the season", () => {
    const { container } = render(<QBLeaderboard data={[qb]} throughWeek={1} slugMap={{}} {...PAST} />);
    expect(hrefs(container)).toEqual(["/player/00-0034857?season=2024"]);
  });
});

describe("team hub sections", () => {
  const common = {
    slugMap: { [qb.player_id]: "josh-allen", [rec.player_id]: "brock-bowers", "00-0036223": "jonathan-taylor" },
    allTeamStats: [],
    freshness: null,
    primaryColor: "#00338D",
    secondaryColor: "#C60C30",
  };

  it("PassingSection: starting QB and receivers carry a past season", () => {
    const { container } = render(
      <PassingSection teamQBs={[qb]} teamReceivers={[rec]} teamId="BUF" {...common} {...PAST} />,
    );
    expect(hrefs(container)).toEqual(["/player/josh-allen?season=2024", "/player/brock-bowers?season=2024"]);
  });

  it("PassingSection: default season stays bare (guard)", () => {
    const { container } = render(
      <PassingSection teamQBs={[qb]} teamReceivers={[rec]} teamId="BUF" {...common} {...CURRENT} />,
    );
    expect(hrefs(container)).toEqual(["/player/josh-allen", "/player/brock-bowers"]);
  });

  it("GroundGameSection: RB rows carry a past season", () => {
    const { container } = render(
      <GroundGameSection teamRBGaps={[gapRow("LT", 12)]} teamId="IND" {...common} {...PAST} />,
    );
    expect(hrefs(container)).toEqual(["/player/jonathan-taylor?season=2024"]);
  });

  it("GroundGameSection: default season stays bare (guard)", () => {
    const { container } = render(
      <GroundGameSection teamRBGaps={[gapRow("LT", 12)]} teamId="IND" {...common} {...CURRENT} />,
    );
    expect(hrefs(container)).toEqual(["/player/jonathan-taylor"]);
  });
});

describe("player overview cross-links", () => {
  const receiver: CrossLinkReceiver = {
    player_id: "00-0038543", player_name: "Zay Flowers", slug: "zay-flowers",
    targets: 9, receptions: 6, receiving_yards: 80, receiving_tds: 1,
  };
  const teamQB: CrossLinkQB = {
    player_id: "00-0034796", player_name: "Lamar Jackson", slug: "lamar-jackson",
    dropbacks: 35, passing_yards: 250, touchdowns: 2,
  };

  it("PlayerOverviewQB 'Throws To' carries a past season", () => {
    const { container } = render(
      <PlayerOverviewQB stats={qb} allQBs={[]} teamId="BAL" topReceivers={[receiver]} {...PAST} />,
    );
    expect(hrefs(container)).toEqual(["/player/zay-flowers?season=2024"]);
  });

  it("PlayerOverviewQB default season stays bare (guard)", () => {
    const { container } = render(
      <PlayerOverviewQB stats={qb} allQBs={[]} teamId="BAL" topReceivers={[receiver]} {...CURRENT} />,
    );
    expect(hrefs(container)).toEqual(["/player/zay-flowers"]);
  });

  it("PlayerOverviewWR 'Catches From' carries a past season", () => {
    const { container } = render(
      <PlayerOverviewWR stats={rec} allReceivers={[]} teamId="BAL" teamQBData={teamQB} {...PAST} />,
    );
    expect(hrefs(container)).toEqual(["/player/lamar-jackson?season=2024"]);
  });

  it("PlayerOverviewWR default season stays bare (guard)", () => {
    const { container } = render(
      <PlayerOverviewWR stats={rec} allReceivers={[]} teamId="BAL" teamQBData={teamQB} {...CURRENT} />,
    );
    expect(hrefs(container)).toEqual(["/player/lamar-jackson"]);
  });
});

describe("PlayerGapCards", () => {
  const props = {
    stats: [gapRow("LT", 6), gapRow("RG", 6)],
    teamAvgEpa: 0,
    leagueRank: null,
    leagueAvg: { epa: null, yards: null, success: null, stuff: null, explosive: null, carries: null },
    slugMap: { "00-0036223": "jonathan-taylor" },
  };

  // All-gaps mode aggregates rows with season: 0, so the link must use the prop.
  it("All gaps: carries the viewed season, not the aggregated row's 0", () => {
    const { container } = render(<PlayerGapCards gap="ALL" {...props} {...PAST} />);
    expect(hrefs(container)).toEqual(["/player/jonathan-taylor?season=2024"]);
  });

  it("default season stays bare (guard)", () => {
    const { container } = render(<PlayerGapCards gap="ALL" {...props} {...CURRENT} />);
    expect(hrefs(container)).toEqual(["/player/jonathan-taylor"]);
  });
});

describe("SurgeDetector", () => {
  const stats: StatDef[] = [
    { key: "qb_epa", label: "EPA/Dropback", table: "qb_weekly_stats", column: "epa_per_dropback", positions: ["QB"], format: "epa" },
  ];
  // Twelve flat weeks then four at 1.0: z ≈ 1.68 over a 4-week window (≥ 1.5).
  const riser: WeeklyValue = {
    playerId: "00-0039732", playerName: "Drake Maye", teamId: "NE", position: "QB", slug: "drake-maye",
    weeks: Array.from({ length: 16 }, (_, i) => ({ week: i + 1, value: i < 12 ? 0 : 1 })),
  };

  it("a riser's link carries a past season", () => {
    const { container } = render(<SurgeDetector surgeData={{ qb_epa: [riser] }} stats={stats} {...PAST} />);
    expect(hrefs(container)).toEqual(["/player/drake-maye?season=2024"]);
  });

  it("default season stays bare (guard)", () => {
    const { container } = render(<SurgeDetector surgeData={{ qb_epa: [riser] }} stats={stats} {...CURRENT} />);
    expect(hrefs(container)).toEqual(["/player/drake-maye"]);
  });
});
