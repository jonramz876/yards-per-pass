// The possession toggle (team matchup spec §4.3, §8): two tabs at every
// width; the selected one shows ONE whole wrapper (a ladder and its radar)
// and hides the other. It receives both wrappers already rendered, so it
// needs no matchup component; two marker elements stand in for them here.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, fireEvent, act } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => router,
  usePathname: () => "/matchup/BUF/LA",
  useSearchParams: () => new URLSearchParams(),
}));

import MatchupBallToggle from "@/components/matchup/MatchupBallToggle";
import { classes } from "./helpers";

type Props = Partial<Parameters<typeof MatchupBallToggle>[0]>;
const element = (over: Props = {}) => (
  <MatchupBallToggle
    awayId="BUF"
    homeId="LA"
    season={2026}
    defaultSeason={2026}
    initialBall="away"
    away={<div id="away-marker">away ladder + radar</div>}
    home={<div id="home-marker">home ladder + radar</div>}
    {...over}
  />
);
const show = (over: Props = {}) => render(element(over)).container;
const slot = (el: HTMLElement, ball: "away" | "home") => el.querySelector(`[data-ball-slot="${ball}"]`) as HTMLElement;
const tab = (el: HTMLElement, ball: "away" | "home") => el.querySelector(`[data-ball-tab="${ball}"]`) as HTMLButtonElement;
const hidden = (el: HTMLElement) => ({
  away: classes(slot(el, "away")).includes("hidden"),
  home: classes(slot(el, "home")).includes("hidden"),
});

let replaceState: ReturnType<typeof vi.spyOn>;
const setAddress = (search: string) => window.history.pushState(null, "", `/matchup/BUF/LA${search}`);

beforeEach(() => {
  setAddress("");
  replaceState = vi.spyOn(window.history, "replaceState");
  for (const fn of Object.values(router)) fn.mockReset();
});
afterEach(() => {
  replaceState.mockRestore();
});

describe("MatchupBallToggle: what it renders", () => {
  it("two tabs, away first, with no width-conditional class", () => {
    const el = show();
    const tabs = Array.from(el.querySelectorAll("[data-ball-tab]"));
    expect(tabs.map((t) => t.textContent)).toEqual(["WHEN BUF HAS THE BALL", "WHEN LA HAS THE BALL"]);
    for (const t of tabs) {
      const cls = classes(t);
      expect(cls.some((c) => /(^|:)hidden$|:block$|:flex$/.test(c))).toBe(false);
      expect(cls).toEqual(expect.arrayContaining(["flex-1", "min-w-0"]));
    }
  });

  it("both slots are in the DOM; the unselected one is hidden and nothing can un-hide it", () => {
    const el = show();
    expect(el.querySelector("#away-marker")).not.toBeNull();
    expect(el.querySelector("#home-marker")).not.toBeNull();
    expect(hidden(el)).toEqual({ away: false, home: true });
    expect(classes(slot(el, "home"))).toEqual(["hidden"]);
    expect(classes(slot(el, "away")).some((c) => /overflow/.test(c))).toBe(false);
  });

  it("initialBall=\"home\" shows the home slot and hides the away slot in the server's HTML (no flash)", () => {
    const doc = document.createElement("div");
    doc.innerHTML = renderToStaticMarkup(element({ initialBall: "home" }));
    expect(hidden(doc)).toEqual({ away: true, home: false });
    expect(tab(doc, "home").getAttribute("aria-pressed")).toBe("true");
    const bare = document.createElement("div");
    bare.innerHTML = renderToStaticMarkup(element());
    expect(hidden(bare)).toEqual({ away: false, home: true });
  });

  it("neither tab is red: the selected one is navy", () => {
    const el = show();
    expect(el.innerHTML).not.toMatch(/#D50A0A|nflred|red-\d00/i);
    expect(classes(tab(el, "away")).join(" ")).toMatch(/bg-navy/);
    expect(classes(tab(el, "home")).join(" ")).not.toMatch(/bg-navy/);
  });
});

describe("MatchupBallToggle: a tab press", () => {
  it("swaps which slot is hidden, so the ladder and the radar inside it move together", () => {
    const el = show();
    fireEvent.click(tab(el, "home"));
    expect(hidden(el)).toEqual({ away: true, home: false });
    fireEvent.click(tab(el, "away"));
    expect(hidden(el)).toEqual({ away: false, home: true });
  });

  it("changes the address with history.replaceState to matchupHref's URL, and makes no router call", () => {
    const el = show();
    fireEvent.click(tab(el, "home"));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/matchup/BUF/LA?ball=home");
    fireEvent.click(tab(el, "away"));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/matchup/BUF/LA");
    expect(replaceState).toHaveBeenCalledTimes(2);
    for (const fn of Object.values(router)) expect(fn).not.toHaveBeenCalled();
  });

  it("keeps a past season in the address, season before ball", () => {
    const el = show({ season: 2025 });
    fireEvent.click(tab(el, "home"));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/matchup/BUF/LA?season=2025&ball=home");
    fireEvent.click(tab(el, "away"));
    expect(replaceState).toHaveBeenLastCalledWith(null, "", "/matchup/BUF/LA?season=2025");
  });

  it("pressing the selected tab again changes nothing", () => {
    const el = show();
    fireEvent.click(tab(el, "away"));
    expect(replaceState).not.toHaveBeenCalled();
    expect(hidden(el)).toEqual({ away: false, home: true });
  });

  it("ten quick presses end on the last one", () => {
    const el = show();
    for (let i = 0; i < 10; i++) fireEvent.click(tab(el, i % 2 === 0 ? "home" : "away"));
    expect(hidden(el)).toEqual({ away: false, home: true });
    expect(window.location.search).toBe("");
  });
});

describe("MatchupBallToggle: after the first paint the address is the source of truth", () => {
  it("mounted with initialBall=\"away\" while the address says ?ball=home (Back from a player page): the home slot shows", () => {
    setAddress("?ball=home");
    replaceState.mockClear();
    const el = show({ initialBall: "away" });
    expect(hidden(el)).toEqual({ away: true, home: false });
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("mounted with initialBall=\"home\" while the address has no ball: the away slot shows", () => {
    const el = show({ initialBall: "home" });
    expect(hidden(el)).toEqual({ away: false, home: true });
  });

  it("a popstate after the address changed swaps the slots and makes no replaceState call of its own", () => {
    const el = show();
    replaceState.mockClear();
    act(() => {
      setAddress("?ball=home");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(hidden(el)).toEqual({ away: true, home: false });
    act(() => {
      setAddress("?season=2025");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(hidden(el)).toEqual({ away: false, home: true });
    expect(replaceState).not.toHaveBeenCalled();
  });

  it("?ball=HOME is the away side (parseBall)", () => {
    setAddress("?ball=HOME");
    expect(hidden(show())).toEqual({ away: false, home: true });
  });

  it("stops listening when it unmounts", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(element());
    unmount();
    expect(remove.mock.calls.some(([type]) => type === "popstate")).toBe(true);
    remove.mockRestore();
  });
});
