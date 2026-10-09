// lib/og/compare-card-image.tsx — the 1200×630 picture of one comparison
// share card (compare card spec 2026-10-09 §3; PR 2): the link preview and the
// Download button's PNG, both served by /api/compare-card/[a]/[b].
//
// Satori (the renderer behind next/og) is not a browser. The rules this file
// keeps, each held by a test in __tests__/og/compare-card-image.test.tsx (the
// same rules as lib/og/team-radar-image.tsx):
//   - inline styles only; every div is display:flex; no grid;
//   - inside <svg> only <path>, <line> and <circle>, with plain numbers: no
//     <polygon>, and no <text> (Satori does not draw svg text), so the axis
//     labels are divs positioned over the svg;
//   - plain elements only: no components and no fragments;
//   - fonts come from files in the deployment, never from the network: the
//     team radar image's loader (radarImageFonts) and its two family names.
//
// Everything printed comes from ONE model, buildCompareCard
// (lib/stats/compare-card.ts), which the share page prints from too. The
// layout numbers are COMPARE_CARD_LAYOUT's: fixed heights from the top, so
// nothing can slide below the keep-clear line (y = 522), under which only the
// site line sits.
import { PIXEL, SANS } from "@/lib/og/team-radar-image";
import { radarPathD } from "@/lib/stats/team-radar";
import {
  COMPARE_CARD_LAYOUT as L,
  COMPARE_CARD_SITE_LINE,
  COMPARE_CARD_SITE_SHORT,
  COMPARE_CARD_STAT_HEADER,
  COMPARE_OVR_LABEL,
  COMPARE_VS_LABEL,
  compareNameFontSize,
  compareOvrText,
  type CompareCardModel,
  type CompareCardPlayer,
} from "@/lib/stats/compare-card";

const WHITE = "#ffffff";
const NAVY = "#0f172a";
const SLATE = "#475569";
const GRAY = "#64748b";
const LIGHT = "#e2e8f0";
const FAINT = "#f1f5f9";
const PANEL = "#f8fafc";
const MISSING = "#cbd5e1";
const WIN_BG = "#dcfce7";
const WIN_TEXT = "#166534";
const DASH = "9,5";

const R = L.radar;
/** The svg's height: the pane above the legend line. */
const RADAR_H = L.body - L.legend.height;

/** A corner of the radar, in pane coordinates. */
function point(radius: number, i: number, count: number): [number, number] {
  const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
  return [R.cx + radius * Math.cos(angle), R.cy + radius * Math.sin(angle)];
}

const n1 = (v: number): number => Number(v.toFixed(1));

/** The corners a player's outline has: one per axis he has data for, none at all when his outline is not drawn. */
function corners(model: CompareCardModel, side: "a" | "b"): [number, number][] {
  const p = model.comparison[side];
  if (!p.outline) return [];
  const count = model.comparison.axes.length;
  return p.values.flatMap((v, i) => {
    if (p.missing[i] || !Number.isFinite(v)) return [];
    return [point((Math.max(0, Math.min(v, 100)) / 100) * R.r, i, count)];
  });
}

/** One half of the name band: the player's colour, his name in the pixel font, his meta line and his OVR badge. */
function bandHalf(p: CompareCardPlayer, side: "a" | "b"): JSX.Element {
  const name = p.fullName.toUpperCase();
  const size = compareNameFontSize(name.length);
  const right = side === "b";
  // Press Start 2P is exactly one em wide per character. A name wider than its
  // box is cut at its END on both halves, never at its start, and never runs
  // under the OVR badge.
  const fits = name.length * size <= L.nameBox;
  return (
    <div
      data-band-half={side}
      style={{
        display: "flex",
        position: "relative",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: right ? "flex-end" : "flex-start",
        width: L.width / 2,
        height: L.band,
        padding: `0 ${L.pad}px`,
        backgroundColor: p.color,
        color: p.textColor,
      }}
    >
      <div
        data-band-name={side}
        style={{
          display: "flex",
          justifyContent: right && fits ? "flex-end" : "flex-start",
          width: L.nameBox,
          // Taller than the text: the pixel font's glyphs sit high in their line
          // and a tight box cut their tops off (seen in the first local render).
          height: 40,
          alignItems: "center",
          overflow: "hidden",
          whiteSpace: "nowrap",
          fontFamily: PIXEL,
          fontSize: size,
        }}
      >
        {name}
      </div>
      <div
        data-band-meta={side}
        style={{
          display: "flex",
          justifyContent: right ? "flex-end" : "flex-start",
          width: L.nameBox,
          height: 24,
          alignItems: "center",
          overflow: "hidden",
          whiteSpace: "nowrap",
          fontSize: 17,
          opacity: 0.92,
        }}
      >
        {p.meta}
      </div>
      <div
        data-ovr={side}
        style={{
          display: "flex",
          position: "absolute",
          top: 14,
          left: right ? 46 : 478,
          width: 76,
          height: 64,
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 6,
          backgroundColor: WHITE,
          color: NAVY,
          fontFamily: PIXEL,
        }}
      >
        <div data-ovr-value={side} style={{ display: "flex", fontSize: 24 }}>
          {compareOvrText(p.ovr)}
        </div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 8 }}>{COMPARE_OVR_LABEL}</div>
      </div>
    </div>
  );
}

