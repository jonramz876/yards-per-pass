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

vi.mock("@/components/team/TeamHubContent", () => ({
  default: vi.fn(() => null),
}));

import TeamPage from "@/app/team/[team_id]/page";
import TeamHubContent from "@/components/team/TeamHubContent";
import { getBoxScoreSeasonsCached } from "@/lib/data/box-score";
import { getAvailableSeasons } from "@/lib/data/queries";
import { getTeamHubData } from "@/lib/data/team-hub";

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
