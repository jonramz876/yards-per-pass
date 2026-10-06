import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
  fallbackSeason: () => 2026,
}));

vi.mock("@/lib/data/team-hub", () => ({
  getTeamHubData: vi.fn(async () => ({ currentSeason: 2026, seasons: [2026, 2025] })),
}));

vi.mock("@/lib/data/box-score", () => ({
  getBoxScoreSeasons: vi.fn(async () => []),
  getBoxScoreSeasonsCached: vi.fn(async () => []),
}));

vi.mock("@/lib/data/team-radar", () => ({
  getTeamRadarRows: vi.fn(async () => []),
}));

vi.mock("@/components/team/TeamHubContent", () => ({
  default: vi.fn(() => null),
}));

import TeamPage from "@/app/team/[team_id]/page";
import TeamHubContent from "@/components/team/TeamHubContent";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getAvailableSeasons } from "@/lib/data/queries";
import { getTeamHubData } from "@/lib/data/team-hub";
import { getTeamRadarRows } from "@/lib/data/team-radar";
import radarRowsJson from "../stats/fixtures/team-radar-2026-w1-3.json";
import { buildTeamRadar } from "@/lib/stats/team-radar";

const RADAR_ROWS = radarRowsJson as Record<string, unknown>[];

async function contentProps(teamId = "buf") {
  render(
    await TeamPage({
      params: Promise.resolve({ team_id: teamId }),
      searchParams: Promise.resolve({}),
    })
  );
  const calls = vi.mocked(TeamHubContent).mock.calls;
  return calls[calls.length - 1][0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBoxScoreSeasonsCached).mockReset();
  vi.mocked(getBoxScoreSeasonsCached).mockResolvedValue([2026]);
  vi.mocked(getTeamRadarRows).mockReset();
  vi.mocked(getTeamRadarRows).mockResolvedValue(RADAR_ROWS as never);
});

