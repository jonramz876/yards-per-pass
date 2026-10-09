import { describe, it, expect, beforeEach, vi } from "vitest";

// getPlayerSlugIndex (compare card spec 2026-10-09 section 6.1, review R2):
// every player slug as a Map, read in a fixed order. The comparison image
// route resolves both players from it, behind a memo.
const fetchAllRows = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/utils")>()),
  fetchAllRows,
}));
vi.mock("@/lib/supabase/server", () => ({ createServerClient: () => { throw new Error("no direct client read expected"); } }));

import { getPlayerSlugIndex, PLAYER_SLUG_INDEX_COLUMNS } from "@/lib/data/players";

const ROWS = [
  { slug: "josh-allen", player_id: "00-0034857", player_name: "Josh Allen", position: "QB", current_team_id: "BUF" },
  { slug: "matthew-stafford", player_id: "00-0026498", player_name: "Matthew Stafford", position: "QB", current_team_id: "LA" },
];

beforeEach(() => {
  fetchAllRows.mockReset();
  fetchAllRows.mockResolvedValue(ROWS);
});

describe("getPlayerSlugIndex", () => {
  it("reads the five narrow columns of player_slugs IN SLUG ORDER (unordered pages can skip a row)", async () => {
    await getPlayerSlugIndex();
    expect(fetchAllRows).toHaveBeenCalledTimes(1);
    expect(fetchAllRows).toHaveBeenCalledWith("player_slugs", "slug, player_id, player_name, position, current_team_id", {}, { order: ["slug"] });
    expect(PLAYER_SLUG_INDEX_COLUMNS).toBe("slug, player_id, player_name, position, current_team_id");
  });

  it("returns a Map by slug", async () => {
    const index = await getPlayerSlugIndex();
    expect(index.size).toBe(2);
    expect(index.get("josh-allen")).toEqual(ROWS[0]);
    expect(index.get("nobody")).toBeUndefined();
  });

  it("skips a row with no usable slug; no rows is an empty Map", async () => {
    fetchAllRows.mockResolvedValue([...ROWS, { slug: null, player_id: "x" }, { slug: "", player_id: "y" }, { player_id: "z" }]);
    expect((await getPlayerSlugIndex()).size).toBe(2);
    fetchAllRows.mockResolvedValue([]);
    expect((await getPlayerSlugIndex()).size).toBe(0);
  });

  it("a failed read throws an Error (fetchAllRows rejects with a raw object)", async () => {
    fetchAllRows.mockRejectedValue({ message: "TypeError: fetch failed" });
    await expect(getPlayerSlugIndex()).rejects.toThrow(/Failed to fetch player slug index/);
    await expect(getPlayerSlugIndex()).rejects.toBeInstanceOf(Error);
  });
});
