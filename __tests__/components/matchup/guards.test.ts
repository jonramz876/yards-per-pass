// Layout, accent, font and bundle guards over components/matchup/ (team
// matchup spec §8, §8.2-§8.4, §11). File-text tests: they read the source, so
// a class added later that would let the page grow wider than the window,
// float something over the content, switch the panel's sticky off, spend the
// accent on a second job or pull a stat module into the browser fails here.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ACCENT, classTokens, code, componentFiles, source } from "./helpers";

const ROOT = process.cwd();
const FILES = componentFiles();
const EXPECTED = [
  "MatchupBallToggle.tsx", "MatchupBallView.tsx", "MatchupHeader.tsx", "MatchupLadder.tsx", "MatchupNotes.tsx",
  "MatchupPicker.tsx", "MatchupPlayers.tsx", "MatchupRadarChart.tsx", "MatchupSidePanel.tsx", "MatchupSlate.tsx",
];
// MatchupShare.tsx is the Share block (matchup card spec 2026-10-11 §8.2): a file of the page's
// own folder, so the no-fixed, no-overflow and no-red rules below cover it too.
const PAGES = [
  "app/matchup/page.tsx", "app/matchup/[away]/[home]/page.tsx", "app/matchup/layout.tsx", "app/matchup/error.tsx",
  "app/matchup/[away]/[home]/MatchupShare.tsx",
];
const pageCode = (rel: string) =>
  readFileSync(join(ROOT, rel), "utf8")
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("components/matchup/: the ten components of the spec", () => {
  it("exactly these files", () => {
    expect(FILES).toEqual(EXPECTED);
  });
});

