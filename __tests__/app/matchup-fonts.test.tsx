// Barlow Condensed is a matchup-only font (team matchup spec 2026-10-10 §8.4):
// declared in app/matchup/fonts.ts, put on a wrapper by app/matchup/layout.tsx,
// and reached by components through the --font-barlow variable. It must never
// reach the root layout, where every page of the site would load it.
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const font = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock("next/font/google", () => ({
  Barlow_Condensed: (options: unknown) => {
    font.calls.push(options);
    return { variable: "__variable_barlow_test", className: "__className_barlow_test", style: {} };
  },
}));

import { barlowCondensed } from "@/app/matchup/fonts";
import MatchupLayout from "@/app/matchup/layout";

const ROOT = process.cwd();
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");
function sources(dir: string): string[] {
  const abs = join(ROOT, dir);
  if (!existsSync(abs)) return [];
  const out: string[] = [];
  for (const name of readdirSync(abs)) {
    const full = join(abs, name);
    if (statSync(full).isDirectory()) out.push(...sources(join(dir, name)));
    else if (/\.(tsx?|css|mjs)$/.test(name)) out.push(relative(ROOT, full).split(sep).join("/"));
  }
  return out;
}
const SITE_FILES = [...sources("app"), ...sources("components"), ...sources("lib"), "tailwind.config.ts"];

describe("app/matchup/fonts.ts", () => {
  it("calls Barlow_Condensed once: weights 600 and 700, latin, the --font-barlow variable, swap", () => {
    expect(font.calls).toEqual([{ subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow", display: "swap" }]);
    expect(barlowCondensed.variable).toBe("__variable_barlow_test");
  });
});

describe("app/matchup/layout.tsx", () => {
  it("puts the font's variable class on its wrapper and renders its children, nothing else", () => {
    const { container } = render(<MatchupLayout><p id="child">page</p></MatchupLayout>);
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.tagName).toBe("DIV");
    expect(wrapper.className).toBe("__variable_barlow_test");
    expect(wrapper.children).toHaveLength(1);
    expect(wrapper.querySelector("#child")?.textContent).toBe("page");
  });

  it("is a server component (no \"use client\"), so it adds no client boundary", () => {
    expect(read("app/matchup/layout.tsx")).not.toMatch(/["']use client["']/);
  });
});

describe("the font stays on the matchup routes", () => {
  it("the root layout, app/fonts.ts, globals.css and the Tailwind config do not name it", () => {
    for (const file of ["app/layout.tsx", "app/fonts.ts", "app/globals.css", "tailwind.config.ts"]) {
      expect(read(file), file).not.toMatch(/barlow/i);
    }
  });

  it("app/matchup/fonts.ts is imported by app/matchup/layout.tsx and by no other file", () => {
    const importers = SITE_FILES.filter((f) => f !== "app/matchup/fonts.ts" && /from\s+["'][^"']*(matchup\/fonts|\.\/fonts)["']/.test(read(f)))
      .filter((f) => f.startsWith("app/matchup/") || /matchup\/fonts/.test(read(f)));
    expect(importers).toEqual(["app/matchup/layout.tsx"]);
  });

  it("--font-barlow appears in no file outside app/matchup/ and components/matchup/", () => {
    const users = SITE_FILES.filter((f) => read(f).includes("--font-barlow"));
    expect(users.length).toBeGreaterThan(0);
    for (const f of users) expect(f).toMatch(/^(app|components)\/matchup\//);
  });

  it("next/font/google's Barlow_Condensed is named only in app/matchup/fonts.ts", () => {
    expect(SITE_FILES.filter((f) => read(f).includes("Barlow_Condensed"))).toEqual(["app/matchup/fonts.ts"]);
  });
});
