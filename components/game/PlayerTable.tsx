// components/game/PlayerTable.tsx — one player-lines table (type A, box score
// spec §6): a PASSING / RUSHING / RECEIVING band, a sub-header row per team
// (team-colour square + abbreviation, "· 28 team targets" on Receiving), the
// away team's rows first. Names link to player pages with a small grey
// position tag; EPA cells take the site's colour thresholds with null / NaN
// in grey. The table scrolls sideways in its own container on phones.
import { Fragment, type ReactNode } from "react";
import Link from "next/link";
import { epaCellClass, type PlayerTableModel } from "@/lib/stats/box-score";

const PIXEL = "font-[family-name:var(--font-pixel)]";
const PANEL_BG = "#0f172a";

interface PlayerTableProps {
  model: PlayerTableModel;
  /** Note under the table (spec §12); omitted when absent. */
  footnote?: ReactNode;
}

export default function PlayerTable({ model, footnote }: PlayerTableProps) {
  const span = model.columns.length;
  return (
    <section data-player-table={model.key} className="overflow-hidden rounded-xl bg-white shadow">
      <h2
        className={`${PIXEL} px-4 py-3 text-[9px] uppercase tracking-wide text-white md:px-5 md:text-[11px]`}
        style={{ background: PANEL_BG }}
      >
        {model.title}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px] tabular-nums">
          <thead>
            <tr>
              {model.columns.map((col, i) => (
                <th
                  key={col}
                  className={`whitespace-nowrap border-b border-gray-200 bg-gray-50 px-2.5 py-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400 ${
                    i === 0 ? "text-left" : "text-right"
                  }`}
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.teams.map((team) => (
              <Fragment key={team.team_id}>
                <tr data-team-row={team.team_id}>
                  <td colSpan={span} className="bg-slate-50 px-2.5 py-1.5 text-left text-xs font-bold text-slate-700">
                    <span
                      aria-hidden="true"
                      className="mr-1.5 inline-block h-[11px] w-[11px] rounded-[3px] align-[-1px]"
                      style={{ background: team.color }}
                    />
                    {team.team_id}
                    {team.note && <span className="font-normal text-slate-500"> · {team.note}</span>}
                  </td>
                </tr>
                {team.rows.length === 0 && (
                  <tr data-empty-team={team.team_id}>
                    <td colSpan={span} className="px-2.5 py-2 text-left text-xs text-gray-400">
                      No {model.title.toLowerCase()} line for {team.team_id}
                    </td>
                  </tr>
                )}
                {team.rows.map((row) => (
                  <tr key={row.player_id} data-player-id={row.player_id} className="border-b border-gray-100 last:border-b-0">
                    <td className="whitespace-nowrap px-2.5 py-1.5 text-left text-gray-900">
                      {row.slug ? (
                        <Link
                          href={`/player/${row.slug}`}
                          className="font-medium text-navy transition-colors hover:text-nflred"
                        >
                          {row.name}
                        </Link>
                      ) : (
                        <span className="font-medium">{row.name}</span>
                      )}
                      {row.position && (
                        <span className="ml-1.5 text-[11px] font-medium text-gray-400">{row.position}</span>
                      )}
                    </td>
                    {row.cells.map((cell, i) => (
                      <td
                        key={model.columns[i + 1] ?? i}
                        className={`whitespace-nowrap px-2.5 py-1.5 text-right ${
                          "epa" in cell ? epaCellClass(cell.epa) : "text-gray-900"
                        }`}
                      >
                        {cell.text}
                      </td>
                    ))}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {footnote && (
        <p className="border-t border-gray-100 px-4 py-2.5 text-xs leading-relaxed text-slate-500">{footnote}</p>
      )}
    </section>
  );
}
