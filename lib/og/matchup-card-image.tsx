// lib/og/matchup-card-image.tsx — the 1200×630 picture of one game's matchup
// card (matchup card spec 2026-10-11 §6, §7; PR 2): the link preview and the
// Download button's PNG, both served by /api/matchup-card/[away]/[home].
//
// Both overlay radars side by side (the away team's ball, the home team's
// ball), each team in ONE colour of its own across the whole card, and on
// every spoke the stat and the league rank for both units. No gap bars, and no
// colour of this file's own but eight neutrals: every other colour on the
// picture is the model's (a card colour, a rule colour, the ring colour).
//
// Satori (the renderer behind next/og) is not a browser. The rules this file
// keeps, each held by a test in __tests__/og/matchup-card-image.test.tsx (the
// two live images' rules):
//   - inline styles only; every div is display:flex; no grid;
//   - inside <svg> only <path>, <line> and <circle>, with plain numbers: no
//     rect, no polygon, and no svg text (Satori does not draw it), so the
//     spoke labels are divs positioned over the svg;
//   - plain elements only: no components and no fragments;
//   - fonts come from files in the deployment, never from the network: the
//     team radar image's loader and its two family names. One weight.
//
// Everything printed comes from ONE model, buildMatchupCard
// (lib/stats/matchup-card.ts), which the share page prints from too. Heights
// are MATCHUP_CARD_LAYOUT's, stacked from the top, so nothing can slide below
// the keep-clear line (y = 510): under it are only the two footer lines, both
// right-aligned, so the bottom-left corner X covers with the title is empty.
import { PIXEL, SANS } from "@/lib/og/team-radar-image";
import {
  MATCHUP_CARD_HOW_TO,
  MATCHUP_CARD_LAYOUT as L,
  MATCHUP_CARD_RADAR as G,
  MATCHUP_CARD_SITE_NAME,
  matchupCardLegendWords,
  matchupCardSeasonLine,
  type MatchupCardBandHalf,
  type MatchupCardModel,
  type MatchupCardPane,
  type MatchupCardSpokeLabel,
  type MatchupCardVertex,
} from "@/lib/stats/matchup-card";
import { RADAR_AXES, RADAR_CARD_SITE_LINE, RADAR_HUB, RADAR_MID_SCORE, radarPathD, radarPoint, radarRadius } from "@/lib/stats/team-radar";

type CardModel = Extract<MatchupCardModel, { kind: "card" }>;
type PlateModel = Extract<MatchupCardModel, { kind: "plate" }>;
type BandModel = Pick<MatchupCardModel, "band">;

/* The eight neutrals. Team colours never appear in this file: they come in with the model. */
const WHITE = "#FFFFFF";
const INK = "#0F172A";
const SLATE = "#475569";
const GRAY = "#64748B";
const MUTED = "#94A3B8";
const LIGHT = "#E2E8F0";
const FAINT = "#EEF2F7";
const PANEL = "#F8FAFC";

/** The defense's line: dashed. The offense's is solid. */
const DASH = "8,5";
const RING_DASH = "5,3";
/**
 * The vertex markers: an offense dot (radius, stroke width) and a defense
 * square drawn as a closed path (half-side, stroke width). The four numbers
 * are MATCHUP_CARD_LAYOUT.marker's (added to the layout after PR 1's chaos
 * pass: a 1st-place square ends 1.02 px from its own label box, so none may
 * grow without re-deriving the boxes).
 */
const MARKER = L.marker;

const n1 = (v: number): number => Number(v.toFixed(1));
const ALIGN = { start: "flex-start", center: "center", end: "flex-end" } as const;

/** A square around (x, y), as a closed path: the image cannot use svg rect. */
function squareD(x: number, y: number, half: number): string {
  return radarPathD([[x - half, y - half], [x + half, y - half], [x + half, y + half], [x - half, y + half]]);
}

