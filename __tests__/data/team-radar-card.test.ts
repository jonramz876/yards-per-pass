// lib/data/team-radar-card.ts (team radar PR 3; spec §7 "The image route, in
// order", review I5): the one loader the share page, its metadata and the
// image route all use. It decides `uncovered` before the season-wide read, and
// keeps a short per-season memo of that read (the in-flight promise, dropped
// on rejection) so a page view, its metadata and its preview image share it.
import { describe, it, expect, beforeEach, vi } from "vitest";
import rowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";

vi.mock("@/lib/data/team-radar", () => ({ getTeamRadarRows: vi.fn() }));
vi.mock("@/lib/data/box-score", () => ({ getBoxScoreSeasonsCached: vi.fn() }));

import { getTeamRadarRows } from "@/lib/data/team-radar";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import {
  TEAM_RADAR_MEMO_TTL_MS,
  clearTeamRadarCardMemo,
  getTeamRadarRowsCached,
  loadTeamRadarCard,
} from "@/lib/data/team-radar-card";

const ROWS = rowsJson as never[];
const SEASONS = [2026, 2025, 2024];
const FAILED = new Error("Failed to fetch team radar rows for 2026: TypeError: fetch failed");

beforeEach(() => {
  clearTeamRadarCardMemo();
  vi.useRealTimers();
  vi.mocked(getTeamRadarRows).mockReset();
  vi.mocked(getBoxScoreSeasonsCached).mockReset();
  vi.mocked(getTeamRadarRows).mockResolvedValue(ROWS);
  vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("getTeamRadarRowsCached — a short per-season memo of the season-wide read", () => {
  it("concurrent callers share one read", async () => {
    const [a, b, c] = await Promise.all([getTeamRadarRowsCached(2026), getTeamRadarRowsCached(2026), getTeamRadarRowsCached(2026)]);
    expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
    expect(getTeamRadarRows).toHaveBeenCalledWith(2026);
    expect(a).toBe(b);
    expect(b).toBe(c);
  });

  it("a later caller inside the window reuses it; each season has its own entry", async () => {
    await getTeamRadarRowsCached(2026);
    await getTeamRadarRowsCached(2026);
    await getTeamRadarRowsCached(2025);
    expect(vi.mocked(getTeamRadarRows).mock.calls.map((c) => c[0])).toEqual([2026, 2025]);
  });

  it("the window is short (a minute): after it the season is read again", async () => {
    expect(TEAM_RADAR_MEMO_TTL_MS).toBe(60_000);
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T12:00:00Z"));
    await getTeamRadarRowsCached(2026);
    vi.setSystemTime(new Date("2026-10-06T12:00:59Z"));
    await getTeamRadarRowsCached(2026);
    expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date("2026-10-06T12:01:01Z"));
    await getTeamRadarRowsCached(2026);
    expect(getTeamRadarRows).toHaveBeenCalledTimes(2);
  });

  it("a rejection is never kept: every waiting caller gets it, and the next call reads again", async () => {
    vi.mocked(getTeamRadarRows).mockRejectedValueOnce(FAILED);
    const results = await Promise.allSettled([getTeamRadarRowsCached(2026), getTeamRadarRowsCached(2026)]);
    expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
    expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
    await expect(getTeamRadarRowsCached(2026)).resolves.toBe(ROWS);
    expect(getTeamRadarRows).toHaveBeenCalledTimes(2);
  });

  it("a read that throws before it returns a promise is a rejection too, and is not kept", async () => {
    vi.mocked(getTeamRadarRows).mockImplementationOnce(() => {
      throw FAILED;
    });
    await expect(getTeamRadarRowsCached(2026)).rejects.toThrow("Failed to fetch team radar rows");
    await expect(getTeamRadarRowsCached(2026)).resolves.toBe(ROWS);
  });
});

describe("loadTeamRadarCard", () => {
  it("ready: the team's slice for the season, from one row read", async () => {
    const slice = await loadTeamRadarCard("BUF", 2026, SEASONS);
    expect(slice.state).toBe("ready");
    if (slice.state !== "ready") return;
    expect(slice.teamsPlayed).toBe(32);
    expect(slice.games).toBe(3);
    expect(slice.throughWeek).toBe(3);
    expect(slice.isLatestSeason).toBe(true);
    expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
    expect(getBoxScoreSeasonsCached).toHaveBeenCalledWith(SEASONS);
  });

  it("a past season the probe does not cover is `uncovered` with NO row read (R12 names the first covered season)", async () => {
    const slice = await loadTeamRadarCard("BUF", 2025, SEASONS);
    expect(slice).toEqual({ state: "uncovered", season: 2025, firstSeason: 2026 });
    expect(getTeamRadarRows).not.toHaveBeenCalled();
  });

  it("a gap season (covered seasons on both sides) is `uncovered` with no year named, and no row read", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2024]);
    const slice = await loadTeamRadarCard("BUF", 2025, SEASONS);
    expect(slice).toEqual({ state: "uncovered", season: 2025, firstSeason: null });
    expect(getTeamRadarRows).not.toHaveBeenCalled();
  });

  it("a past season the probe covers is read", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026, 2025]);
    vi.mocked(getTeamRadarRows).mockResolvedValue((ROWS as Record<string, unknown>[]).map((r) => ({ ...r, season: 2025 })) as never[]);
    const slice = await loadTeamRadarCard("BUF", 2025, SEASONS);
    expect(slice.state).toBe("ready");
    expect(getTeamRadarRows).toHaveBeenCalledWith(2025);
  });

  it("the newest season is always read, covered or not (its rows are the proof)", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([]);
    await loadTeamRadarCard("BUF", 2026, SEASONS);
    expect(getTeamRadarRows).toHaveBeenCalledWith(2026);
  });

  it("a failed coverage probe is logged and does not fail the card; a past season is then read (nothing was decided)", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("Failed to fetch box score seasons: timeout"));
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    const slice = await loadTeamRadarCard("BUF", 2025, SEASONS);
    expect(slice).toEqual({ state: "uncovered", season: 2025, firstSeason: null });
    expect(getTeamRadarRows).toHaveBeenCalledWith(2025);
    expect(console.error).toHaveBeenCalled();
  });

  it("a failed row read rejects (the page shows its error card, the image route answers 503); never an empty card", async () => {
    vi.mocked(getTeamRadarRows).mockRejectedValue(FAILED);
    await expect(loadTeamRadarCard("BUF", 2026, SEASONS)).rejects.toThrow("Failed to fetch team radar rows");
  });

  it("no rows for the newest season is `unavailable` (a read failing silently), not a message page", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    expect((await loadTeamRadarCard("BUF", 2026, SEASONS)).state).toBe("unavailable");
  });

  it("no-games and small-pool come from teamRadarState unchanged", async () => {
    const rows = ROWS as Record<string, unknown>[];
    vi.mocked(getTeamRadarRows).mockResolvedValue(rows.filter((r) => r.game_id === "2026_01_BUF_HOU") as never[]);
    expect((await loadTeamRadarCard("KC", 2026, SEASONS)).state).toBe("small-pool");
    clearTeamRadarCardMemo();
    const eight = rows.filter((r) => r.week === 1 && r.team_id !== "KC" && r.opponent_id !== "KC").slice(0, 8);
    vi.mocked(getTeamRadarRows).mockResolvedValue(eight as never[]);
    expect((await loadTeamRadarCard("KC", 2026, SEASONS)).state).toBe("no-games");
  });

  it("an empty seasons list (no database): the probe is not asked and the season is read", async () => {
    vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([]);
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    const slice = await loadTeamRadarCard("BUF", 2026, []);
    expect(slice).toEqual({ state: "uncovered", season: 2026, firstSeason: null });
  });

  it("a rate outside 0-1 is dropped and logged once, never printed", async () => {
    const rows = (ROWS as Record<string, unknown>[]).map((r) => (r.team_id === "BUF" ? { ...r, stuffed_runs: 999 } : r));
    vi.mocked(getTeamRadarRows).mockResolvedValue(rows as never[]);
    vi.mocked(console.error).mockClear();
    const slice = await loadTeamRadarCard("BUF", 2026, SEASONS);
    if (slice.state !== "ready") throw new Error(slice.state);
    expect(slice.off.spokes[4].value).toBeNull();
    expect(slice.league.stuff).toBeNull();
    expect(console.error).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(console.error).mock.calls[0][0])).toContain("outside 0-1");
  });
});
