// lib/stats/matchup-colours.ts — the matchup share card's colour rule (matchup
// card spec 2026-10-11 §5, as amended by the colour families spec
// 2026-10-11-matchup-colour-families.md).
//
// The card shows both teams at once, each in ONE colour of its own across the
// whole picture, and the two must never read alike ("both teams shouldn't be
// in blue etc"): never close, never both very dark, never two of one colour
// family. This module picks those two colours from the teams' primary and
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
/** A colour with less chroma (CIELAB) than this has no hue: it is black, grey or white by lightness. */
export const COLOUR_NEUTRAL_MAX_CHROMA = 8.8;
/** A neutral darker than this lightness is black. */
export const COLOUR_BLACK_MAX_L = 35;
/** A neutral at or above this lightness is white. */
export const COLOUR_WHITE_MIN_L = 90;
/** A warm colour (orange or gold by hue) darker than this lightness is brown. */
export const COLOUR_BROWN_MAX_L = 30;
/**
 * Where each family begins on the colour wheel, in degrees (half-open: a hue
 * exactly on a cut belongs to the family the cut is named for). Red wraps: it
 * runs from `red` round through 0 to `orange`.
 */
export const COLOUR_HUE_CUTS = { orange: 7, gold: 33.5, green: 70, teal: 172, blue: 195, purple: 257, red: 306 } as const;
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

/* ─── Colour families (colour families spec §2) ─── */

/**
 * The colour-wheel hue (the HSV / HSL hue) of a #RRGGBB colour, 0 up to 360,
 * from the integer channels; 0 for a pure grey. The wheel, not the CIELAB hue
 * angle: in CIELAB a pure red and Cleveland's orange are 4 degrees apart, on
 * the wheel 14. Call it with a usable colour only.
 */
export function wheelHue(hex: string): number {
  const [r, g, b] = channels(hex);
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return 0;
  // JavaScript's % keeps the sign: a red with more blue than green must come out just under 360
  if (max === r) return (((60 * (g - b)) / d) % 360 + 360) % 360;
  if (max === g) return (60 * (b - r)) / d + 120;
  return (60 * (r - g)) / d + 240;
}

export type ColourFamily =
  | "black" | "white" | "grey" | "brown" | "red" | "orange" | "gold" | "green" | "teal" | "blue" | "purple";

/**
 * The colour family of a #RRGGBB colour, tested in this order: a colour with
 * no hue is black, white or grey by lightness; a dark warm colour is brown;
 * the rest go by the wheel hue. Navy is blue, burgundy is red, gold and yellow
 * are one family. Call it with a usable colour only.
 */
export function colourFamily(hex: string): ColourFamily {
  const { L, a, b } = labOf(hex);
  if (Math.hypot(a, b) < COLOUR_NEUTRAL_MAX_CHROMA) {
    if (L < COLOUR_BLACK_MAX_L) return "black";
    return L >= COLOUR_WHITE_MIN_L ? "white" : "grey";
  }
  const hue = wheelHue(hex);
  if (hue >= COLOUR_HUE_CUTS.orange && hue < COLOUR_HUE_CUTS.green && L < COLOUR_BROWN_MAX_L) return "brown";
  if (hue < COLOUR_HUE_CUTS.orange || hue >= COLOUR_HUE_CUTS.red) return "red";
  if (hue < COLOUR_HUE_CUTS.gold) return "orange";
  if (hue < COLOUR_HUE_CUTS.green) return "gold";
  if (hue < COLOUR_HUE_CUTS.teal) return "green";
  if (hue < COLOUR_HUE_CUTS.blue) return "teal";
  if (hue < COLOUR_HUE_CUTS.purple) return "blue";
  return "purple";
}

/* ─── "Alike" (§5.2, colour families spec §3) ─── */

/** The two tests that need no family: under COLOUR_ALIKE_DISTANCE apart, or both very dark. */
function alikeWithoutFamily(a: string, b: string): boolean {
  const p = labOf(a);
  const q = labOf(b);
  if (Math.hypot(p.L - q.L, p.a - q.a, p.b - q.b) < COLOUR_ALIKE_DISTANCE) return true;
  return p.L < COLOUR_DARK_MAX_L && q.L < COLOUR_DARK_MAX_L;
}

/**
 * Whether two colours would read as the same on the card. True when any one
 * holds, tested in this order: they are under COLOUR_ALIKE_DISTANCE apart;
 * both are very dark; they are the same colour family; one is a red and the
 * other an orange.
 *
 * This is the rule for TEAM colours. The chain's own neutrals (slate #64748B,
 * ink #0F172A) both measure as blue here, so this function calls them alike
 * any blue. That is deliberate and NOT what the chain does: the chain compares
 * a neutral by distance and darkness only (`alikeInChain`), because a neutral
 * is nobody's colour. Do not "fix" either side to match the other.
 */
export function coloursAlike(a: string, b: string): boolean {
  if (alikeWithoutFamily(a, b)) return true;
  const fa = colourFamily(a);
  const fb = colourFamily(b);
  return fa === fb || (fa === "red" && fb === "orange") || (fa === "orange" && fb === "red");
}

/** The chain's own neutrals: they are not team colours and have no family. */
const isNeutral = (c: string) => c === MATCHUP_CARD_INK || c === MATCHUP_CARD_SLATE;

/**
 * "Alike" as the chain asks it: `coloursAlike`, except that when either colour
 * is one of the chain's neutrals (ink as the away first choice, slate or ink
 * as the home fallback) the family tests are left out. Only unusable input
 * reaches a neutral, and this keeps every such answer what it was before the
 * families.
 */
function alikeInChain(a: string, b: string): boolean {
  return isNeutral(a) || isNeutral(b) ? alikeWithoutFamily(a, b) : coloursAlike(a, b);
}

/* ─── The ring (§5.4, colour families spec §4) ─── */

/**
 * The middle-of-the-league ring's colour beside the two CARD colours (not the
 * teams' primaries): amber, unless one of them is close to amber, then slate
 * grey. Amber is a gold. "Close to amber" is alike amber (a gold, or anything
 * within COLOUR_ALIKE_DISTANCE of it) or an orange. Cleveland's brown is its
 * own family and far from amber, so it keeps the amber ring.
 */
export function matchupRingColour(awayCardColour: string, homeCardColour: string): string {
  const nearAmber = (c: string) => coloursAlike(MATCHUP_RING_AMBER, c) || colourFamily(c) === "orange";
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
 * "Alike" is `coloursAlike` throughout, except where one of the two colours is
 * a neutral (ink in step 1, slate or ink in step 4): a neutral has no colour
 * family and is compared by distance and darkness only (`alikeInChain`).
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
  const homeFor = (awayColour: string) => homeOwn.find((c) => !alikeInChain(awayColour, c.colour)) ?? null;

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
  if (homePick === null) homePick = neutrals.find((c) => !alikeInChain(first.colour, c.colour)) ?? null;
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
