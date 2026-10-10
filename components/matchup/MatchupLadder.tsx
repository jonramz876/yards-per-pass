// components/matchup/MatchupLadder.tsx — direction A's "tale of the tape"
// ladder (team matchup spec 2026-10-10 §8): 13 lines in 5 groups, the offense
// on the left, the defense on the right, and in the middle the stat's name, a
// tug marker and the verdict. Server component; it prints the model's
// strings and computes nothing.
//
// Red has one job here: a filled marker and a bar mean these two league ranks
// are 5 or more places apart. An even or unranked row gets a hollow grey
// marker in (or near) the middle and no bar.
import { MATCHUP_LADDER_NOTE, type LadderModel, type LadderRow, type MatchupGroup } from "@/lib/stats/matchup";

const BARLOW = "font-[family-name:var(--font-barlow)]";
const EM_DASH = "—";

/**
 * The value columns and the numerals in them (spec §8.4). Barlow Condensed's
 * digits are about 0.45 em wide; the fit test holds six characters ("−0.195",
 * "100.0%") to 0.50 em: 90 px in 104, 69 px in 70. The class strings below
 * carry the same four numbers as literals (Tailwind needs the full text).
 */
export const LADDER_COLUMN_MD = 104;
export const LADDER_COLUMN_SM = 70;
export const LADDER_VALUE_MD = 30;
export const LADDER_VALUE_SM = 23;

/**
 * The longest "rank · word" the defense cell prints on ONE line, from md up
 * ("24th · takeaways", 16 characters, measured on one line in the 104 px
 * column at 12.5 px). Anything longer ("T-14th · takeaways", "14th of 29 ·
 * allowed") is stacked: the rank, then the word on its own line, with no dot.
 * Below md the 70 px column never holds both, so the cell is always stacked
 * there. Decided by length, not left to the browser: a browser wraps after
 * the dot and leaves it dangling.
 */
export const DEF_RANK_ONE_LINE_MAX = 16;

const ROW_GRID = "grid grid-cols-[70px_minmax(0,1fr)_70px] gap-[6px] md:grid-cols-[104px_minmax(0,1fr)_104px] md:gap-[10px]";
const VALUE = `${BARLOW} text-[23px] md:text-[30px] font-bold leading-none tabular-nums text-slate-900`;
const RANK = "mt-[3px] text-[12.5px] font-semibold text-slate-500";

/** The site accent: the tug marker and its bar on a lean or a clear edge, nothing else. */
const EDGE_RED = "#D50A0A";

const GROUPS: MatchupGroup[] = ["Overall", "Passing", "Rushing", "Turnovers", "Downs"];

/** "BUF offense by 7 places · clear edge" → the unit in bold, the rest plain. The text itself is the model's. */
function Verdict({ text, level }: { text: string; level: number }) {
  const cut = level > 0 ? text.indexOf(" by ") : text.indexOf(" · ");
  if (cut <= 0) return <>{text}</>;
  return (
    <>
      <b className="font-semibold text-slate-900">{text.slice(0, cut)}</b>
      {text.slice(cut)}
    </>
  );
}

function Tug({ row }: { row: LadderRow }) {
  const edged = row.edge.level > 0;
  return (
    <div data-tug className="relative mx-[9px] mb-[3px] mt-[5px] h-[18px]">
      <span className="absolute -left-[9px] -right-[9px] top-2 h-[2px] bg-[#dbe2ea]" />
      <span className="absolute left-1/2 top-[2px] h-[14px] border-l-2 border-slate-400" />
      {edged && (
        <span
          data-tug-bar
          className="absolute top-[6px] h-[6px]"
          style={{ left: `${Math.min(50, row.tug)}%`, width: `${Math.abs(50 - row.tug)}%`, background: EDGE_RED }}
        />
      )}
      <span
        data-tug-marker
        data-edge={row.edge.side}
        data-hollow={edged ? undefined : "true"}
        className={`absolute top-[1px] -ml-2 h-4 w-4 rounded-full ${edged ? "ring-2 ring-white" : "border-[3px] border-slate-400 bg-white"}`}
        style={edged ? { left: `${row.tug}%`, background: EDGE_RED } : { left: `${row.tug}%` }}
      />
    </div>
  );
}

