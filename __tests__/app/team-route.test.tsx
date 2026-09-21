import { describe, it, expect, beforeEach, vi } from "vitest";
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

  it("logs the silent path: no seasons from data_freshness means no links", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getAvailableSeasons).mockResolvedValueOnce([]);
    await contentProps();
    expect(logged).toHaveBeenCalledTimes(1);
    expect(String(logged.mock.calls[0][0])).toContain("no seasons from data_freshness");
    logged.mockRestore();
  });

  it("unknown team still 404s", async () => {
    await expect(contentProps("xyz")).rejects.toThrow("NEXT_NOT_FOUND");
    expect(getBoxScoreSeasonsCached).not.toHaveBeenCalled();
  });
});
