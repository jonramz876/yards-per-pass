// lib/og/team-radar-image.tsx — the 1200×630 picture of one team radar share
// card (team radar spec 2026-10-06 §5, §7; PR 3): the link preview and the
// Download button's PNG, both served by /api/team-radar/[team_id]/[side].
//
// Satori (the renderer behind next/og) is not a browser. The rules this file
// keeps, each held by a test in __tests__/og/team-radar-image.test.tsx:
//   - inline styles only; every div is display:flex; no grid;
//   - inside <svg> only <path>, <line> and <circle>: no <polygon>, and no
//     <text> (Satori does not draw svg text), so the spoke labels are divs
//     positioned over the svg, direct children of the box the svg sits in;
//   - plain elements only: no components and no fragments;
//   - fonts come from files in the deployment, never from the network.
// The shape is the page chart's: sizes, angles and label positions all come
// from lib/stats/team-radar (RADAR_SIZES.card).
//
// @vercel/og cannot render on Windows, so this picture can only be looked at
// on a Vercel preview.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { textColorForBackground, EM_DASH } from "@/lib/stats/formatters";
import {
  RADAR_AXES,
  RADAR_CARD_SITE_LINE,
  RADAR_CARD_SUBTITLE,
  RADAR_MID_SCORE,
  RADAR_SIZES,
  axisLabel,
  canDrawRadar,
  fmtRadarPct,
  plottableScore,
  radarCardBandAside,
  radarCardFooter,
  radarLabelPosition,
  radarPathD,
  radarPoint,
  radarRadius,
  radarStrokeColor,
  radarTableOnlyNote,
  rankCellLabel,
  rankTone,
  spokeRankLabel,
  type RadarSide,
  type RankTone,
  type TeamRadarSlice,
} from "@/lib/stats/team-radar";

// ------------------------------------------------------------------ fonts
/** Press Start 2P: the band, the plate and the site line (the family name the player card registers too). */
const PIXEL = "PressStart";
/** The readable font for labels, the table and the footer. */
const SANS = "RadarSans";

/**
 * Where the readable font is read from, relative to the deployment root: the
 * Noto Sans (regular, latin) file that ships inside next/og as its own default
 * font. The spec asked for two bundled static Inter files; none is in the repo
 * yet (adding them means downloading a font, which needs Jon's say-so), and
 * this file is already in every deployment. A test fails if a Next upgrade
 * moves it. Regular weight only, so nothing in the image is bold.
 */
export const RADAR_IMAGE_SANS_FONT_PATH = [
  "node_modules", "next", "dist", "compiled", "@vercel", "og", "noto-sans-v27-latin-regular.ttf",
] as const;

