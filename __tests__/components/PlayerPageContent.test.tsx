// Spec A §4.12 (T12): a WR/TE page says why its route stats are dashes when the
// season has no participation data. routes_run is NULL only then
// (scripts/ingest.py stores None without a participation file; with one it is
// fillna(0)), so the note keys on the player's own season row.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/player/zay-flowers",
  useSearchParams: () => new URLSearchParams(),
}));

import PlayerPageContent from "@/components/player/PlayerPageContent";
import wrPool from "../stats/fixtures/wr-te-2025-pool.json";
import type { ReceiverSeasonStat } from "@/lib/types";

const POOL = (wrPool as { rows: unknown[] }).rows as ReceiverSeasonStat[];
const flowers = {
  player_id: "00-0038559", slug: "zay-flowers", player_name: "Zay Flowers", position: "WR",
  current_team_id: "BAL", headshot_url: null, jersey_number: 4,
};
const NOTE =
  "Snap %, routes and YPRR show “—” for 2026: nflverse hasn’t published full 2026 participation data (who was on the field for each play).";

function renderPage(routes: number | null, tab: string, position = "WR") {
  const row = { ...POOL.find((r) => r.position === "WR")!, player_id: flowers.player_id, routes_run: routes as number };
  return render(
    <PlayerPageContent
      player={{ ...flowers, position }}
      seasonStats={[row]}
      weeklyStats={[]}
      allPlayers={POOL}
      season={2026}
      seasons={[2026, 2025]}
      position={position}
      tab={tab}
      gameResults={{}}
      boxScoreSeasons={[]}
    />,
  ).container;
}

function note(container: HTMLElement): string | null {
  const p = Array.from(container.querySelectorAll("p")).find((el) => (el.textContent ?? "").startsWith("Snap %, routes and YPRR"));
  return p ? p.textContent : null;
}

describe("route-data note on player pages", () => {
  it("shows under the tabs on Overview and on Game Log when routes_run is null", () => {
    for (const tab of ["overview", "game-log"]) {
      const container = renderPage(null, tab);
      expect(note(container), tab).toBe(NOTE);
      expect(container.textContent).not.toMatch(/\\u[0-9a-fA-F]{4}/);
    }
  });

  it("does not show when the season has route data", () => {
    expect(note(renderPage(31, "overview"))).toBeNull();
    expect(note(renderPage(0, "overview"))).toBeNull();
  });

  it("is only for WR/TE pages", () => {
    expect(note(renderPage(null, "overview", "TE"))).toBe(NOTE);
    expect(note(renderPage(null, "game-log", "RB"))).toBeNull();
  });
});