/** One half of the band: the team's card colour, its name in the pixel font, its record under it. */
function bandHalf(half: MatchupCardBandHalf, side: "away" | "home"): JSX.Element {
  const right = side === "home";
  // Press Start 2P is exactly one em wide per character. A name wider than its
  // box is cut at its END on both halves: the home half is right-aligned only
  // while the name fits, so its start is never lost.
  const fits = Array.from(half.name).length * half.nameSize <= L.nameBox.width;
  return (
    <div
      data-band-half={side}
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: right ? "flex-end" : "flex-start",
        width: L.half,
        height: L.band,
        padding: `0 ${L.padX}px`,
        backgroundColor: half.color,
        color: half.textColor,
      }}
    >
      <div
        data-band-name={side}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: right && fits ? "flex-end" : "flex-start",
          width: L.nameBox.width,
          height: L.nameBox.height,
          overflow: "hidden",
          whiteSpace: "nowrap",
          fontFamily: PIXEL,
          fontSize: half.nameSize,
        }}
      >
        {half.name}
      </div>
      <div data-band-meta={side} style={{ display: "flex", whiteSpace: "nowrap", fontSize: 16, opacity: 0.92, marginTop: 1 }}>
        {half.meta}
      </div>
    </div>
  );
}

/** The band with its seam box, and the 5 px rule under it: the card's and the plate's alike. */
function bandAndRule(model: BandModel): JSX.Element[] {
  const { away, home, seam } = model.band;
  return [
    <div key="band" data-block="band" style={{ display: "flex", position: "relative", height: L.band }}>
      {bandHalf(away, "away")}
      {bandHalf(home, "home")}
      <div
        data-seam
        style={{
          display: "flex",
          position: "absolute",
          left: L.seam.left,
          top: L.seam.top,
          width: L.seam.width,
          height: L.seam.height,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 4,
          border: `3px solid ${WHITE}`,
          backgroundColor: INK,
          color: WHITE,
          fontFamily: PIXEL,
          fontSize: 16,
        }}
      >
        {seam}
      </div>
    </div>,
    // Each half is the team's colour NOT in use: a stripe, not an encoding.
    <div key="rule" data-block="rule" style={{ display: "flex", height: L.rule }}>
      <div data-rule="away" style={{ display: "flex", width: L.half, height: L.rule, backgroundColor: away.ruleColor }} />
      <div data-rule="home" style={{ display: "flex", width: L.half, height: L.rule, backgroundColor: home.ruleColor }} />
    </div>,
  ];
}

/** The sub-band: a line on the left, the how-to sentence in the middle when there is room for it, the site name on the right. */
function subBand(line: string, howTo: boolean, lineMaxWidth: number): JSX.Element {
  return (
    <div
      data-block="sub-band"
      style={{
        display: "flex",
        height: L.subBand,
        alignItems: "center",
        justifyContent: "space-between",
        padding: `0 ${L.padX}px`,
        backgroundColor: PANEL,
        borderBottom: `1px solid ${LIGHT}`,
      }}
    >
      <div data-sub-line style={{ display: "flex", maxWidth: lineMaxWidth, overflow: "hidden", whiteSpace: "nowrap", fontSize: 15, color: SLATE }}>
        {line}
      </div>
      {howTo ? (
        <div data-how-to style={{ display: "flex", whiteSpace: "nowrap", fontSize: 15, color: SLATE }}>
          {MATCHUP_CARD_HOW_TO}
        </div>
      ) : null}
      <div data-sub-site style={{ display: "flex", fontFamily: PIXEL, fontSize: 10, color: GRAY }}>
        {MATCHUP_CARD_SITE_NAME}
      </div>
    </div>
  );
}

/** The line sample in a pane's legend row: solid with a round dot (offense), dashed with a white square (defense). */
function legendSample(color: string, unit: "off" | "def"): JSX.Element {
  return (
    <svg data-legend-sample={unit} width={46} height={14} viewBox="0 0 46 14">
      <line x1={0} y1={7} x2={46} y2={7} stroke={color} strokeWidth={4} strokeDasharray={unit === "def" ? DASH : undefined} />
      {unit === "def" ? (
        <path d={squareD(23, 7, 5)} fill={WHITE} stroke={color} strokeWidth={2.4} />
      ) : (
        <circle cx={23} cy={7} r={5.5} fill={color} />
      )}
    </svg>
  );
}

/** The mark before a label's stat line: a dot in the offense's colour, an outlined white square in the defense's. */
function labelMark(color: string, unit: "off" | "def"): JSX.Element {
  const size = L.label.mark;
  return (
    <svg data-mark={unit} width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {unit === "off" ? (
        <circle cx={size / 2} cy={size / 2} r={size / 2} fill={color} />
      ) : (
        // Inset by half its stroke, so the 2.5 px outline stays inside the 11 px box.
        <path d={squareD(size / 2, size / 2, size / 2 - 1.25)} fill={WHITE} stroke={color} strokeWidth={2.5} />
      )}
    </svg>
  );
}

