// lib/stats/matchup-colours.ts — the matchup share card's colour rule (matchup
// card spec 2026-10-11 §5).
//
// The card shows both teams at once, each in ONE colour of its own across the
// whole picture, and the two must never read alike ("both teams shouldn't be
// in blue"). This module picks those two colours from the teams' primary and
// secondary colours, deterministically.
//
// Pure: it imports only the site's contrast rule. No lib/data, no React, no
// Next (a test checks). Server-side only: no client component may reach it.
//
// The rules are the Python reference's
// (docs/superpowers/specs/matchup-card-reference/colour_ref.py); the golden
// test holds the two together over all 992 ordered pairs. All hex output is
// upper-case #RRGGBB.
import { RADAR_MIN_STROKE_CONTRAST, contrastOnWhite } from "@/lib/stats/formatters";

/* ─── Constants (§5.2, §5.3, §5.4) ─── */

/** Two colours closer than this (CIE76) are alike. */
export const COLOUR_ALIKE_DISTANCE = 40;
/** Two colours both darker than this lightness are alike: navy, black, dark green and brown all read as "dark". */
export const COLOUR_DARK_MAX_L = 25;
/** A colour with less chroma than this has no hue to compare. */
export const COLOUR_FAMILY_MIN_CHROMA = 20;
/** Two colours with hue, under this many degrees apart, are the same family. */
export const COLOUR_FAMILY_MAX_HUE = 30;
/** The middle ring is at least this far from both card colours (its own, lower floor: §5.4). */
export const MATCHUP_RING_MIN_DISTANCE = 30;

/** The neutrals of steps 1, 4 and 5. */
export const MATCHUP_CARD_INK = "#0F172A";
export const MATCHUP_CARD_SLATE = "#64748B";
/** The middle-of-the-league ring: the page's amber, or slate grey beside a card colour close to amber. */
export const MATCHUP_RING_AMBER = "#F59E0B";
export const MATCHUP_RING_GREY = "#94A3B8";

const DARKEN_STEPS = 20;

/* ─── Building blocks (§5.1) ─── */

const HEX6 = /^#[0-9a-fA-F]{6}$/;

/** A usable colour, upper-cased; null for anything that is not a #RRGGBB string. */
function usable(value: unknown): string | null {
  return typeof value === "string" && HEX6.test(value) ? value.toUpperCase() : null;
}

function channels(hex: string): [number, number, number] {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

/** One 0-255 sRGB channel as linear light (the site's own, lib/stats/formatters.ts contrastOnWhite). */
function linear(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export interface Lab { L: number; a: number; b: number }

/** CIELAB (D65) of a #RRGGBB colour. Call it with a usable colour only: the chain drops the others first. */
export function labOf(hex: string): Lab {
  const [r, g, b] = channels(hex).map(linear);
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return { L: 116 * f(y) - 16, a: 500 * (f(x) - f(y)), b: 200 * (f(y) - f(z)) };
}

/** CIE76: the straight-line distance between two colours in Lab. */
export function colourDistance(a: string, b: string): number {
  const p = labOf(a);
  const q = labOf(b);
  return Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b);
}

/** Readable on white: the site's 3:1 line for a chart's outline. */
export function readableOnWhite(hex: string): boolean {
  return contrastOnWhite(hex) >= RADAR_MIN_STROKE_CONTRAST;
}

/**
 * The colour itself when it is readable on white; otherwise the first readable
 * step of darkening it by whole twentieths (each channel × (20 − n) / 20,
 * half rounds up; integer arithmetic, as the reference). null for a value
 * that is not a #RRGGBB string, never "#NaNNaNNaN".
 */
export function darkenToReadable(value: string): string | null {
  const hex = usable(value);
  if (hex === null) return null;
  if (readableOnWhite(hex)) return hex;
  const rgb = channels(hex);
  let out = hex;
  for (let n = 1; n < DARKEN_STEPS; n += 1) {
    // round half up of v × (20 − n) / 20, in integers
    out = `#${rgb
      .map((v) => Math.floor((v * (DARKEN_STEPS - n) * 2 + DARKEN_STEPS) / (DARKEN_STEPS * 2)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("")}`.toUpperCase();
    if (readableOnWhite(out)) return out;
  }
  // n = 19 is a twentieth of the colour: near black, always readable. Not reached.
  return out;
}

/* ─── "Alike" (§5.2) ─── */

/**
 * Whether two colours would read as the same on the card. True when any one
 * holds, tested in this order: they are under COLOUR_ALIKE_DISTANCE apart;
 * both are very dark; both have a hue and the two hues are under
 * COLOUR_FAMILY_MAX_HUE degrees apart (the short way round).
 */
export function coloursAlike(a: string, b: string): boolean {
  const p = labOf(a);
  const q = labOf(b);
  if (Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b) < COLOUR_ALIKE_DISTANCE) return true;
  if (p.L < COLOUR_DARK_MAX_L && q.L < COLOUR_DARK_MAX_L) return true;
  if (Math.hypot(p.a, p.b) < COLOUR_FAMILY_MIN_CHROMA || Math.hypot(q.a, q.b) < COLOUR_FAMILY_MIN_CHROMA) return false;
  const degrees = (lab: Lab) => (Math.atan2(lab.b, lab.a) * 180) / Math.PI;
  const apart = Math.abs(degrees(p) - degrees(q)) % 360;
  return Math.min(apart, 360 - apart) < COLOUR_FAMILY_MAX_HUE;
}

