// /matchup (team matchup spec 2026-10-10 §4.2, §10): this week's games as
// one-tap rows, then two team pickers; plus the two files beside it,
// /matchup/[away] (404 only) and the route's error card.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
  useRouter: () => router,
}));
vi.mock("next/link", () => ({
  default: ({ href, children, prefetch, ...rest }: { href: string; children: React.ReactNode; prefetch?: boolean }) => (
    <a href={href} data-prefetch={prefetch === undefined ? undefined : String(prefetch)} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/data/matchup", () => ({ loadMatchup: vi.fn(), loadMatchupIndex: vi.fn() }));

import MatchupIndexPage, * as indexModule from "@/app/matchup/page";
import AwayOnlyPage from "@/app/matchup/[away]/page";
import MatchupError from "@/app/matchup/error";
import { notFound } from "next/navigation";
import { loadMatchup, loadMatchupIndex } from "@/lib/data/matchup";
import { MATCHUP_GAMES_UNAVAILABLE, matchupNoUpcomingNote } from "@/lib/stats/matchup";

const game = (away: string, home: string, over: Record<string, unknown> = {}) => ({
  game_id: `2026_05_${away}_${home}`, season: 2026, game_type: "REG", week: 5, gameday: "2026-10-11", weekday: "Sunday",
  gametime: "13:00", home_team: home, away_team: away, home_score: null, away_score: null, ...over,
});
const SLATE = {
  label: "Week 5",
  games: [
    game("LV", "NE", { gameday: "2026-10-08", weekday: "Thursday", gametime: "20:15", away_score: 17, home_score: 24 }),
    game("ARI", "SF"),
    game("BUF", "LA", { gameday: "2026-10-12", weekday: "Monday", gametime: "20:15" }),
  ],
};
const show = async () => render(await MatchupIndexPage()).container;

let errorSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.mocked(loadMatchupIndex).mockReset();
  vi.mocked(loadMatchupIndex).mockResolvedValue({ season: 2026, slate: SLATE, gamesAvailable: true } as never);
  vi.mocked(loadMatchup).mockReset();
  vi.mocked(notFound).mockClear();
  for (const fn of Object.values(router)) fn.mockReset();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  errorSpy.mockRestore();
});

describe("/matchup: the module", () => {
  // Both exports stay. They look contradictory, and neither may be tidied away:
  it("is rendered per request (force-dynamic), so a render with a failed games read is never stored", () => {
    // Without it the page reads no searchParams and would be a true ISR page:
    // a degraded render (M16) would be kept for an hour.
    expect(indexModule.dynamic).toBe("force-dynamic");
  });

  it("still exports revalidate = 3600, the safety net for its Supabase reads", () => {
    // A page with no `revalidate` had its reads kept for a year (/compare). If
    // force-dynamic does not opt the reads out, the hour bounds them.
    expect(indexModule.revalidate).toBe(3600);
  });

  it("a comment beside the two exports says why both are there", () => {
    const src = readFileSync(join(process.cwd(), "app", "matchup", "page.tsx"), "utf8");
    const at = src.indexOf("export const dynamic");
    expect(at).toBeGreaterThan(0);
    expect(src.slice(Math.max(0, at - 1200), at)).toMatch(/both/i);
  });

  it("static metadata: no read in metadata", () => {
    expect("generateMetadata" in indexModule).toBe(false);
    expect(indexModule.metadata.title).toBe("Team Matchups");
    expect(typeof indexModule.metadata.description).toBe("string");
    expect((indexModule.metadata.description as string).length).toBeGreaterThan(40);
    expect(indexModule.metadata.alternates?.canonical).toBe("https://yardsperpass.com/matchup");
  });
});

describe("/matchup: the page", () => {
  it("the slate's rows and their links, then both pickers", async () => {
    const el = await show();
    expect(el.querySelector("h1")?.textContent).toBe("TEAM MATCHUPS");
    expect(el.querySelector("[data-matchup-slate] h2")?.textContent).toBe("Week 5");
    const rows = Array.from(el.querySelectorAll("a[data-slate-row]"));
    expect(rows.map((r) => r.getAttribute("href"))).toEqual(["/matchup/LV/NE", "/matchup/ARI/SF", "/matchup/BUF/LA"]);
    for (const r of rows) expect(r.getAttribute("data-prefetch")).toBe("false");
    expect(rows[0].textContent).toContain("Final: LV 17, NE 24");
    expect(el.querySelectorAll("select[data-pick]")).toHaveLength(2);
    expect(el.querySelectorAll('select[data-pick="away"] option')).toHaveLength(33);
    expect(el.querySelector("[data-slate-note]")).toBeNull();
    expect(loadMatchupIndex).toHaveBeenCalledTimes(1);
    expect(loadMatchup).not.toHaveBeenCalled();
  });

  it("no unplayed game in the season: M14 and the pickers, no slate", async () => {
    vi.mocked(loadMatchupIndex).mockResolvedValue({ season: 2026, slate: null, gamesAvailable: true });
    const el = await show();
    expect(el.querySelector("[data-slate-note]")?.textContent).toBe(matchupNoUpcomingNote(2026));
    expect(el.querySelector("[data-matchup-slate]")).toBeNull();
    expect(el.querySelectorAll("select[data-pick]")).toHaveLength(2);
  });

  it("the games read failed: M16 (never M14), no slate, both pickers still render", async () => {
    vi.mocked(loadMatchupIndex).mockResolvedValue({ season: 2026, slate: null, gamesAvailable: false });
    const el = await show();
    expect(el.querySelector("[data-slate-note]")?.textContent).toBe(MATCHUP_GAMES_UNAVAILABLE);
    expect(el.textContent).not.toContain("No upcoming games");
    expect(el.querySelector("[data-slate-row]")).toBeNull();
    expect(el.querySelectorAll("select[data-pick]")).toHaveLength(2);
  });

  it("a failed seasons read rejects (the error card), never an empty page", async () => {
    vi.mocked(loadMatchupIndex).mockRejectedValue(new Error("Failed to fetch season weeks"));
    await expect(MatchupIndexPage()).rejects.toThrow("Failed to fetch season weeks");
  });

  it("the picker is given ids and names only", async () => {
    const src = readFileSync(join(process.cwd(), "app", "matchup", "page.tsx"), "utf8");
    expect(src).toContain("NFL_TEAMS.map((t) => ({ id: t.id, name: t.name }))");
  });
});

describe("/matchup/[away]: one team names no matchup", () => {
  it("calls notFound() and reads nothing", () => {
    expect(() => AwayOnlyPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledTimes(1);
    expect(loadMatchup).not.toHaveBeenCalled();
    expect(loadMatchupIndex).not.toHaveBeenCalled();
  });

  it("its file imports nothing but next/navigation", () => {
    const src = readFileSync(join(process.cwd(), "app", "matchup", "[away]", "page.tsx"), "utf8");
    const imports = Array.from(src.matchAll(/from\s+["']([^"']+)["']/g)).map((m) => m[1]);
    expect(imports).toEqual(["next/navigation"]);
  });
});

describe("app/matchup/error.tsx: one card for both routes", () => {
  const ERROR = Object.assign(new Error("Failed to fetch matchup rows for 2026"), { digest: "abc" });

  it("the title and the two ways out", () => {
    const { container } = render(<MatchupError error={ERROR} reset={vi.fn()} />);
    expect(screen.getByText("Unable to load matchups")).toBeTruthy();
    expect(container.querySelector('a[href="/team-stats"]')?.textContent).toBe("Team Stats");
    expect(container.querySelector('a[href="/matchup"]')?.textContent).toBe("This week’s matchups");
  });

  it("logs the error it was handed, and passes plain reset (ErrorState does the refresh)", () => {
    const reset = vi.fn();
    render(<MatchupError error={ERROR} reset={reset} />);
    expect(console.error).toHaveBeenCalledWith("Matchup page error:", ERROR);
    screen.getByText("Try again").click();
    expect(router.refresh).toHaveBeenCalledTimes(1);
    expect(reset).toHaveBeenCalledTimes(1);
  });
});