/**
 * One spoke's label: a 60 px column of three rows of explicit height (the
 * name, the offense's line, the defense's line), so nothing in it is sized by
 * its content. Each row aligns itself: the rows of a right-hand label start at
 * the box's left edge, those of a left-hand label end at its right edge.
 */
function spokeLabel(label: MatchupCardSpokeLabel, offColor: string, defColor: string): JSX.Element {
  const [nameRow, offRow, defRow] = L.label.rows;
  const justifyContent = ALIGN[label.box.align];
  const statRow = (unit: "off" | "def", height: number, color: string, line: string) => (
    <div data-label-row={unit} style={{ display: "flex", height, alignItems: "center", justifyContent, whiteSpace: "nowrap" }}>
      {labelMark(color, unit)}
      <div data-label-text style={{ display: "flex", marginLeft: L.label.markGap, fontSize: L.label.statSize, lineHeight: 1, color: INK }}>
        {line}
      </div>
    </div>
  );
  return (
    <div
      key={label.key}
      data-label={label.key}
      style={{
        display: "flex",
        position: "absolute",
        flexDirection: "column",
        left: label.box.left,
        top: label.box.top,
        width: label.box.width,
        height: label.box.height,
        overflow: "hidden",
      }}
    >
      <div data-label-name style={{ display: "flex", height: nameRow, alignItems: "center", justifyContent, whiteSpace: "nowrap", fontSize: L.label.nameSize, color: SLATE }}>
        {label.name}
      </div>
      {statRow("off", offRow, offColor, label.offLine)}
      {statRow("def", defRow, defColor, label.defLine)}
    </div>
  );
}

const points = (vertices: readonly MatchupCardVertex[]): [number, number][] => vertices.map((v) => [v.x, v.y]);

/** One pane: its legend row, then the two outlines over the rings with the seven labels (or its sentence). */
function pane(p: MatchupCardPane, index: number, ringColor: string): JSX.Element {
  const words = matchupCardLegendWords(p.offId, p.defId);
  const ring = (radius: number) => radarPathD(RADAR_AXES.map((_, i) => radarPoint(G, radius, i)));
  const hub = G.r * RADAR_HUB;
  return (
    <div data-pane={String(index)} style={{ display: "flex", flexDirection: "column", width: L.pane.width, height: L.body }}>
      <div data-legend-row style={{ display: "flex", height: L.pane.legend, alignItems: "center", justifyContent: "center", whiteSpace: "nowrap" }}>
        {legendSample(p.offColor, "off")}
        <div data-legend-off style={{ display: "flex", marginLeft: 8, fontSize: 19, color: INK }}>{words.off}</div>
        <div data-legend-over style={{ display: "flex", margin: "0 12px", fontSize: 15, color: GRAY }}>{words.over}</div>
        {legendSample(p.defColor, "def")}
        <div data-legend-def style={{ display: "flex", marginLeft: 8, fontSize: 19, color: INK }}>{words.def}</div>
      </div>
      {p.drawn ? (
        <div data-radar-area data-radar style={{ display: "flex", position: "relative", width: L.pane.width, height: L.pane.radar }}>
          <svg width={G.w} height={G.h} viewBox={`0 0 ${G.w} ${G.h}`}>
            <path data-ring="outer" d={ring(G.r)} fill="none" stroke={LIGHT} strokeWidth={1.5} />
            <path data-ring="mid" d={ring(G.r * radarRadius(RADAR_MID_SCORE))} fill="none" stroke={ringColor} strokeWidth={1.5} strokeDasharray={RING_DASH} />
            <path data-ring="hub" d={ring(hub)} fill={WHITE} stroke={LIGHT} strokeWidth={1.1} />
            {RADAR_AXES.map((axis, i) => {
              const [x1, y1] = radarPoint(G, hub, i);
              const [x2, y2] = radarPoint(G, G.r, i);
              return <line key={axis.key} data-spoke={axis.key} x1={n1(x1)} y1={n1(y1)} x2={n1(x2)} y2={n1(y2)} stroke={FAINT} strokeWidth={1.1} />;
            })}
            {/* The defense first (dashed, behind), then the offense (solid, on top); then the markers, the dots last. */}
            {p.def.length >= 3 ? (
              <path data-outline="def" d={radarPathD(points(p.def))} fill={`${p.defColor}14`} stroke={p.defColor} strokeWidth={3} strokeDasharray={DASH} strokeLinejoin="round" />
            ) : null}
            {p.off.length >= 3 ? (
              <path data-outline="off" d={radarPathD(points(p.off))} fill={`${p.offColor}22`} stroke={p.offColor} strokeWidth={3.4} strokeLinejoin="round" />
            ) : null}
            {p.def.map((v) => (
              <path key={`d-${v.key}`} data-marker="def" d={squareD(v.x, v.y, MARKER.square)} fill={WHITE} stroke={p.defColor} strokeWidth={MARKER.squareStroke} />
            ))}
            {p.off.map((v) => (
              <circle key={`o-${v.key}`} data-dot="off" cx={n1(v.x)} cy={n1(v.y)} r={MARKER.dot} fill={p.offColor} stroke={WHITE} strokeWidth={MARKER.dotStroke} />
            ))}
          </svg>
          {p.labels.map((label) => spokeLabel(label, p.offColor, p.defColor))}
        </div>
      ) : (
        <div data-radar-area style={{ display: "flex", width: L.pane.width, height: L.pane.radar, alignItems: "center", justifyContent: "center" }}>
          <div
            data-pane-message
            style={{ display: "flex", width: L.paneMessageWidth, justifyContent: "center", textAlign: "center", fontSize: 18, lineHeight: 1.4, color: SLATE }}
          >
            {p.message}
          </div>
        </div>
      )}
    </div>
  );
}