function toArrayBuffer(buf: Buffer): ArrayBuffer {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

// Both paths are written out as literal join(process.cwd(), ...) calls on
// purpose: that is the form Vercel's file tracing follows to copy a file into
// the function (the way app/fonts/PressStart2P-Regular.ttf already gets there).
async function loadPixel(): Promise<ArrayBuffer> {
  return toArrayBuffer(await readFile(join(process.cwd(), "app", "fonts", "PressStart2P-Regular.ttf")));
}

async function loadSans(): Promise<ArrayBuffer> {
  return toArrayBuffer(
    await readFile(
      join(process.cwd(), "node_modules", "next", "dist", "compiled", "@vercel", "og", "noto-sans-v27-latin-regular.ttf"),
    ),
  );
}

/**
 * The `fonts` option for ImageResponse. A font that cannot be read is logged
 * and left out (the image then draws its text in whichever font remains, or
 * in next/og's default when neither loads): a missing font never turns the
 * image into an error.
 */
export async function radarImageFonts(): Promise<{ name: string; data: ArrayBuffer; style: "normal"; weight: 400 }[] | undefined> {
  const fonts: { name: string; data: ArrayBuffer; style: "normal"; weight: 400 }[] = [];
  for (const [name, load] of [[SANS, loadSans], [PIXEL, loadPixel]] as const) {
    try {
      fonts.push({ name, data: await load(), style: "normal", weight: 400 });
    } catch (err) {
      console.error(`Team radar image: font ${name} unavailable`, err);
    }
  }
  return fonts.length > 0 ? fonts : undefined;
}

// ------------------------------------------------------------------ colours
const WHITE = "#ffffff";
const NAVY = "#0f172a";
const SLATE = "#475569";
const GRAY = "#64748b";
const LIGHT = "#e2e8f0";
const FAINT = "#f1f5f9";
const MISSING = "#cbd5e1";
const TONE_COLOR: Record<RankTone, string> = { good: "#047857", bad: "#b91c1c", mid: SLATE, none: MISSING };

type TeamLike = { id: string; name: string; primaryColor: string; secondaryColor: string };
type ReadySlice = Extract<TeamRadarSlice, { state: "ready" }>;

const HEX6 = /^#[0-9a-fA-F]{6}$/;
const G = RADAR_SIZES.card;
/** Label box width when the text is centred on its spoke. */
const MIDDLE_LABEL_WIDTH = 220;

// ------------------------------------------------------------------ card
/** The share card for one side of one team with a radar to show (state "ready"). */
export function teamRadarCardImage({ team, side, slice }: { team: TeamLike; side: RadarSide; slice: ReadySlice }): JSX.Element {
  const primary = HEX6.test(team.primaryColor) ? team.primaryColor : NAVY;
  const secondary = HEX6.test(team.secondaryColor) ? team.secondaryColor : "#334155";
  const bandText = textColorForBackground(primary);
  // The page chart's rule: an outline that shows on white for every team; the
  // primary colour stays as the fill tint.
  const stroke = radarStrokeColor(team.primaryColor, team.secondaryColor);
  const model = slice[side];
  const drawRadar = canDrawRadar(model);

  const at = (score: number) => G.r * radarRadius(score);
  const ring = (score: number) => radarPathD(RADAR_AXES.map((_, i) => radarPoint(G, at(score), i)));
  const scores = model.spokes.map((s) => plottableScore(s));
  const vertices = scores.flatMap((score, i) => (score === null ? [] : [radarPoint(G, at(score), i)]));

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
      {/* Team band */}
      <div
        data-band
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          height: 72,
          padding: "0 36px",
          backgroundColor: primary,
          color: bandText,
          fontFamily: PIXEL,
        }}
      >
        <div data-band-team style={{ display: "flex", fontSize: 20 }}>
          {(team.name || team.id || "").toUpperCase()}
        </div>
        <div data-band-aside style={{ display: "flex", fontSize: 12 }}>
          {radarCardBandAside(side, slice.season, slice.throughWeek).toUpperCase()}
        </div>
      </div>
      <div data-band-rule style={{ display: "flex", height: 4, backgroundColor: secondary }} />

      <div style={{ display: "flex", height: 478 }}>
        {/* Left: the radar, or the sentence that says why there is none */}
        <div style={{ display: "flex", width: G.w, height: 478, alignItems: "center", justifyContent: "center" }}>
          {drawRadar ? (
            <div style={{ display: "flex", position: "relative", width: G.w, height: G.h }}>
              <svg width={G.w} height={G.h} viewBox={`0 0 ${G.w} ${G.h}`}>
                <path data-ring="outer" d={ring(1)} fill="none" stroke={LIGHT} strokeWidth={G.sw} />
                <path
                  data-ring="mid"
                  d={ring(RADAR_MID_SCORE)}
                  fill="rgba(251,191,36,0.06)"
                  stroke="#f59e0b"
                  strokeWidth={G.sw}
                  strokeDasharray="5,3"
                />
                <path data-ring="inner" d={ring(0)} fill={WHITE} stroke={LIGHT} strokeWidth={G.sw * 0.75} />
                {RADAR_AXES.map((axis, i) => {
                  const [x0, y0] = radarPoint(G, at(0), i);
                  const [x1, y1] = radarPoint(G, at(1), i);
                  return (
                    <line
                      key={axis.key}
                      x1={x0.toFixed(1)}
                      y1={y0.toFixed(1)}
                      x2={x1.toFixed(1)}
                      y2={y1.toFixed(1)}
                      stroke="#eef2f7"
                      strokeWidth={G.sw * 0.75}
                    />
                  );
                })}
                {vertices.length >= 3 ? (
                  <path
                    data-radar-outline
                    d={radarPathD(vertices)}
                    fill={`${primary}22`}
                    stroke={stroke}
                    strokeWidth={G.sw * 2}
                    strokeLinejoin="round"
                  />
                ) : null}
                {vertices.map(([x, y], i) => (
                  <circle key={`dot${i}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r={G.dot} fill={stroke} />
                ))}
              </svg>

              {RADAR_AXES.map((axis, i) => {
                const p = radarLabelPosition(G, i);
                const spoke = model.spokes[i];
                const missing = scores[i] === null;
                const box =
                  p.anchor === "start"
                    ? { left: p.x, width: G.w - p.x, alignItems: "flex-start" as const }
                    : p.anchor === "end"
                      ? { left: 0, width: p.x, alignItems: "flex-end" as const }
                      : { left: p.x - MIDDLE_LABEL_WIDTH / 2, width: MIDDLE_LABEL_WIDTH, alignItems: "center" as const };
                return (
                  <div
                    key={axis.key}
                    data-axis-label={axis.key}
                    style={{
                      display: "flex",
                      flexDirection: "column",
                      position: "absolute",
                      top: p.y1 - G.f,
                      left: box.left,
                      width: box.width,
                      alignItems: box.alignItems,
                      fontSize: G.f,
                      lineHeight: G.lh / G.f,
                    }}
                  >
                    <div data-axis-name style={{ display: "flex", color: missing ? MISSING : SLATE }}>
                      {axisLabel(axis, side)}
                    </div>
                    {missing ? (
                      <div style={{ display: "flex", color: MISSING }}>{EM_DASH}</div>
                    ) : (
                      <div style={{ display: "flex" }}>
                        <div data-axis-value style={{ display: "flex", color: NAVY }}>
                          {fmtRadarPct(spoke.value)}
                        </div>
                        <div data-axis-rank style={{ display: "flex", marginLeft: 5, color: GRAY }}>
                          {`· ${spokeRankLabel(spoke)}`}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              data-table-only
              style={{ display: "flex", width: 440, fontSize: 22, lineHeight: 1.4, color: GRAY, textAlign: "center", justifyContent: "center" }}
            >
              {radarTableOnlyNote(side)}
            </div>
          )}
        </div>

        <div style={{ display: "flex", width: 2, marginTop: 30, marginBottom: 30, backgroundColor: LIGHT }} />

        {/* Right: value, rank and NFL average for each spoke */}
        <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "34px 36px 0 28px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              height: 30,
              borderBottom: `2px solid ${LIGHT}`,
              fontSize: 13,
              color: GRAY,
            }}
          >
            <div data-table-head style={{ display: "flex", flex: 1, letterSpacing: 0.6 }}>
              {RADAR_CARD_SUBTITLE[side].toUpperCase()}
            </div>
            <div data-table-head style={{ display: "flex", width: 92, justifyContent: "flex-end" }}>
              {team.id}
            </div>
            <div data-table-head style={{ display: "flex", width: 120, justifyContent: "flex-end" }}>
              RANK
            </div>
            <div data-table-head style={{ display: "flex", width: 96, justifyContent: "flex-end" }}>
              NFL AVG
            </div>
          </div>
          {RADAR_AXES.map((axis, i) => {
            const spoke = model.spokes[i];
            const missing = spoke.value === null;
            return (
              <div
                key={axis.key}
                data-row={axis.key}
                style={{ display: "flex", alignItems: "center", height: 54, borderBottom: `2px solid ${FAINT}` }}
              >
                <div data-cell-label style={{ display: "flex", flex: 1, fontSize: 20, color: missing ? MISSING : NAVY }}>
                  {axisLabel(axis, side)}
                </div>
                <div
                  data-cell-value
                  style={{ display: "flex", width: 92, justifyContent: "flex-end", fontSize: 22, color: missing ? MISSING : NAVY }}
                >
                  {fmtRadarPct(spoke.value)}
                </div>
                <div
                  data-cell-rank
                  style={{
                    display: "flex",
                    width: 120,
                    justifyContent: "flex-end",
                    fontSize: 17,
                    color: TONE_COLOR[rankTone(spoke.rank, spoke.pool)],
                  }}
                >
                  {rankCellLabel(spoke, slice.teamsPlayed)}
                </div>
                <div data-cell-avg style={{ display: "flex", width: 96, justifyContent: "flex-end", fontSize: 17, color: GRAY }}>
                  {fmtRadarPct(slice.league[axis.key])}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 76 }}>
        <div data-footer style={{ display: "flex", fontSize: 15, color: GRAY }}>
          {radarCardFooter(slice.teamsPlayed)}
        </div>
        <div data-site style={{ display: "flex", marginTop: 12, fontSize: 10, color: "#94a3b8", fontFamily: PIXEL }}>
          {RADAR_CARD_SITE_LINE}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ plate
/** A long name in a pixel font needs a smaller size to stay on one line. */
function plateNameSize(length: number): number {
  if (length <= 14) return 46;
  if (length <= 20) return 36;
  return 28;
}

/**
 * The picture for a real team and side with no radar to draw (the team has
 * not played, too few teams have, or the season has no team stats): a
 * team-colour plate that says so in the page's own sentence. A link preview
 * always gets a picture; it is never the card.
 */
export function teamRadarPlateImage({
  team,
  side,
  season,
  message,
}: {
  team: TeamLike;
  side: RadarSide;
  season: number;
  message: string;
}): JSX.Element {
  const bg = HEX6.test(team.primaryColor) ? team.primaryColor : NAVY;
  const name = (team.name || team.id || "").toUpperCase();
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: bg,
        color: textColorForBackground(bg),
        fontFamily: PIXEL,
        padding: "0 70px",
      }}
    >
      <div style={{ display: "flex", fontSize: 16, opacity: 0.7 }}>YARDS PER PASS</div>
      <div data-plate-team style={{ display: "flex", marginTop: 34, fontSize: plateNameSize(name.length), textAlign: "center" }}>
        {name}
      </div>
      <div data-plate-side style={{ display: "flex", marginTop: 26, fontSize: 18, opacity: 0.85 }}>
        {radarCardBandAside(side, season, null).toUpperCase()}
      </div>
      <div
        data-plate-message
        style={{
          display: "flex",
          marginTop: 40,
          maxWidth: 940,
          fontFamily: SANS,
          fontSize: 28,
          lineHeight: 1.4,
          textAlign: "center",
          justifyContent: "center",
        }}
      >
        {message}
      </div>
      <div data-site style={{ display: "flex", marginTop: 44, fontSize: 12, opacity: 0.6 }}>
        {RADAR_CARD_SITE_LINE}
      </div>
    </div>
  );
}