describe("nothing floats, and one thing sticks (§1, §8.3)", () => {
  it("`sticky` is a class in exactly one file, MatchupSidePanel.tsx, and only behind lg: and the min-height variant", () => {
    const users = FILES.filter((f) => classTokens(f).some((t) => /(^|:)sticky$/.test(t)));
    expect(users).toEqual(["MatchupSidePanel.tsx"]);
    const tokens = classTokens("MatchupSidePanel.tsx").filter((t) => /(^|:)sticky$/.test(t));
    expect(tokens.length).toBeGreaterThan(0);
    for (const t of tokens) expect(t).toMatch(/^lg:\[@media\(min-height:\d+px\)\]:sticky$/);
    for (const f of FILES) expect(code(f), f).not.toMatch(/position:\s*["']?sticky/);
  });

  it("no class is `fixed`, and no style sets position: fixed", () => {
    for (const f of FILES) {
      expect(classTokens(f).filter((t) => /(^|:)fixed$/.test(t)), f).toEqual([]);
      expect(code(f), f).not.toMatch(/position:\s*["']?fixed/);
    }
    for (const p of PAGES) expect(pageCode(p), p).not.toMatch(/(^|[\s"'`:])fixed([\s"'`]|$)|position:\s*["']?(fixed|sticky)/m);
  });

  it("nothing that would switch sticky off: no overflow class on the toggle, the ball view, the layout or the pages", () => {
    for (const f of ["MatchupBallToggle.tsx", "MatchupBallView.tsx"]) {
      expect(classTokens(f).filter((t) => /overflow-/.test(t)), f).toEqual([]);
    }
    for (const p of PAGES) expect(pageCode(p), p).not.toMatch(/overflow-(hidden|auto|scroll|x-|y-|clip)/);
  });

  it("no z-index anywhere in the matchup components", () => {
    for (const f of FILES) expect(classTokens(f).filter((t) => /(^|:)z-/.test(t)), f).toEqual([]);
  });
});

describe("the page is never wider than the window (§8.2)", () => {
  // Hand-written grid templates only. Tailwind's counted classes (grid-cols-2,
  // md:grid-cols-4, xl:grid-cols-7) compile to repeat(N, minmax(0, 1fr)) and
  // pass as they are.
  const templates = (f: string) => classTokens(f).filter((t) => /grid-cols-\[/.test(t));
  // The two `auto` exceptions the spec names, each behind md:.
  const AUTO_OK: Record<string, string> = {
    "MatchupHeader.tsx": "md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]",
    "MatchupLadder.tsx": "md:grid-cols-[auto_minmax(0,1fr)_auto]",
  };

  it("every flexible track of a hand-written grid template is minmax(0, …); fixed tracks are 104 px or less", () => {
    let seen = 0;
    for (const f of FILES) {
      for (const t of templates(f)) {
        seen += 1;
        const tracks = /grid-cols-\[(.+)\]$/.exec(t)![1].split("_");
        for (const track of tracks) {
          if (track === "auto") {
            expect(AUTO_OK[f], `${f}: ${t}`).toBe(t);
            continue;
          }
          const px = /^(\d+)px$/.exec(track);
          if (px) expect(Number(px[1]), `${f}: ${t}`).toBeLessThanOrEqual(104);
          else expect(track, `${f}: ${t}`).toMatch(/^minmax\(0,[\d.]+fr\)$/);
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(5);
  });

  it("no style sets grid-template-columns, and no file uses repeat(auto-fill / auto-fit", () => {
    for (const f of FILES) {
      expect(code(f), f).not.toMatch(/gridTemplateColumns|grid-template-columns/);
      expect(code(f), f).not.toMatch(/auto-fill|auto-fit/);
    }
  });

  it("no fixed width above 104 px (a max-width is a cap, not a width)", () => {
    for (const f of FILES) {
      for (const t of classTokens(f)) {
        const m = /(^|:)(?:w|min-w)-\[(\d+)px\]$/.exec(t);
        if (m) expect(Number(m[2]), `${f}: ${t}`).toBeLessThanOrEqual(104);
        expect(t, f).not.toMatch(/(^|:)(w|min-w)-(screen|max|\[\d+(vw|rem|em)\])$/);
      }
      expect(code(f), f).not.toMatch(/\b(width|minWidth):\s*\d{3,}/);
    }
  });

  it("whitespace-nowrap only on the kickoff line and the ladder's unit headings, each behind md:", () => {
    const users: Record<string, string[]> = {};
    for (const f of FILES) {
      const hits = classTokens(f).filter((t) => t.endsWith("whitespace-nowrap"));
      if (hits.length) users[f] = Array.from(new Set(hits));
    }
    expect(users).toEqual({ "MatchupHeader.tsx": ["md:whitespace-nowrap"], "MatchupLadder.tsx": ["md:whitespace-nowrap"] });
  });

  it("the page container is the spec's: max-w-7xl, min-w-0, 12 px / 24 px side padding", () => {
    for (const p of ["app/matchup/page.tsx", "app/matchup/[away]/[home]/page.tsx"]) {
      expect(pageCode(p), p).toContain("mx-auto w-full max-w-7xl min-w-0 px-3 py-6 md:px-6");
    }
  });
});

describe("the accent has one job (§8.4): a ladder rank gap of 5 or more", () => {
  // Page colours amendment 2026-10-12: the radar's gap bars and their legend swatch are gone.
  it("#D50A0A and the site's red class appear only in the ladder (its tug marker and bar): nothing on the radar or its legend", () => {
    const users = FILES.filter((f) => new RegExp(`${ACCENT}|nflred|(^|[\\s"'\`:-])red-\\d00`, "i").test(code(f)));
    expect(users).toEqual(["MatchupLadder.tsx"]);
    for (const p of PAGES) expect(pageCode(p), p).not.toMatch(/#D50A0A|nflred|red-\d00/i);
  });
});

// Page colours amendment 2026-10-12: the pair page wears the share card's
// colours. They are worked out in ONE place, the server page, and handed down
// as strings, so the header, the radar, its legend and the tiles cannot
// disagree, and the colour rule cannot reach a component (or a browser).
describe("the pair's colours are set once, on the server page", () => {
  const PAGE = "app/matchup/[away]/[home]/page.tsx";
  const PAINTED = ["MatchupHeader.tsx", "MatchupPlayers.tsx", "MatchupSidePanel.tsx", "MatchupRadarChart.tsx"];
  /** Import statements that are not `import type …;` (the only form the bundle walk strips). */
  const valueImports = (text: string): string[] =>
    Array.from(text.replace(/import\s+type\s[^;]*;/g, "").matchAll(/import\s[^;]*?from\s+["']([^"']+)["']/g)).map((m) => m[1]);

  it("the page calls matchupCardColours( exactly once, and never takes the colours from the card model", () => {
    const text = pageCode(PAGE);
    expect(text.split("matchupCardColours(").length - 1).toBe(1);
    expect(text).toMatch(/const colours = matchupCardColours\(away, home\);/);
    expect(text).not.toMatch(/\)\.colours\b/);
    // before the header is built, so the uncovered and small-pool pages have them too
    expect(text.indexOf("matchupCardColours(")).toBeLessThan(text.indexOf("<MatchupHeader"));
    // and after the page's own order redirect (the last `load.swap` in the file)
    expect(text.lastIndexOf("load.swap")).toBeLessThan(text.indexOf("matchupCardColours("));
  });

  it("no matchup component has a non-type import of matchup-colours or matchup-card", () => {
    for (const f of FILES) {
      for (const spec of valueImports(source(f))) expect(spec, f).not.toMatch(/matchup-colours|matchup-card/);
      // and a type import, where there is one, is the statement form the bundle walk understands
      expect(source(f), f).not.toMatch(/import\s*\{[^}]*\btype\s+\w+[^}]*\}\s*from\s*["'][^"']*matchup-(colours|card)["']/);
    }
  });

  it("no component calls the colour rule or the ring rule", () => {
    for (const f of FILES) expect(code(f), f).not.toMatch(/matchupCardColours\s*\(|matchupRingColour\s*\(|matchupRingWord\s*\(|buildMatchupCard\s*\(/);
  });

  it("the panel and the chart look no team up and hold no outline rule (the slate on the index keeps its own)", () => {
    for (const f of ["MatchupSidePanel.tsx", "MatchupRadarChart.tsx"]) {
      expect(valueImports(source(f)).filter((s) => /lib\/data\/teams/.test(s)), f).toEqual([]);
      expect(code(f), f).not.toMatch(/radarStrokeColor|getTeam\s*\(/);
    }
    expect(code("MatchupSlate.tsx")).toMatch(/getTeam/);
  });

  it("the four painted components hold none of the old colours: no team primary / secondary, no slate defense, no amber ring", () => {
    for (const f of PAINTED) expect(code(f), f).not.toMatch(/primaryColor|secondaryColor|#334155|#f59e0b|amber-500/i);
  });
});

describe("type (§8.4): three faces with fixed jobs", () => {
  it("Barlow Condensed is reached through the one class constant, at weights 600 and 700 only", () => {
    const users = FILES.filter((f) => code(f).includes("--font-barlow"));
    expect(users.length).toBeGreaterThanOrEqual(6);
    for (const f of users) {
      expect(code(f), f).toContain('const BARLOW = "font-[family-name:var(--font-barlow)]";');
      // every class string that uses the face names its weight, and only 600 or 700
      const strings = Array.from(code(f).matchAll(/`([^`]*\$\{BARLOW\}[^`]*)`/g)).map((m) => m[1]);
      expect(strings.length, f).toBeGreaterThan(0);
      for (const s of strings) {
        const weights = s.split(/\s+/).filter((t) => /^(md:|lg:|xl:)?font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black|\[\d+\])$/.test(t));
        expect(weights.length, `${f}: ${s}`).toBeGreaterThan(0);
        for (const w of weights) expect(w, `${f}: ${s}`).toMatch(/font-(semibold|bold)$/);
      }
    }
  });

  it("no component imports a font module", () => {
    for (const f of FILES) expect(code(f), f).not.toMatch(/from\s+["'][^"']*fonts["']|next\/font/);
  });

  it("the pixel font is for AT / VS and the tile bands only", () => {
    const users = FILES.filter((f) => code(f).includes("--font-pixel"));
    expect(users).toEqual(["MatchupHeader.tsx", "MatchupPlayers.tsx"]);
  });
});

describe("the browser bundle (§8 bundle rule)", () => {
  const isClient = (text: string) => /^\s*["']use client["'];?\s*$/m.test(text);
  const specifiers = (text: string): string[] =>
    Array.from(text.matchAll(/(?:import|export)\s+(?:type\s+)?(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g)).map((m) => m[1]);
  const resolveFile = (from: string, spec: string): string | null => {
    const base = spec.startsWith("@/") ? join(ROOT, spec.slice(2)) : spec.startsWith(".") ? resolve(dirname(from), spec) : null;
    if (!base) return null;
    const candidates = /\.tsx?$/.test(base) ? [base] : [`${base}.ts`, `${base}.tsx`, join(base, "index.ts"), join(base, "index.tsx")];
    return candidates.find((c) => existsSync(c)) ?? null;
  };
  /** Every project file reachable from `entry` through non-type imports. */
  const reach = (entry: string): string[] => {
    const seen = new Set<string>();
    const walk = (file: string) => {
      if (seen.has(file)) return;
      seen.add(file);
      const text = readFileSync(file, "utf8").replace(/import\s+type\s[^;]*;/g, "");
      for (const spec of specifiers(text)) {
        const next = resolveFile(file, spec);
        if (next) walk(next);
      }
    };
    walk(entry);
    return Array.from(seen).map((f) => f.slice(ROOT.length + 1).split("\\").join("/"));
  };
  const FORBIDDEN = ["lib/stats/matchup.ts", "lib/stats/team-stats.ts", "lib/stats/team-radar.ts"];

  it("exactly two matchup components are client components: the toggle and the picker", () => {
    expect(FILES.filter((f) => isClient(source(f)))).toEqual(["MatchupBallToggle.tsx", "MatchupPicker.tsx"]);
  });

  it.each([
    "components/matchup/MatchupBallToggle.tsx", "components/matchup/MatchupPicker.tsx", "components/team/ScheduleSection.tsx",
    "app/matchup/[away]/[home]/MatchupShare.tsx",
  ])(
    "%s never reaches matchup.ts, team-stats.ts or team-radar.ts",
    (entry) => {
      const reached = reach(join(ROOT, entry));
      expect(reached.length).toBeGreaterThan(1);
      for (const bad of FORBIDDEN) expect(reached).not.toContain(bad);
      expect(reached).toContain("lib/stats/matchup-links.ts");
    },
  );

  it("the toggle imports React and matchup-links only: no matchup component, no other stat module", () => {
    const specs = specifiers(source("MatchupBallToggle.tsx"));
    expect(specs.sort()).toEqual(["@/lib/stats/matchup-links", "react"]);
  });

  it("the picker imports nothing from lib/stats but matchup-links, and no team list (it comes in as a prop)", () => {
    const specs = specifiers(source("MatchupPicker.tsx"));
    expect(specs.filter((s) => s.includes("lib/stats/"))).toEqual(["@/lib/stats/matchup-links"]);
    expect(specs.filter((s) => s.includes("lib/data/"))).toEqual([]);
    expect(specs.filter((s) => s.includes("components/matchup") || s.startsWith("./"))).toEqual([]);
  });

  it("no matchup folder file sits beside the components that is not one of them (no stray client file)", () => {
    expect(readdirSync(join(ROOT, "components", "matchup")).sort()).toEqual(EXPECTED);
  });

  /** Every .ts / .tsx file under a folder, as paths relative to the repo root with forward slashes. */
  const filesUnder = (rel: string): string[] => {
    const out: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) out.push(full.slice(ROOT.length + 1).split("\\").join("/"));
      }
    };
    walk(join(ROOT, rel));
    return out.sort();
  };
  const clientFilesUnder = (rel: string): string[] => filesUnder(rel).filter((f) => isClient(readFileSync(join(ROOT, f), "utf8")));

  // Matchup card spec 2026-10-11 §10: the third client file on the matchup routes.
  it("the client files under app/matchup/ are exactly error.tsx (an error boundary has to be one) and MatchupShare.tsx", () => {
    expect(clientFilesUnder("app/matchup")).toEqual(["app/matchup/[away]/[home]/MatchupShare.tsx", "app/matchup/error.tsx"]);
  });

  it("MatchupShare imports React, next/link and matchup-links only: its three URLs come in ready-made from the server page", () => {
    const text = readFileSync(join(ROOT, "app/matchup/[away]/[home]/MatchupShare.tsx"), "utf8");
    expect(specifiers(text).sort()).toEqual(["@/lib/stats/matchup-links", "next/link", "react"]);
  });

  // The bundle walk (matchup card spec §3, §10): the card's two pure modules are server-side.
  // matchup-card.ts brings matchup.ts, team-radar.ts and the colour rule with it.
  it("no \"use client\" file anywhere in app/ or components/ reaches matchup-card.ts or matchup-colours.ts", () => {
    const clients = [...clientFilesUnder("app"), ...clientFilesUnder("components")];
    expect(clients.length).toBeGreaterThan(20);
    expect(clients).toContain("app/matchup/[away]/[home]/MatchupShare.tsx");
    expect(clients).toContain("app/card/team/[team_id]/[side]/TeamRadarActions.tsx");
    for (const file of clients) {
      const reached = reach(join(ROOT, file));
      expect(reached, file).not.toContain("lib/stats/matchup-card.ts");
      expect(reached, file).not.toContain("lib/stats/matchup-colours.ts");
    }
  });

  it("the walk is real: the two server files that draw the card do reach both modules", () => {
    for (const entry of ["app/card/matchup/[away]/[home]/page.tsx", "app/api/matchup-card/[away]/[home]/route.tsx", "app/matchup/[away]/[home]/page.tsx"]) {
      const reached = reach(join(ROOT, entry));
      expect(reached, entry).toContain("lib/stats/matchup-card.ts");
      expect(reached, entry).toContain("lib/stats/matchup-colours.ts");
    }
  });
});