// Team radar spec 2026-10-06 §6-§7. The radar read is its own read, one per
// page view, and is the second read on this page that may degrade: when it
// fails the hub still renders and the section says "unavailable" (R13).
describe("TeamPage — team radar read", () => {
  async function propsFor(season?: string, teamId = "buf") {
    render(
      await TeamPage({
        params: Promise.resolve({ team_id: teamId }),
        searchParams: Promise.resolve(season ? { season } : {}),
      })
    );
    const calls = vi.mocked(TeamHubContent).mock.calls;
    return calls[calls.length - 1][0];
  }

  it("reads the viewed season's rows exactly once and hands the hub this team's ready slice", async () => {
    const props = await propsFor();
    expect(getTeamRadarRows).toHaveBeenCalledTimes(1);
    expect(vi.mocked(getTeamRadarRows).mock.calls[0][0]).toBe(2026);
    const radar = props.radar;
    if (radar.state !== "ready") throw new Error(radar.state);
    const buf = buildTeamRadar(RADAR_ROWS).teams.find((t) => t.team === "BUF")!;
    expect(radar.off).toEqual(buf.off);
    expect(radar.def).toEqual(buf.def);
    expect(radar.teamsPlayed).toBe(32);
    expect(radar.games).toBe(3);
    expect(radar.throughWeek).toBe(3);
    expect(radar.isLatestSeason).toBe(true);
  });

  it("the slice is plain data: it survives JSON unchanged and carries null, never NaN (review M10)", async () => {
    const junk = RADAR_ROWS.map((r) =>
      r.team_id === "BUF" ? { ...r, pass_success_rate: "NaN", designed_runs: null, rush_plays: 0, total_drives: 0 } : r
    );
    vi.mocked(getTeamRadarRows).mockResolvedValue(junk as never);
    const { radar } = await propsFor();
    if (radar.state !== "ready") throw new Error(radar.state);
    expect(JSON.parse(JSON.stringify(radar))).toEqual(radar);
    expect(JSON.stringify(radar)).not.toMatch(/NaN|Infinity/);
    const values = Object.fromEntries(radar.off.spokes.map((s) => [s.key, s.value]));
    expect(values).toMatchObject({ pass_sr: null, stuff: null, expl_rush: null, rush_sr: null, to: null });
    expect(values.expl_pass).not.toBeNull();
  });

  it("a broken row (a rate outside 0-1) is a missing spoke, logged once on the server, never handed down", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = RADAR_ROWS.map((r) =>
      r.game_id === "2026_01_BUF_HOU" && r.team_id === "BUF" ? { ...r, stuffed_runs: 600, designed_runs: 20 } : r
    );
    vi.mocked(getTeamRadarRows).mockResolvedValue(broken as never);
    const { radar } = await propsFor();
    if (radar.state !== "ready") throw new Error(radar.state);
    expect(radar.off.spokes.find((s) => s.key === "stuff")).toMatchObject({ value: null, rank: null });
    for (const s of [...radar.off.spokes, ...radar.def.spokes]) {
      if (s.value !== null) expect(s.value >= 0 && s.value <= 1).toBe(true);
    }
    expect(radar.league.stuff).toBeNull();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toMatch(/BUF.*outside 0-1.*BUF off stuff/);
    logged.mockRestore();
  });

  it("rows of another season or repeated rows cannot inflate the radar (defence in depth)", async () => {
    const doubled = [...RADAR_ROWS, ...RADAR_ROWS, ...RADAR_ROWS.map((r) => ({ ...r, season: 2025 }))];
    vi.mocked(getTeamRadarRows).mockResolvedValue(doubled as never);
    const { radar } = await propsFor();
    if (radar.state !== "ready") throw new Error(radar.state);
    expect(radar.games).toBe(3);
    expect(radar.off).toEqual(buildTeamRadar(RADAR_ROWS).teams.find((t) => t.team === "BUF")!.off);
  });

  it("a team whose own rows are missing (a half-written game) is told no-games, not 'through 0 games'", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue(RADAR_ROWS.filter((r) => r.team_id !== "BUF") as never);
    expect((await propsFor()).radar).toEqual({ state: "no-games", season: 2026 });
  });

  it("the radar read rejecting still renders the hub: state unavailable, logged once with the team", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getTeamRadarRows).mockRejectedValue(new Error("Failed to fetch team radar rows for 2026: fetch failed"));
    const props = await propsFor();
    expect(props.radar).toEqual({ state: "unavailable", season: 2026 });
    expect(props.team.id).toBe("BUF");
    expect(props.boxScoreSeasons).toEqual([2026]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("BUF");
    expect(String(logged.mock.calls[0][0])).toMatch(/radar/i);
    logged.mockRestore();
  });

  it("the radar read throwing synchronously (before a promise exists) still renders the hub", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getTeamRadarRows).mockImplementation((() => {
      throw new Error("threw before returning a promise");
    }) as unknown as typeof getTeamRadarRows);
    const props = await propsFor();
    expect(props.radar).toEqual({ state: "unavailable", season: 2026 });
    expect(logged).toHaveBeenCalledTimes(1);
    logged.mockRestore();
  });

  it("no rows for the newest season is a silently failing read: unavailable, and logged", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    const props = await propsFor();
    expect(props.radar).toEqual({ state: "unavailable", season: 2026 });
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toMatch(/radar/i);
    logged.mockRestore();
  });

  it("a past season with no rows: uncovered, naming the first covered season from the probe the page already ran", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    const props = await propsFor("2025");
    expect(vi.mocked(getTeamRadarRows).mock.calls[0][0]).toBe(2025);
    expect(props.radar).toEqual({ state: "uncovered", season: 2025, firstSeason: 2026 });
    expect(getBoxScoreSeasonsCached).toHaveBeenCalledTimes(1);
  });

  it("a failed coverage probe degrades to 'not available for the season' (no year named), never a crash", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("probe down"));
    const props = await propsFor("2025");
    expect(props.radar).toEqual({ state: "uncovered", season: 2025, firstSeason: null });
    logged.mockRestore();
  });

  it("a season later than the newest data season (the hub offers season + 1): small-pool, not an error", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue([]);
    const props = await propsFor("2027");
    expect(props.radar).toEqual({ state: "small-pool", season: 2027 });
  });

  it("opening Thursday: two teams have played, a third team's page says small-pool, not no-games", async () => {
    vi.mocked(getTeamRadarRows).mockResolvedValue(RADAR_ROWS.filter((r) => r.game_id === "2026_01_BUF_HOU") as never);
    expect((await propsFor(undefined, "kc")).radar).toEqual({ state: "small-pool", season: 2026 });
  });

  it("an unknown team 404s before the radar read; a failed hub read still rejects the page", async () => {
    await expect(propsFor(undefined, "xyz")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getTeamRadarRows).not.toHaveBeenCalled();
    vi.mocked(getTeamHubData).mockRejectedValueOnce(new Error("Failed to fetch team stats: fetch failed"));
    await expect(propsFor()).rejects.toThrow("Failed to fetch team stats");
  });

  it("with no database (placeholder build) the page still renders; the radar is simply unavailable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getAvailableSeasons).mockResolvedValueOnce([]);
    vi.mocked(getTeamRadarRows).mockRejectedValue(new Error("fetch failed"));
    const props = await propsFor();
    expect(props.radar).toEqual({ state: "unavailable", season: 2026 });
    logged.mockRestore();
    vi.unstubAllEnvs();
  });
});

