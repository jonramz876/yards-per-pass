// lib/og/tecmo-card-image.tsx — shared render + data assembly for the Tecmo
// card PNG. Used by the OG image (app/card/[slug]/opengraph-image.tsx) and the
// season-aware download route (app/api/stat-card/[slug]/route.tsx).
//
// Satori (the renderer behind next/og) is NOT a browser: no Tailwind, no CSS
// variables, no class names, every element that has children needs an explicit
// `display: flex`, and text inside <svg> is not rendered. Everything below is
// inline styles only, and the jersey fallback is plain divs rather than SVG
// text.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { tierColor } from "@/lib/stats/tecmo-card";
import type { AbilityRow, TecmoCardData } from "@/lib/stats/tecmo-card";
import { ordinal } from "@/lib/stats/percentiles";
import { textColorForBackground, EM_DASH } from "@/lib/stats/formatters";

// ------------------------------------------------------------------ fonts
/** Registered font family name — the only family the image asks for. */
const PIXEL = "PressStart";

/** Press Start 2P, bundled in the repo (Task 2) — never fetched at runtime. */
export async function loadPixelFont(): Promise<ArrayBuffer> {
  const buf = await readFile(join(process.cwd(), "app", "fonts", "PressStart2P-Regular.ttf"));
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
}

/**
 * The `fonts` option for ImageResponse, or undefined if the bundled TTF can't
 * be read. Undefined makes next/og fall back to its built-in Noto Sans, so a
 * missing font degrades the look instead of throwing a 500.
 */
export async function pixelFontOptions() {
  try {
    return [{ name: PIXEL, data: await loadPixelFont(), style: "normal" as const }];
  } catch (err) {
    console.error("Pixel font unavailable for OG render:", err);
    return undefined;
  }
}

// ------------------------------------------------------------------ assets
/**
 * Fetch a headshot and inline it as a data URI.
 *
 * Satori fetches remote <img> URLs itself, but it does so inside the response
 * ReadableStream where a failure is uncatchable and kills the whole PNG. Doing
 * the fetch here means a dead CDN just falls back to the jersey avatar.
 */
export async function loadHeadshotDataUri(url: string | null | undefined): Promise<string | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const type = res.headers.get("content-type") || "image/png";
    if (!type.startsWith("image/")) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ radar
const CX = 125, CY = 125, RAD = 100;

/** Vertex `i` of an `n`-sided polygon at radius `r`, first vertex straight up. */
function hp(r: number, i: number, n: number): [number, number] {
  const a = -Math.PI / 2 + (i * 2 * Math.PI) / n;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
}

/** Closed SVG path through the supplied points. */
function mp(pts: [number, number][]): string {
  return pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ") + "Z";
}

/** Ring of `n` vertices at radius `r`. */
function ring(r: number, n: number): [number, number][] {
  return Array.from({ length: n }, (_, i) => hp(r, i, n));
}

// ------------------------------------------------------------------ colors
const WHITE = "#ffffff";
const NAVY = "#0f172a";
const GRAY = "#64748b";
const LIGHT = "#e2e8f0";
const PANEL = "#f8fafc";
const MISSING_GRAY = "#94a3b8";

function clampPct(v: number): number {
  return Number.isFinite(v) ? Math.max(0, Math.min(v, 100)) : 0;
}

/** Long names blow past the OVR box in a monospace pixel font — hard cap them. */
function fitName(name: string, max: number): string {
  return name.length > max ? name.slice(0, max - 1) + "…" : name;
}

/** Volume row that is deliberately excluded from OVR (see QB_OVR_KEYS). */
const NON_OVR_ROW = "DROPBACKS/GM";

/**
 * Six ability rows fit on the image; QB cards ship seven. Drop DROPBACKS/GM
 * rather than the tail: it's raw volume, excluded from OVR, whereas the last
 * row (RUSH EPA) is an OVR input, so this keeps the more informative six.
 *
 * The visible rows are not a complete account of the score, and were never
 * meant to be read as one: OVR v3 also weighs ANY/A and per-game production,
 * neither of which has an ability bar on any card, in any render.
 */