/** The line sample beside a table header: solid for player A, dashed for player B, as on the radar. */
function lineSample(color: string, dashed: boolean): JSX.Element {
  return (
    <svg data-line-sample={dashed ? "b" : "a"} width={40} height={8} viewBox="0 0 40 8">
      <line x1={0} y1={4} x2={40} y2={4} stroke={color} strokeWidth={4} strokeDasharray={dashed ? DASH : undefined} />
    </svg>
  );
}

/** A table value: in a green pill when it is the better one. No bold: the image has one weight. */
function valueCell(text: string, win: boolean, side: "a" | "b"): JSX.Element {
  return (
    <div data-cell={side} data-win={win ? "true" : undefined} style={{ display: "flex", width: 200, justifyContent: "center" }}>
      <div
        style={{
          display: "flex",
          width: 130,
          height: 34,
          alignItems: "center",
          justifyContent: "center",
          borderRadius: 8,
          fontSize: 23,
          backgroundColor: win ? WIN_BG : WHITE,
          color: win ? WIN_TEXT : NAVY,
        }}
      >
        {text}
      </div>
    </div>
  );
}

/** The share card for two players who both have stats for the season. */
export function compareCardImage(model: CompareCardModel): JSX.Element {
  const { a, b, comparison } = model;
  const count = comparison.axes.length;
  const ring = (radius: number) => radarPathD(Array.from({ length: count }, (_, i) => point(radius, i, count)));
  const cornersA = corners(model, "a");
  const cornersB = corners(model, "b");
  const drawnAt = (side: "a" | "b", i: number) => comparison[side].outline && !comparison[side].missing[i];
  const tableWidth = L.width - L.pane - 2 - 14 - 24;

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: WHITE,
        fontFamily: SANS,
      }}
    >
      {/* The band is the legend: each half is that player's line colour. */}
      <div data-block="band" style={{ display: "flex", position: "relative", height: L.band }}>
        {bandHalf(a, "a")}
        {bandHalf(b, "b")}
        <div
          data-vs
          style={{
            display: "flex",
            position: "absolute",
            top: 18,
            left: L.width / 2 - 32,
            width: 64,
            height: 56,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 4,
            border: `3px solid ${WHITE}`,
            backgroundColor: NAVY,
            color: WHITE,
            fontFamily: PIXEL,
            fontSize: 16,
          }}
        >
          {COMPARE_VS_LABEL}
        </div>
      </div>
      <div data-block="rule" style={{ display: "flex", height: L.rule, backgroundColor: NAVY }} />

      <div
        data-block="sub-band"
        style={{
          display: "flex",
          height: L.subBand,
          alignItems: "center",
          justifyContent: "space-between",
          padding: `0 ${L.pad}px`,
          backgroundColor: PANEL,
          borderBottom: `1px solid ${LIGHT}`,
        }}
      >
        <div
          data-sub-band-line
          style={{ display: "flex", width: 940, overflow: "hidden", whiteSpace: "nowrap", fontSize: 15, color: SLATE }}
        >
          {model.subBandLine}
        </div>
        <div data-sub-band-site style={{ display: "flex", fontFamily: PIXEL, fontSize: 10, color: GRAY }}>
          {COMPARE_CARD_SITE_SHORT}
        </div>
      </div>

      <div data-block="body" style={{ display: "flex", height: L.body }}>
        {/* Left: the overlaid radar, or the sentence that says why there is none */}
        {model.radarDrawn ? (
          <div data-radar-pane style={{ display: "flex", position: "relative", width: L.pane, height: L.body }}>
            <svg width={L.pane} height={RADAR_H} viewBox={`0 0 ${L.pane} ${RADAR_H}`}>
              <path data-ring="outer" d={ring(R.r)} fill="none" stroke={LIGHT} strokeWidth={R.stroke / 2} />
              <path
                data-ring="mid"
                d={ring(R.r / 2)}
                fill="rgba(251,191,36,0.06)"
                stroke="#f59e0b"
                strokeWidth={R.stroke / 2}
                strokeDasharray="5,3"
              />
              <path data-ring="inner" d={ring(R.r / 4)} fill="none" stroke={FAINT} strokeWidth={R.stroke / 3} />
              {comparison.axes.map((axis, i) => {
                const [x, y] = point(R.r, i, count);
                return (
                  <line key={axis.label} x1={R.cx} y1={R.cy} x2={n1(x)} y2={n1(y)} stroke={FAINT} strokeWidth={R.stroke / 3} />
                );
              })}
              {/* Player B first (dashed, behind), then player A (solid, on top). */}
              {cornersB.length >= 2 ? (
                <path
                  data-outline="b"
                  d={radarPathD(cornersB)}
                  fill={`${b.color}1A`}
                  stroke={b.color}
                  strokeWidth={R.stroke}
                  strokeLinejoin="round"
                  strokeDasharray={DASH}
                />
              ) : null}
              {cornersB.map(([x, y], i) => (
                <circle key={`b${i}`} data-dot="b" cx={n1(x)} cy={n1(y)} r={R.dot} fill={b.color} opacity={0.7} />
              ))}
              {cornersA.length >= 2 ? (
                <path
                  data-outline="a"
                  d={radarPathD(cornersA)}
                  fill={`${a.color}1F`}
                  stroke={a.color}
                  strokeWidth={R.stroke}
                  strokeLinejoin="round"
                />
              ) : null}
              {cornersA.map(([x, y], i) => (
                <circle key={`a${i}`} data-dot="a" cx={n1(x)} cy={n1(y)} r={R.dot} fill={a.color} />
              ))}
            </svg>

            {comparison.axes.map((axis, i) => {
              const angle = -Math.PI / 2 + (i * Math.PI * 2) / count;
              const cos = Math.cos(angle);
              const sin = Math.sin(angle);
              const x = R.cx + (R.r + R.gap) * cos;
              const y = R.cy + (R.r + R.gap) * sin;
              const box =
                cos > 0.3
                  ? { left: n1(x), width: n1(L.pane - x), justifyContent: "flex-start" as const }
                  : cos < -0.3
                    ? { left: 0, width: n1(x), justifyContent: "flex-end" as const }
                    : { left: n1(x - 110), width: 220, justifyContent: "center" as const };
              // Above the radar the label sits on the point, below it hangs from it, at the sides it is centred.
              const top = sin < -0.3 ? y - R.labelHeight : sin > 0.3 ? y : y - R.labelHeight / 2;
              return (
                <div
                  key={axis.label}
                  data-axis-label={axis.label}
                  data-axis-missing={drawnAt("a", i) || drawnAt("b", i) ? undefined : "true"}
                  style={{
                    display: "flex",
                    position: "absolute",
                    top: n1(top),
                    left: box.left,
                    width: box.width,
                    height: R.labelHeight,
                    alignItems: "center",
                    justifyContent: box.justifyContent,
                    fontSize: R.labelFont,
                    // Grey when neither outline has a corner there.
                    color: drawnAt("a", i) || drawnAt("b", i) ? SLATE : MISSING,
                  }}
                >
                  {axis.label}
                </div>
              );
            })}

            <div
              data-legend
              style={{
                display: "flex",
                position: "absolute",
                top: RADAR_H,
                left: 0,
                width: L.pane,
                height: L.legend.height,
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
                whiteSpace: "nowrap",
                fontSize: L.legend.font,
                color: GRAY,
              }}
            >
              {model.paneLine}
            </div>
          </div>
        ) : (
          <div
            data-radar-pane
            data-no-radar
            style={{
              display: "flex",
              flexDirection: "column",
              width: L.pane,
              height: L.body,
              alignItems: "center",
              justifyContent: "center",
              padding: "0 60px",
            }}
          >
            {(model.tooFewLine ? [model.tooFewLine] : model.notDrawnLines).map((line, i) => (
              <div
                key={i}
                data-no-radar-line
                style={{ display: "flex", marginTop: i === 0 ? 0 : 12, fontSize: 20, lineHeight: 1.4, color: GRAY, textAlign: "center", justifyContent: "center" }}
              >
                {line}
              </div>
            ))}
          </div>
        )}

        <div style={{ display: "flex", width: 2, marginTop: 18, marginBottom: 6, backgroundColor: LIGHT }} />

        {/* Right: seven head-to-head rows, the better value in a green pill */}
        <div data-table style={{ display: "flex", flexDirection: "column", width: tableWidth + 14 + 24, padding: "0 24px 0 14px" }}>
          <div
            data-table-head
            style={{ display: "flex", alignItems: "center", height: L.table.head, borderBottom: `2px solid ${LIGHT}` }}
          >
            <div style={{ display: "flex", alignItems: "center", width: 240, overflow: "hidden" }}>
              {lineSample(a.color, false)}
              <div data-head-name="a" style={{ display: "flex", marginLeft: 8, whiteSpace: "nowrap", fontSize: 16, color: NAVY }}>
                {a.headerName}
              </div>
            </div>
            <div
              data-head-stat
              style={{ display: "flex", width: tableWidth - 480, justifyContent: "center", fontSize: 13, letterSpacing: 1, color: GRAY }}
            >
              {COMPARE_CARD_STAT_HEADER}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", width: 240, overflow: "hidden" }}>
              <div data-head-name="b" style={{ display: "flex", marginRight: 8, whiteSpace: "nowrap", fontSize: 16, color: NAVY }}>
                {b.headerName}
              </div>
              {lineSample(b.color, true)}
            </div>
          </div>
          {model.rows.map((row) => (
            <div
              key={row.key}
              data-row={row.key}
              style={{ display: "flex", alignItems: "center", height: L.table.row, borderBottom: `1px solid ${FAINT}` }}
            >
              {valueCell(row.a, row.winner === 1, "a")}
              <div data-cell-label style={{ display: "flex", width: tableWidth - 400, justifyContent: "center", fontSize: 18, color: SLATE }}>
                {row.label}
              </div>
              {valueCell(row.b, row.winner === 2, "b")}
            </div>
          ))}
        </div>
      </div>

      {/* One full-width line: the small-sample note. */}
      <div
        data-block="strip"
        style={{ display: "flex", height: L.strip, alignItems: "center", justifyContent: "center", padding: `0 ${L.pad}px` }}
      >
        {model.stripLine ? (
          <div data-strip-line style={{ display: "flex", whiteSpace: "nowrap", fontSize: 13, color: SLATE }}>
            {model.stripLine}
          </div>
        ) : null}
      </div>

      {/* Kept clear: X draws the link's title over this strip. Only the site line. */}
      <div
        data-block="footer"
        style={{
          display: "flex",
          height: L.footer,
          alignItems: "flex-end",
          justifyContent: "flex-end",
          padding: `0 ${L.pad}px 26px`,
          backgroundColor: PANEL,
          borderTop: `1px solid ${LIGHT}`,
        }}
      >
        <div data-site style={{ display: "flex", fontFamily: PIXEL, fontSize: 10, color: "#94a3b8" }}>
          {COMPARE_CARD_SITE_LINE}
        </div>
      </div>
    </div>
  );
}

