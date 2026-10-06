import { describe, it, expect, beforeEach, vi } from "vitest";

// Read resilience spec §1.2 (review M7): fetchAllRows rejects with the raw
// PostgREST object. Every loader that calls it rethrows an Error through
// queryError, so error boundaries and logs get a message, not a bare object.
// (The run-gaps and player-slug callers are in run-gaps.test.ts / players.test.ts.)
const fetchAllRows = vi.fn();
vi.mock("@/lib/data/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data/utils")>()),
  fetchAllRows: (...args: unknown[]) => fetchAllRows(...args),
}));

import fs from "fs";
import path from "path";
import { queryError, summarizeUpstreamError } from "@/lib/data/utils";
import { getRBSeasonStats } from "@/lib/data/rushing";
import { getAllSurgeData, getWeeklyForStat, SURGE_STATS } from "@/lib/data/trends";
import type { PlayerSlug } from "@/lib/types";

const RAW_ERROR = { message: "TypeError: fetch failed", details: "", hint: "", code: "" };

beforeEach(() => {
  fetchAllRows.mockReset();
});

describe("queryError", () => {
  it("turns a raw PostgREST object into an Error that keeps its message and the cause", () => {
    const err = queryError("run gap stats", RAW_ERROR);
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toBe("Failed to fetch run gap stats: TypeError: fetch failed");
    expect(err.cause).toBe(RAW_ERROR);
  });

  it("keeps the message of an Error", () => {
    const cause = new Error("Missing Supabase env vars.");
    const err = queryError("seasons", cause);
    expect(err.message).toBe("Failed to fetch seasons: Missing Supabase env vars.");
    expect(err.cause).toBe(cause);
  });

  it.each([
    [{ code: "PGRST301" }, 'Failed to fetch x: {"code":"PGRST301"}'],
    [{ message: 42 }, 'Failed to fetch x: {"message":42}'],
    [{ message: "" }, "Failed to fetch x: "],
    [null, "Failed to fetch x: null"],
    [undefined, "Failed to fetch x: undefined"],
    ["boom", 'Failed to fetch x: "boom"'],
  ])("never throws on an error with no usable message: %j", (raw, expected) => {
    expect(queryError("x", raw).message).toBe(expected);
  });

  it("survives an object JSON cannot serialise", () => {
    const loop: Record<string, unknown> = {};
    loop.self = loop;
    expect(queryError("x", loop).message).toBe("Failed to fetch x: [object Object]");
  });
});

// Chaos K3: when the gateway answers with a web page (a Cloudflare 522),
// postgrest-js puts the whole body in error.message. Unbounded, that was 8 KB
// of HTML in every log line and in /api/health's answer.
describe("queryError keeps an upstream error body short", () => {
  const HTML_522 =
    "<!DOCTYPE html><html><head><title>yardsperpass.supabase.co | 522: Connection timed out</title></head><body>" +
    "<script>alert('xss')</script>" +
    "<p>filler</p>".repeat(700) +
    "</body></html>";

  it("an 8 KB HTML error page becomes one short sentence with the page title and no markup", () => {
    expect(HTML_522.length).toBeGreaterThan(8000);
    const err = queryError("seasons", { message: HTML_522 });
    expect(err.message).toBe(
      "Failed to fetch seasons: upstream returned an HTML error page (yardsperpass.supabase.co | 522: Connection timed out)",
    );
    expect(err.message).not.toMatch(/[<>]/);
  });

  it("an HTML page with no title still says what it was", () => {
    const err = queryError("seasons", { message: "<html><body><h1>Bad gateway</h1></body></html>" });
    expect(err.message).toBe("Failed to fetch seasons: upstream returned an HTML error page");
  });

  it("the HTTP status is named when the caller knows it", () => {
    expect(summarizeUpstreamError({ message: HTML_522 }, 522)).toBe(
      "upstream returned an HTML error page (HTTP 522, yardsperpass.supabase.co | 522: Connection timed out)",
    );
    expect(summarizeUpstreamError({ message: "<html></html>" }, 502)).toBe(
      "upstream returned an HTML error page (HTTP 502)",
    );
  });

  it("a long plain-text message is cut at 300 characters and says how much was dropped", () => {
    const err = queryError("x", { message: "a".repeat(1000) });
    expect(err.message).toBe(`Failed to fetch x: ${"a".repeat(300)}... (700 more characters)`);
  });

  it("a message of exactly 300 characters is left alone", () => {
    expect(summarizeUpstreamError({ message: "b".repeat(300) })).toBe("b".repeat(300));
  });

  it("the cause does not smuggle the oversized body back into the logs", () => {
    const err = queryError("seasons", { message: HTML_522, code: "", details: "d".repeat(5000), hint: null });
    expect(JSON.stringify(err.cause).length).toBeLessThan(1000);
    expect(JSON.stringify(err.cause)).not.toContain("<script>");
  });

  it("a short message is unchanged, and so is its cause (guard)", () => {
    const raw = { message: "TypeError: fetch failed", code: "", details: "", hint: "" };
    const err = queryError("seasons", raw);
    expect(err.message).toBe("Failed to fetch seasons: TypeError: fetch failed");
    expect(err.cause).toBe(raw);
  });
});