/* ─── The ring (§5.4) ─── */

/**
 * The middle-of-the-league ring's colour beside the two CARD colours (not the
 * teams' primaries): amber, unless one of them is close to amber, then slate
 * grey. "Close to amber" is alike amber and not very dark: Cleveland's brown
 * is in amber's hue family but nobody mistakes one for the other.
 */
export function matchupRingColour(awayCardColour: string, homeCardColour: string): string {
  const nearAmber = (c: string) => labOf(c).L >= COLOUR_DARK_MAX_L && coloursAlike(MATCHUP_RING_AMBER, c);
  return nearAmber(awayCardColour) || nearAmber(homeCardColour) ? MATCHUP_RING_GREY : MATCHUP_RING_AMBER;
}

/* ─── The chain (§5.3) ─── */

/** Where a card colour came from. "grey" and "ink" are the neutrals; no real pair uses them. */
export type MatchupColourSource = "primary" | "primary-darkened" | "secondary" | "secondary-darkened" | "grey" | "ink";

export interface MatchupCardColours {
  /** the away team's colour everywhere on the card */
  away: string;
  home: string;
  awayFrom: MatchupColourSource;
  homeFrom: MatchupColourSource;
  /** the home team had nothing that clears the away team's first choice, so the away team switched */
  awaySwitched: boolean;
  /** the 5 px rule under each half of the band: the team's colour NOT in use (it may be alike the other team's colour: a stripe, not an encoding) */
  awayRule: string;
  homeRule: string;
  /** matchupRingColour(away, home) */
  ring: string;
  /** step 5 only (unusable input): the farthest candidate, which may still be alike the away colour */
  closest: boolean;
}

/** The two colours of a team the rule reads (lib/types Team has both). */
export interface MatchupTeamColours { primaryColor: string; secondaryColor: string }

type Candidate = { from: MatchupColourSource; colour: string };

/** A team's own candidates in step 2's order, usable and readable ones only. */
function ownCandidates(primary: string | null, secondary: string | null): Candidate[] {
  const list: { from: MatchupColourSource; colour: string | null }[] = [
    { from: "primary", colour: primary },
    { from: "secondary", colour: secondary },
    { from: "secondary-darkened", colour: secondary === null ? null : darkenToReadable(secondary) },
    { from: "primary-darkened", colour: primary === null ? null : darkenToReadable(primary) },
  ];
  return list.filter((c): c is Candidate => c.colour !== null && readableOnWhite(c.colour));
}