function visibleRows(rows: AbilityRow[]): AbilityRow[] {
  if (rows.length <= 6) return rows;
  const trimmed = rows.filter((r) => r.label !== NON_OVR_ROW);
  return (trimmed.length >= 6 ? trimmed : rows).slice(0, 6);
}

interface TeamLike {
  name: string;
  primaryColor: string;
  secondaryColor: string;
}

// ------------------------------------------------------------------ render
/**
 * The 1200x630 share image. A simplified TecmoPlayerCard: team band, identity
 * row, one row of six stat cells, up to six ability rows, radar, footer.
 */
export function tecmoCardImage(
  card: TecmoCardData,
  team: TeamLike,
  headshotUrl: string | null,
  jerseyNumber: number | null,
): JSX.Element {
  const primary = team.primaryColor || NAVY;
  const secondary = team.secondaryColor || "#334155";
  const bandText = textColorForBackground(primary);
  const cells = card.statCells.slice(0, 6);
  const rows = visibleRows(card.abilityRows);
  const axes = card.radarValues.length;
  const showRadar = axes >= 3;
  const dots = showRadar
    ? card.radarValues.map((v, i) => hp((clampPct(v) / 100) * RAD, i, axes))
    : [];
  const name = fitName(
    `${jerseyNumber != null ? `${jerseyNumber}-` : ""}${card.playerName}`.toUpperCase(),
    24,
  );
  const meta = [
    String(card.season),
    `${card.games} GAMES`,
    ...(card.archetypeLabel ? [card.archetypeLabel.toUpperCase()] : []),
  ].join(" · ");

  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        backgroundColor: WHITE,
        fontFamily: PIXEL,
      }}
    >
      {/* Team band */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          height: 56,
          padding: "0 36px",
          backgroundColor: primary,
          color: bandText,
          fontSize: 16,
        }}
      >
        <div style={{ display: "flex" }}>{(team.name || "").toUpperCase()}</div>
        <div style={{ display: "flex" }}>{card.position.toUpperCase()}</div>
      </div>

      <div style={{ display: "flex", flexDirection: "column", flex: 1, padding: "26px 36px 20px" }}>
        {/* Identity row */}
        <div style={{ display: "flex", alignItems: "center" }}>
          {headshotUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- satori renders raw <img>
            <img
              src={headshotUrl}
              alt=""
              width={92}
              height={92}
              style={{
                width: 92,
                height: 92,
                borderRadius: 10,
                objectFit: "cover",
                border: `3px solid ${primary}`,
                backgroundColor: PANEL,
              }}
            />
          ) : (
            <div
              style={{
                display: "flex",
                width: 92,
                height: 92,
                borderRadius: 10,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: primary,
                border: `3px solid ${secondary}`,
                color: bandText,
                fontSize: 26,
              }}
            >
              {jerseyNumber != null ? String(jerseyNumber) : ""}
            </div>
          )}

          <div style={{ display: "flex", flexDirection: "column", marginLeft: 20 }}>
            <div style={{ display: "flex", fontSize: 22, color: NAVY }}>{name}</div>
            <div style={{ display: "flex", fontSize: 11, color: GRAY, marginTop: 12 }}>{meta}</div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginLeft: "auto",
              padding: "12px 18px",
              borderRadius: 10,
              backgroundColor: primary,
              color: bandText,
            }}
          >
            {/* Nullish, never truthiness: an OVR of 0 is a real score. */}
            <div style={{ display: "flex", fontSize: 34 }}>{card.ovr ?? EM_DASH}</div>
            <div style={{ display: "flex", fontSize: 11, marginTop: 8 }}>OVR</div>
          </div>
        </div>

        {/* Stat cells — one row of six */}
        <div style={{ display: "flex", gap: 10, marginTop: 22 }}>
          {cells.map((c) => (
            <div
              key={c.label}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                flex: 1,
                padding: "8px 4px 10px",
                backgroundColor: PANEL,
                border: `1px solid ${LIGHT}`,
                borderRadius: 6,
              }}
            >
              <div style={{ display: "flex", fontSize: 10, color: GRAY }}>
                {c.label.toUpperCase()}
              </div>
              <div style={{ display: "flex", fontSize: 20, color: NAVY, marginTop: 8 }}>
                {c.value}
              </div>
            </div>
          ))}
        </div>

        {/* Ability rows + radar */}
        <div
          style={{
            display: "flex",
            flex: 1,
            alignItems: "center",
            marginTop: 20,
            paddingTop: 14,
            borderTop: `1px solid ${LIGHT}`,
          }}
        >
          <div style={{ display: "flex", flexDirection: "column", flex: 1 }}>
            {rows.map((r) => (
              <div key={r.label} style={{ display: "flex", alignItems: "center", height: 38 }}>
                {/* r.missing — not percentile === 0 — drives the gray dot: a
                    genuine last-place player also scores 0. */}
                <div
                  style={{
                    display: "flex",
                    width: 12,
                    height: 12,
                    borderRadius: 6,
                    backgroundColor: r.missing ? MISSING_GRAY : tierColor(r.percentile),
                  }}
                />
                <div style={{ display: "flex", width: 180, marginLeft: 12, fontSize: 10, color: "#334155" }}>
                  {r.label.toUpperCase()}
                </div>
                <div
                  style={{
                    display: "flex",
                    flex: 1,
                    height: 12,
                    marginLeft: 8,
                    borderRadius: 6,
                    backgroundColor: LIGHT,
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      width: r.missing ? "0%" : `${clampPct(r.percentile)}%`,
                      height: 12,
                      borderRadius: 6,
                      backgroundColor: primary,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    width: 195,
                    marginLeft: 8,
                    justifyContent: "flex-end",
                    fontSize: 10,
                    color: NAVY,
                  }}
                >
                  {r.missing
                    ? EM_DASH
                    : `${r.raw} / ${ordinal(Math.round(clampPct(r.percentile))).toUpperCase()}`}
                </div>
              </div>
            ))}
          </div>

          {showRadar && (
            <div style={{ display: "flex", width: 250, marginLeft: 24, justifyContent: "center" }}>
              <svg width="250" height="250" viewBox="0 0 250 250">
                <path d={mp(ring(RAD, axes))} fill="none" stroke={LIGHT} strokeWidth="1.5" />
                <path d={mp(ring(RAD * 0.5, axes))} fill="none" stroke="#f1f5f9" strokeWidth="1" />
                {ring(RAD, axes).map(([x, y], i) => (
                  <line key={`ax${i}`} x1={CX} y1={CY} x2={x} y2={y} stroke="#f1f5f9" strokeWidth="1" />
                ))}
                <path d={mp(dots)} fill={`${primary}33`} stroke={primary} strokeWidth="2.5" />
                {dots.map(([x, y], i) => (
                  <circle key={`dot${i}`} cx={x} cy={y} r="4" fill={primary} />
                ))}
              </svg>
            </div>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: 6,
            fontSize: 10,
            color: MISSING_GRAY,
          }}
        >
          YARDSPERPASS.COM · DATA: NFLVERSE
        </div>
      </div>
    </div>
  );
}

/**
 * Branded stand-in for an unknown player / missing season — the OG image must
 * always produce a picture rather than a broken embed.
 */
export function brandedFallbackImage(): JSX.Element {
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
        fontFamily: PIXEL,
        color: WHITE,
      }}
    >
      <div style={{ display: "flex", fontSize: 44 }}>YARDS PER PASS</div>
      <div style={{ display: "flex", fontSize: 14, marginTop: 28, color: "#94a3b8" }}>
        NFL ADVANCED STATS · YARDSPERPASS.COM
      </div>
    </div>
  );
}