/** A long pair of names in a pixel font needs a smaller size to stay on its lines. */
function plateNameSize(length: number): number {
  if (length <= 16) return 34;
  if (length <= 24) return 26;
  return 18;
}

/**
 * The picture for a real pair with nothing to compare (one or both have no
 * stats for the season): a plate that says so in the page's own sentence. A
 * link preview always gets a picture; it is never the card.
 */
export function comparePlateImage({
  nameA,
  nameB,
  season,
  message,
}: {
  nameA: string;
  nameB: string;
  season: number;
  message: string;
}): JSX.Element {
  const upperA = nameA.toUpperCase();
  const upperB = nameB.toUpperCase();
  const size = plateNameSize(Math.max(upperA.length, upperB.length));
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: NAVY,
        color: WHITE,
        fontFamily: PIXEL,
        padding: "0 70px",
      }}
    >
      <div style={{ display: "flex", fontSize: 16, opacity: 0.7 }}>YARDS PER PASS</div>
      <div data-plate-name="a" style={{ display: "flex", marginTop: 30, fontSize: size, textAlign: "center" }}>
        {upperA}
      </div>
      <div data-plate-vs style={{ display: "flex", marginTop: 14, fontSize: 14, opacity: 0.7 }}>
        {COMPARE_VS_LABEL}
      </div>
      <div data-plate-name="b" style={{ display: "flex", marginTop: 14, fontSize: size, textAlign: "center" }}>
        {upperB}
      </div>
      <div data-plate-season style={{ display: "flex", marginTop: 22, fontSize: 16, opacity: 0.85 }}>
        {`${season} SEASON`}
      </div>
      <div
        data-plate-message
        style={{
          display: "flex",
          marginTop: 30,
          maxWidth: 940,
          fontFamily: SANS,
          fontSize: 26,
          lineHeight: 1.4,
          textAlign: "center",
          justifyContent: "center",
        }}
      >
        {message}
      </div>
      <div data-site style={{ display: "flex", marginTop: 34, fontSize: 12, opacity: 0.6 }}>
        {COMPARE_CARD_SITE_LINE}
      </div>
    </div>
  );
}