describe("TeamPage — box score link gate (spec §7)", () => {
  it("probes the available seasons through the memo and passes the covered ones down", async () => {
    const props = await contentProps();
    expect(getBoxScoreSeasonsCached).toHaveBeenCalledWith([2026, 2025]);
    expect(props.boxScoreSeasons).toEqual([2026]);
    expect(props.team.id).toBe("BUF");
  });

  it("renders unlinked (and logs) when the probe fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getBoxScoreSeasonsCached).mockRejectedValue(new Error("Failed to fetch box score seasons: fetch failed"));
    const props = await contentProps();
    expect(props.boxScoreSeasons).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("BUF");
    logged.mockRestore();
  });

  // Chaos DEGRADED 2: the .catch() was attached to the call's RETURN value, so
  // a throw before the promise existed was never caught and 500'd the whole
  // team hub, unlogged. Safe only by the probe's `async` keyword. try/catch
  // makes it structural — the same fix the Game Log got in an earlier PR.
  it("renders unlinked (and logs) when the probe throws synchronously", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getBoxScoreSeasonsCached).mockImplementation((() => {
      throw new Error("probe threw before returning a promise");
    }) as unknown as typeof getBoxScoreSeasonsCached);
    const props = await contentProps();
    expect(props.boxScoreSeasons).toEqual([]);
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("BUF");
    logged.mockRestore();
  });

  it("unknown team still 404s", async () => {
    await expect(contentProps("xyz")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
  });
});

