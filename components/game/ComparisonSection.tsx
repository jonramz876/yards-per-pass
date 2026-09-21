// components/game/ComparisonSection.tsx — one AWAY | stat | HOME stat sheet
// (box score spec §6). The dark band and the table share a 28% / 1fr / 28%
// grid: away abbreviation and values right-aligned, the title and labels
// centred, home abbreviation and values left-aligned. Sub-rows start with
// "↳ " in lighter type, detail values sit in muted grey after the main value,
// and the better side's cell is shaded. Pure presentation of a
// ComparisonSectionModel from lib/stats/box-score.ts.
import type { ReactNode } from "react";
import MetricTooltip from "@/components/ui/MetricTooltip";
import type { ComparisonRow, ComparisonSectionModel, Side, StatCell } from "@/lib/stats/box-score";

const PIXEL = "font-[family-name:var(--font-pixel)]";
const PANEL_BG = "#0f172a";
/** The shaded better-side cell: emerald-50 background, emerald-800 bold text. */
const EDGE = { background: "#ecfdf5", color: "#065f46" } as const;

function valueClass(row: ComparisonRow, side: Side): string {
  const align = side === "away" ? "text-right" : "text-left";
  const tone =
    row.better === side
      ? "font-bold"
      : row.sub
        ? "font-medium text-slate-600"
        : "font-semibold text-[#0f172a]";
  const size = row.sub ? "text-[13px] md:text-[14px]" : "text-[14px] md:text-[15px]";
  return `px-2 py-1.5 md:px-4 ${align} ${tone} ${size}`;
}

function Value({ cell, edge }: { cell: StatCell; edge: boolean }) {
  return (
    <>
      {cell.main}
      {cell.detail && (
        <span
          className={`ml-1 text-[12.5px] font-normal max-md:ml-0 max-md:block max-md:text-[11.5px] ${
            edge ? "text-[#3f8f72]" : "text-slate-400"
          }`}
        >
          {cell.detail}
        </span>
      )}
    </>
  );
}

interface ComparisonSectionProps {
  section: ComparisonSectionModel;
  awayId: string;
  homeId: string;
  /** Note under the table (spec §12); omitted when absent. */
  footnote?: ReactNode;
}

export default function ComparisonSection({ section, awayId, homeId, footnote }: ComparisonSectionProps) {
  return (
    <section data-section={section.key} className="overflow-hidden rounded-xl bg-white shadow">
      <h2
        className={`${PIXEL} grid grid-cols-[28%_1fr_28%] items-center py-3 text-[9px] uppercase tracking-wide text-white md:text-[11px]`}
        style={{ background: PANEL_BG }}
      >
        <span className="px-2 text-right md:px-4">{awayId}</span>
        <span className="px-2 text-center md:px-4">{section.title}</span>
        <span className="px-2 text-left md:px-4">{homeId}</span>
      </h2>
      <table className="w-full border-collapse tabular-nums">
        <colgroup>
          <col className="w-[28%]" />
          <col />
          <col className="w-[28%]" />
        </colgroup>
        <tbody>
          {section.rows.map((row) => (
            <tr
              key={row.key}
              data-row={row.key}
              data-better={row.better ?? undefined}
              className="border-b border-slate-100 last:border-b-0"
            >
              <td className={valueClass(row, "away")} style={row.better === "away" ? EDGE : undefined}>
                <Value cell={row.away} edge={row.better === "away"} />
              </td>
              <td
                className={`px-2 py-1.5 text-center md:px-4 ${
                  row.sub
                    ? "text-[11.5px] font-normal text-slate-500 md:text-[13px]"
                    : "text-[12px] font-semibold text-[#0f172a] md:text-[13.5px]"
                }`}
              >
                {row.sub && <span className="text-slate-300">↳ </span>}
                {row.label}
                {row.labelDetail && <span className="ml-1 font-normal text-slate-400">{row.labelDetail}</span>}
                {row.labelSuffix && <span> {row.labelSuffix}</span>}
                {row.tooltip && <MetricTooltip metric={row.tooltip} />}
              </td>
              <td className={valueClass(row, "home")} style={row.better === "home" ? EDGE : undefined}>
                <Value cell={row.home} edge={row.better === "home"} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {footnote && (
        <p className="border-t border-slate-100 px-4 py-2.5 text-xs leading-relaxed text-slate-500">{footnote}</p>
      )}
    </section>
  );
}
