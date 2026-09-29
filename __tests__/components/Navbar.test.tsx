// The nav (team stats spec §7): Team Stats sits right after Team Tiers,
// carries ?season= like the other data pages, and is styled active on its page.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), pathname: "/" }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => nav.params,
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock("@/components/search/SearchPalette", () => ({ default: () => null }));

import Navbar from "@/components/layout/Navbar";

function desktopLinks(pathname = "/", query = "") {
  nav.pathname = pathname;
  nav.params = new URLSearchParams(query);
  const { container } = render(<Navbar />);
  const row = container.querySelector("nav div.hidden.md\\:flex");
  if (!row) throw new Error("no desktop link row");
  return { row, links: Array.from(row.querySelectorAll("a")) };
}

beforeEach(() => {
  nav.pathname = "/";
  nav.params = new URLSearchParams();
});

describe("Navbar", () => {
  it("lists Team Tiers, Team Stats, Passing, … in that order", () => {
    const { links } = desktopLinks();
    expect(links.map((a) => a.textContent)).toEqual([
      "Team Tiers", "Team Stats", "Passing", "Receiving", "Rushing", "Run Gaps", "Trends", "Compare", "Glossary",
    ]);
  });

  it("Team Stats → /team-stats, carrying ?season= like the other data pages", () => {
    expect(desktopLinks().links[1].getAttribute("href")).toBe("/team-stats");
    const { links } = desktopLinks("/rushing", "season=2025");
    expect(links[1].getAttribute("href")).toBe("/team-stats?season=2025");
    expect(links[0].getAttribute("href")).toBe("/teams?season=2025");
    expect(links.find((a) => a.textContent === "Glossary")?.getAttribute("href")).toBe("/glossary");
  });

  it("Team Stats is active on /team-stats", () => {
    const { links } = desktopLinks("/team-stats");
    expect(links[1].className).toContain("text-navy font-semibold");
    expect(links[0].className).not.toContain("font-semibold");
  });

  it("the desktop row is gap-3, gap-6 from xl (measured 2026-09-28: no label wraps at 1024, one line at 1280)", () => {
    const { row } = desktopLinks();
    const cls = row.className.split(/\s+/);
    expect(cls).toContain("gap-3");
    expect(cls).toContain("xl:gap-6");
    expect(cls).not.toContain("gap-8");
    expect(cls).not.toContain("gap-6");
  });
});