// Read resilience spec §1.2. A failed read on this page used to render the
// team name over empty sections; core reads now reject, which Next hands to
// app/team/[team_id]/error.tsx ("Unable to load team data").
describe("TeamPage — a failed read is an error, never a blank team page", () => {
  const REAL_URL = "https://abcdefghijklmnop.supabase.co";

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", REAL_URL);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("seasons read fails → throws, before any other read", async () => {
    vi.mocked(getAvailableSeasons).mockRejectedValueOnce(new Error("Failed to fetch seasons: TypeError: fetch failed"));
    await expect(contentProps()).rejects.toThrow("Failed to fetch seasons");
    expect(getTeamHubData).not.toHaveBeenCalled();
  });

  it("the hub data rejects (one of its ten core reads failed) → throws", async () => {
    vi.mocked(getTeamHubData).mockRejectedValueOnce(new Error("Failed to fetch team stats: TypeError: fetch failed"));
    await expect(contentProps()).rejects.toThrow("Failed to fetch team stats");
    expect(TeamHubContent).not.toHaveBeenCalled();
  });

  it("an empty data_freshness table with a real database → throws (homepage rule)", async () => {
    vi.mocked(getAvailableSeasons).mockResolvedValueOnce([]);
    await expect(contentProps()).rejects.toThrow(/no seasons/);
    expect(getTeamHubData).not.toHaveBeenCalled();
  });

  it("an empty seasons list with no database (placeholder build) → renders on the fallback season", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://placeholder.supabase.co");
    vi.mocked(getAvailableSeasons).mockResolvedValueOnce([]);
    const props = await contentProps();
    expect(props.defaultSeason).toBe(2026);
    expect(vi.mocked(getTeamHubData).mock.calls[0]).toEqual(["BUF", 2026, false]);
  });

  // Chaos regression (PR 1A): a ?season= Postgres cannot store (the column is
  // INTEGER) made the hub's reads fail, and since they are now core the page
  // showed the error card with a "Try again" that could never work. An
  // implausible season is treated as absent (parseSeasonParam, 1999-2100).
  it.each([
    ["past the INTEGER range", "99999999999"],
    ["absurdly long", "99999999999999999999"],
    ["negative", "-5"],
    ["zero", "0"],
    ["not a number", "abc"],
    ["scientific notation", "1e9"],
    ["before any NFL data", "1850"],
    ["empty", ""],
  ])("a junk ?season= (%s) renders the default season and never reaches the hub's reads", async (_name, season) => {
    render(await TeamPage({ params: Promise.resolve({ team_id: "buf" }), searchParams: Promise.resolve({ season }) }));
    expect(vi.mocked(getTeamHubData).mock.calls).toEqual([["BUF", 2026, true]]);
    expect(TeamHubContent).toHaveBeenCalled();
  });

  it("a decimal ?season= keeps its whole year, as before", async () => {
    render(await TeamPage({ params: Promise.resolve({ team_id: "buf" }), searchParams: Promise.resolve({ season: "2025.5" }) }));
    expect(vi.mocked(getTeamHubData).mock.calls).toEqual([["BUF", 2025, false]]);
  });

  it.each(["2025", "1999", "2027", "2100"])("a plausible ?season=%s is still honoured", async (season) => {
    render(await TeamPage({ params: Promise.resolve({ team_id: "buf" }), searchParams: Promise.resolve({ season }) }));
    expect(vi.mocked(getTeamHubData).mock.calls[0][1]).toBe(Number(season));
  });

  it("an unknown team is a 404 decided before any read, so it stays a 404 when the database is down", async () => {
    await expect(contentProps("xyz")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getAvailableSeasons).not.toHaveBeenCalled();
  });
});

describe("TeamPage — player links keep the viewed season", () => {
  async function propsFor(season: string) {
    render(
      await TeamPage({
        params: Promise.resolve({ team_id: "buf" }),
        searchParams: Promise.resolve({ season }),
      })
    );
    const calls = vi.mocked(TeamHubContent).mock.calls;
    return calls[calls.length - 1][0];
  }

  it("passes the site's default season down", async () => {
    vi.mocked(getTeamHubData).mockResolvedValueOnce({ currentSeason: 2024, seasons: [2026, 2025, 2024] } as never);
    const props = await propsFor("2024");
    expect(props.defaultSeason).toBe(2026);
  });

  it("trap: the hub's season list leads with next season; the default is still the page's newest", async () => {
    vi.mocked(getTeamHubData).mockResolvedValueOnce({ currentSeason: 2026, seasons: [2027, 2026, 2025] } as never);
    const props = await propsFor("2026");
    expect(props.defaultSeason).toBe(2026);
  });
});