// Chaos K2: loaders built their message from `error.message` directly, so an
// error with no message logged "Failed to fetch seasons: undefined".
describe("no loader builds its message from error.message directly", () => {
  // A tripwire, not a proof: it catches a message assembled from any
  // `<name>.message` by template or by "+", in any file under lib/data
  // (subfolders included). lib/data/utils.ts is where queryError itself reads
  // the message, so it is the one file left out.
  const ASSEMBLED = /\$\{\s*\w+\??\.message\s*\}|\+\s*\w+\??\.message\b/;

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return sourceFiles(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }

  it("the pattern catches the shapes it is meant to", () => {
    for (const bad of [
      "throw new Error(`Failed to fetch x: ${error.message}`)",
      "throw new Error(`x: ${ err.message }`)",
      "throw new Error(`x: ${e?.message}`)",
      'throw new Error("x: " + error.message)',
    ]) {
      expect(ASSEMBLED.test(bad), bad).toBe(true);
    }
    for (const fine of ['throw queryError("seasons", error)', "const m = summarizeUpstreamError(err)"]) {
      expect(ASSEMBLED.test(fine), fine).toBe(false);
    }
  });

  it("every lib/data file reports a query error through queryError", () => {
    const dir = path.resolve(__dirname, "../../lib/data");
    const files = sourceFiles(dir).filter((f) => path.resolve(f) !== path.join(dir, "utils.ts"));
    expect(files.length).toBeGreaterThan(8);
    const offenders: string[] = [];
    for (const file of files) {
      fs.readFileSync(file, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (ASSEMBLED.test(line)) offenders.push(`${path.relative(dir, file)}:${i + 1}`);
        });
    }
    expect(offenders).toEqual([]);
  });
});

describe("getRBSeasonStats", () => {
  it("returns parsed rows, and [] for a read with no rows", async () => {
    fetchAllRows.mockResolvedValue([{ player_id: "p1", yards_per_carry: "4.5" }]);
    expect((await getRBSeasonStats(2026))[0].yards_per_carry).toBe(4.5);
    fetchAllRows.mockResolvedValue([]);
    expect(await getRBSeasonStats(2026)).toEqual([]);
  });

  it("rethrows the raw object as an Error", async () => {
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await getRBSeasonStats(2026).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch RB season stats: TypeError: fetch failed");
  });
});

describe("trends loaders", () => {
  const slugMap = new Map<string, PlayerSlug>([
    [
      "p1",
      { player_id: "p1", slug: "josh-allen", player_name: "Josh Allen", position: "QB", current_team_id: "BUF", headshot_url: null, jersey_number: 17 },
    ],
  ]);

  it("getAllSurgeData returns a list per stat, empty lists for a read with no rows", async () => {
    fetchAllRows.mockImplementation(async (table: string) =>
      table === "qb_weekly_stats" ? [{ player_id: "p1", week: 1, epa_per_dropback: "0.2" }] : [],
    );
    const data = await getAllSurgeData(2026, slugMap);
    expect(data.get("qb_epa")).toHaveLength(1);
    expect(data.get("rb_epa")).toEqual([]);
  });

  it("getAllSurgeData rethrows the raw object as an Error", async () => {
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await getAllSurgeData(2026, slugMap).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch weekly stats: TypeError: fetch failed");
  });

  it("getWeeklyForStat returns values, [] for no rows, and rethrows an Error", async () => {
    fetchAllRows.mockResolvedValue([{ player_id: "p1", week: 1, epa_per_dropback: "0.2" }]);
    expect(await getWeeklyForStat(SURGE_STATS[0], 2026, slugMap)).toHaveLength(1);
    fetchAllRows.mockResolvedValue([]);
    expect(await getWeeklyForStat(SURGE_STATS[0], 2026, slugMap)).toEqual([]);
    fetchAllRows.mockRejectedValue(RAW_ERROR);
    const err = await getWeeklyForStat(SURGE_STATS[0], 2026, slugMap).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toBe("Failed to fetch weekly stats: TypeError: fetch failed");
  });
});