function DefRank({ row }: { row: LadderRow }) {
  if (row.defRank === EM_DASH) return <>{EM_DASH}</>;
  const inline = `${row.defRank} · ${row.defWord}`;
  const fits = inline.length <= DEF_RANK_ONE_LINE_MAX;
  return (
    <>
      <span data-def-rank-stacked className={fits ? "md:hidden" : undefined}>
        <span data-rank className="block">{row.defRank}</span>
        <span data-word className="block">{row.defWord}</span>
      </span>
      {fits && <span data-def-rank-inline className="hidden md:inline">{inline}</span>}
    </>
  );
}

function Row({ row }: { row: LadderRow }) {
  return (
    <div data-ladder-row={row.key} className={`${ROW_GRID} items-center border-b border-[#eef2f7] pb-[9px] pt-[10px]`}>
      <div className="min-w-0">
        <div data-off-value className={VALUE}>{row.offValue}</div>
        <div data-off-rank className={RANK}>{row.offRank}</div>
      </div>
      <div className="min-w-0 text-center">
        <div data-label-long className="hidden text-[13.5px] font-semibold text-slate-900 md:block">{row.label}</div>
        <div data-label-short className="text-[13px] font-semibold text-slate-900 md:hidden">{row.shortLabel}</div>
        <Tug row={row} />
        <div data-verdict className="text-[12.5px] text-slate-600">
          <Verdict text={row.verdict} level={row.edge.level} />
        </div>
      </div>
      <div className="min-w-0 text-right">
        <div data-def-value className={VALUE}>{row.defValue}</div>
        <div data-def-rank className={RANK}><DefRank row={row} /></div>
      </div>
    </div>
  );
}

const UNIT_TITLE = `${BARLOW} block text-[17px] md:text-[22px] font-bold leading-none tracking-[0.03em] text-navy md:whitespace-nowrap`;
const UNIT_SUB = "mt-1 block text-[12px] font-medium text-slate-500";

export default function MatchupLadder({ ladder }: { ladder: LadderModel }) {
  const rows = Array.isArray(ladder?.rows) ? ladder.rows : [];
  return (
    <div data-ladder className="border border-t-0 border-slate-200 bg-white px-3 pb-[14px] pt-[6px] md:px-5">
      <div
        data-ladder-head
        className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-end gap-[6px] border-b-2 border-navy pb-[10px] pt-[14px] md:grid-cols-[auto_minmax(0,1fr)_auto] md:gap-[10px]"
      >
        <div data-unit="off" className="min-w-0">
          <span data-unit-title className={UNIT_TITLE}>{`${ladder.offId} OFFENSE`}</span>
          <span className={UNIT_SUB}>what it does</span>
        </div>
        <p data-ladder-how className="order-last col-span-2 m-0 min-w-0 text-center text-[11.5px] leading-snug text-slate-500 md:order-none md:col-span-1 md:text-[12px]">
          {MATCHUP_LADDER_NOTE}
        </p>
        <div data-unit="def" className="min-w-0 text-right">
          <span data-unit-title className={UNIT_TITLE}>{`${ladder.defId} DEFENSE`}</span>
          <span className={UNIT_SUB}>what it allows</span>
        </div>
      </div>

      {GROUPS.map((group) => {
        const lines = rows.filter((r) => r.group === group);
        if (lines.length === 0) return null;
        return (
          <div key={group}>
            <div data-ladder-group className={`${BARLOW} border-b border-slate-200 pb-1 pt-4 text-[16px] font-semibold uppercase tracking-[0.08em] text-navy`}>
              {group}
            </div>
            {lines.map((row) => (
              <Row key={row.key} row={row} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