const ROOT = { width: "100%", height: "100%", display: "flex", flexDirection: "column", backgroundColor: WHITE, fontFamily: SANS } as const;

/** The card: at least one of the two radars can be drawn. */
export function matchupCardImage(model: CardModel): JSX.Element {
  return (
    <div style={ROOT}>
      {bandAndRule(model)}
      {subBand(model.subLine, model.showHowTo, model.showHowTo ? L.subLineMaxWidth : L.subLineMaxWidthAlone)}

      <div data-block="body" style={{ display: "flex", height: L.body }}>
        {pane(model.panes[0], 0, model.colours.ring)}
        <div data-divider style={{ display: "flex", width: L.divider, marginTop: 14, marginBottom: 10, backgroundColor: LIGHT }} />
        {pane(model.panes[1], 1, model.colours.ring)}
      </div>

      {/* Below the keep-clear line: two right-aligned lines, nothing at the bottom left. */}
      <div
        data-block="footer"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          height: L.footer,
          padding: `14px ${L.padX}px 0`,
          backgroundColor: PANEL,
          borderTop: `1px solid ${LIGHT}`,
        }}
      >
        <div data-legend-line style={{ display: "flex", whiteSpace: "nowrap", fontSize: 15, color: GRAY }}>
          {model.legendLine}
        </div>
        <div data-site style={{ display: "flex", marginTop: 12, fontFamily: PIXEL, fontSize: 10, color: MUTED }}>
          {RADAR_CARD_SITE_LINE}
        </div>
      </div>
    </div>
  );
}

/**
 * The plate: a real pair with nothing to rank (the season is not covered, too
 * few teams have played, or neither radar can be drawn). The card's five
 * blocks at the card's heights, so both teams keep their colours and it is
 * recognisably the same object; the body is one sentence, the page's own.
 */
export function matchupPlateImage(model: PlateModel): JSX.Element {
  return (
    <div style={ROOT}>
      {bandAndRule(model)}
      {subBand(matchupCardSeasonLine(model.season, model.throughWeek), false, L.subLineMaxWidthAlone)}

      <div data-block="message" style={{ display: "flex", height: L.body, alignItems: "center", justifyContent: "center", backgroundColor: WHITE }}>
        <div
          data-plate-message
          style={{ display: "flex", width: L.plateMessageWidth, justifyContent: "center", textAlign: "center", fontSize: 26, lineHeight: 1.4, color: SLATE }}
        >
          {model.message}
        </div>
      </div>

      <div
        data-block="footer"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          height: L.footer,
          // 46 = the card's 14, its legend line and the 12 under it: the site line sits where the card has it.
          padding: `46px ${L.padX}px 0`,
          backgroundColor: PANEL,
          borderTop: `1px solid ${LIGHT}`,
        }}
      >
        <div data-site style={{ display: "flex", fontFamily: PIXEL, fontSize: 10, color: MUTED }}>
          {RADAR_CARD_SITE_LINE}
        </div>
      </div>
    </div>
  );
}