/**
 * The two card colours for an away team and a home team (§5.3):
 *
 * 1. Away, first choice: its primary if readable; else its primary darkened;
 *    else its secondary if readable (never darkened here); else ink.
 * 2. Home: the first of primary, secondary, secondary darkened, primary
 *    darkened that is readable and not alike the away colour.
 * 3. Else the away team gives way: its secondary, then its secondary darkened
 *    (skipping an unreadable one or its first choice), each through step 2.
 * 4. Else home is slate, then ink, the first not alike the away first choice.
 * 5. Else the farthest readable candidate (`closest: true`); it may be alike.
 *
 * Steps 4 and 5 are reached only with unusable colours: none of the 992 real
 * pairs gets past step 3. An unusable colour (anything but a #RRGGBB string)
 * is skipped as a candidate. Never throws; the same answer on every call.
 */
export function matchupCardColours(away: MatchupTeamColours, home: MatchupTeamColours): MatchupCardColours {
  const ap = usable(away?.primaryColor);
  const as = usable(away?.secondaryColor);
  const hp = usable(home?.primaryColor);
  const hs = usable(home?.secondaryColor);

  // Step 1
  let first: Candidate;
  const apDark = ap === null ? null : darkenToReadable(ap);
  if (ap !== null && readableOnWhite(ap)) first = { from: "primary", colour: ap };
  else if (apDark !== null && readableOnWhite(apDark)) first = { from: "primary-darkened", colour: apDark };
  else if (as !== null && readableOnWhite(as)) first = { from: "secondary", colour: as };
  else first = { from: "ink", colour: MATCHUP_CARD_INK };

  const homeOwn = ownCandidates(hp, hs);
  const homeFor = (awayColour: string) => homeOwn.find((c) => !coloursAlike(awayColour, c.colour)) ?? null;

  let awayPick = first;
  let awaySwitched = false;
  let closest = false;
  // Step 2
  let homePick: Candidate | null = homeFor(first.colour);
  // Step 3
  if (homePick === null) {
    const alternatives: { from: MatchupColourSource; colour: string | null }[] = [
      { from: "secondary", colour: as },
      { from: "secondary-darkened", colour: as === null ? null : darkenToReadable(as) },
    ];
    for (const alt of alternatives) {
      if (alt.colour === null || !readableOnWhite(alt.colour) || alt.colour === first.colour) continue;
      const hit = homeFor(alt.colour);
      if (hit !== null) {
        awayPick = { from: alt.from, colour: alt.colour };
        homePick = hit;
        awaySwitched = true;
        break;
      }
    }
  }
  // Step 4
  const neutrals: Candidate[] = [
    { from: "grey", colour: MATCHUP_CARD_SLATE },
    { from: "ink", colour: MATCHUP_CARD_INK },
  ];
  if (homePick === null) homePick = neutrals.find((c) => !coloursAlike(first.colour, c.colour)) ?? null;
  // Step 5
  if (homePick === null) {
    closest = true;
    let best: Candidate = neutrals[0];
    let bestDistance = -1;
    for (const c of [...homeOwn, ...neutrals]) {
      const d = colourDistance(first.colour, c.colour);
      if (d > bestDistance) {
        best = c;
        bestDistance = d;
      }
    }
    homePick = best;
  }

  // The rule under each half: the team's colour not in use; the card colour when that one is unusable.
  const rule = (pick: Candidate, primary: string | null, secondary: string | null) =>
    (pick.from === "primary" || pick.from === "primary-darkened" ? secondary : primary) ?? pick.colour;

  return {
    away: awayPick.colour,
    home: homePick.colour,
    awayFrom: awayPick.from,
    homeFrom: homePick.from,
    awaySwitched,
    awayRule: rule(awayPick, ap, as),
    homeRule: rule(homePick, hp, hs),
    ring: matchupRingColour(awayPick.colour, homePick.colour),
    closest,
  };
}
