// app/glossary/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "NFL Analytics Glossary",
  description:
    "Plain-English definitions for EPA, CPOE, success rate, ANY/A, passer rating, and every stat on Yards Per Pass.",
};

const TERMS: { term: string; definition: string; id?: string }[] = [
  {
    term: "EPA (Expected Points Added)",
    definition:
      "How much each play changes a team\u2019s expected points. A 3rd-and-1 conversion is worth more than a 1st-and-10 three-yard gain. Above 0 = above average.",
  },
  {
    term: "EPA/Play",
    definition:
      "EPA averaged across all plays (passing + rushing). The single best measure of a QB\u2019s total impact.",
  },
  {
    term: "EPA/Dropback (EPA/DB)",
    definition:
      "EPA on passing plays only \u2014 pass attempts, sacks, and scrambles. Isolates arm talent from running ability.",
  },
  {
    term: "CPOE (Completion % Over Expected)",
    definition:
      "How often a QB completes passes compared to what\u2019s expected given throw difficulty. A CPOE of +3 means completing 3% more than expected. Higher is better.",
  },
  {
    term: "Success Rate",
    definition:
      "How often a play gains enough yards to stay \u201Con schedule\u201D \u2014 roughly 40% of needed yards on 1st down, 50% on 2nd, and 100% on 3rd/4th. QB success rate on this site excludes sacks; team success rate includes them.",
  },
  {
    term: "aDOT (Average Depth of Target)",
    definition:
      "Average distance in yards a QB throws downfield. Higher = more aggressive. Computed on true pass attempts only (sacks and scrambles excluded).",
  },
  {
    term: "YPA (Yards Per Attempt)",
    definition:
      "Passing yards divided by pass attempts. A simple efficiency measure. Sacks are excluded from the denominator.",
  },
  {
    term: "ANY/A (Adjusted Net Yards per Attempt)",
    definition:
      "The best single traditional stat for predicting wins. Formula: (Yards + 20\u00d7TD \u2212 45\u00d7INT \u2212 Sack Yards) \u00f7 (Attempts + Sacks). Rewards touchdowns, penalizes turnovers and sacks.",
  },
  {
    term: "Passer Rating",
    definition:
      "The traditional NFL quarterback rating on a 0\u2013158.3 scale. Combines completion %, yards, TDs, and INTs. The most familiar stat, though EPA-based metrics are more predictive.",
  },
  {
    term: "TD:INT Ratio",
    definition:
      "Passing touchdowns per interception. 2:1 is roughly average, 3:1+ is elite. Only counts passing TDs.",
  },
  {
    term: "Dropback",
    definition:
      "Any play where the QB drops back to pass. Includes pass attempts, sacks, and scrambles \u2014 basically everything that starts as a passing play.",
  },
  {
    term: "Rush EPA",
    definition:
      "EPA per rush attempt for a QB. Includes designed runs and scrambles, excludes kneels. Positive = above-average rushing.",
  },
  {
    term: "Run Gap",
    definition:
      "The space between offensive linemen where a running back targets their rush. Gaps are labeled left to right: LE (left end), LT (left tackle), LG (left guard), M (middle/center), RG (right guard), RT (right tackle), RE (right end).",
  },
  {
    term: "Stuff Rate",
    definition:
      "Percentage of rushing attempts stopped at or behind the line of scrimmage (0 or negative yards). Higher stuff rate = worse for the offense. A key indicator of how well a defense plugs run gaps.",
  },
  {
    term: "Explosive Run Rate",
    definition:
      "Percentage of rushing attempts that gain 10+ yards. Higher is better for the offense. Measures big-play ability in the run game.",
  },
  {
    term: "Stuff Avoidance (Stuff Avoid%)",
    definition:
      "1 minus Stuff Rate \u2014 the percentage of carries NOT stopped at or behind the line of scrimmage. Higher is better. Used in the RB radar chart as a positive-direction metric (100% = never stuffed).",
  },
  {
    term: "EPA/Carry",
    definition:
      "Expected Points Added per rushing attempt. Measures how much each carry changes a team\u2019s scoring chances. Positive = above-average efficiency on the ground.",
  },
  {
    term: "Fumbles Lost (FL)",
    definition:
      "Fumbles recovered by the opposing defense. Only the turnovers that actually cost you possession.",
  },
  {
    term: "Off EPA/Play",
    definition:
      "Offensive EPA per play for a team. Measures how efficiently an offense generates expected points. Positive = above average.",
  },
  {
    term: "Def EPA/Play",
    definition:
      "Defensive EPA per play. Measures how well a defense limits opponents. More negative = better defense.",
  },
  {
    term: "Pass Rate",
    definition:
      "Percentage of plays where a team chooses to pass. Influenced by game script (teams trailing pass more).",
  },
  {
    term: "Yards Per Target (Y/Tgt)",
    definition: "Receiving yards divided by targets. Measures how productive each target to a receiver is, including incomplete passes in the denominator.",
  },
  {
    term: "Target Share",
    definition: "Percentage of a team\u2019s total pass targets directed at a specific receiver. Higher target share = more involved in the passing game. Season-long, primary team only for traded players.",
  },
  {
    term: "YAC (Yards After Catch)",
    definition: "Yards gained by a receiver after catching the ball. Measures ability to create yards in the open field beyond the catch point.",
  },
  {
    term: "ADOT (Average Depth of Target)",
    definition: "Average distance downfield a receiver is targeted. Higher ADOT = deeper route tree. Includes incomplete passes.",
  },
  {
    term: "YPRR (Yards Per Route Run)",
    definition: "Receiving yards divided by routes run. Measures how productive a receiver is on every route, not just when targeted. A top-tier efficiency metric that removes volume bias \u2014 a receiver running 50 routes who gains 75 yards is more efficient than one running 150 routes for 100 yards.",
  },
  {
    term: "TPRR (Targets Per Route Run)",
    definition: "Targets divided by routes run. Measures how often a quarterback looks at a receiver on each route they run. High TPRR indicates a receiver who commands attention from the offense regardless of overall target volume.",
  },
  {
    term: "Snap Count",
    definition: "Total offensive plays a player was on the field for. Derived from play-by-play participation data \u2014 counts all play types (passes, runs, penalties). Does not include special teams snaps.",
  },
  {
    term: "Snap Share (Snap%)",
    definition: "Player\u2019s offensive snap count divided by their team\u2019s total offensive snaps. A snap share of 85% means the player was on the field for 85% of the team\u2019s offensive plays. The primary measure of a receiver\u2019s playing time.",
  },
  {
    term: "Route Participation Rate (Route%)",
    definition: "Percentage of a team\u2019s dropback plays where this player was on the field. Measures how often a player is involved in the passing game. A WR with 95% route participation is on the field for nearly every pass play. A blocking TE at 60% is only out there for some passing downs. Industry-standard formula: player dropback snaps / team total dropbacks.",
  },
  // --- QB Archetypes ---
  { term: "Complete Passer (QB Archetype)", id: "complete-passer",
    definition: "A quarterback with 4+ radar axes at the 70th percentile or above. Elite across EPA/DB, CPOE, DB/Game, aDOT, INT%, and Success%." },
  { term: "Playmaker (QB Archetype)", id: "playmaker",
    definition: "A high-efficiency, high-volume quarterback who drives the offense. Defined by EPA/DB \u2265 70th, DB/Game \u2265 70th, and Success% \u2265 60th percentile." },
  { term: "Gunslinger (QB Archetype)", id: "gunslinger",
    definition: "Pushes the ball downfield with aggression. Defined by aDOT \u2265 65th, DB/Game \u2265 55th, and INT% \u2264 45th. Trades turnovers for big plays." },
  { term: "Surgeon (QB Archetype)", id: "surgeon",
    definition: "Precise and consistent passer. Defined by CPOE \u2265 70th, Success% \u2265 65th, and EPA/DB \u2265 55th. Picks apart defenses without forcing throws." },
  { term: "Distributor (QB Archetype)", id: "distributor",
    definition: "High-volume, accurate short-game passer. Defined by DB/Game \u2265 70th, CPOE \u2265 60th, and aDOT \u2264 45th. Moves the chains underneath." },
  { term: "Volume Passer (QB Archetype)", id: "volume-passer",
    definition: "Throws at an extremely high rate with solid efficiency. Defined by DB/Game \u2265 80th and EPA/DB \u2265 50th percentile." },
  { term: "Game Manager (QB Archetype)", id: "game-manager",
    definition: "Protects the football and avoids mistakes. Defined by Success% \u2265 65th, INT% \u2265 65th, and DB/Game \u2264 45th." },
  { term: "Sniper (QB Archetype)", id: "sniper",
    definition: "Accurate deep passer who protects the football. Defined by aDOT \u2265 65th and INT% \u2265 65th. Pushes the ball downfield without turning it over." },
  { term: "Improviser (QB Archetype)", id: "improviser",
    definition: "Creates plays outside of structure. Defined by EPA/DB \u2265 65th, 3+ axes \u2265 60th, and CPOE \u2264 50th. High EPA despite inconsistent accuracy." },
  // --- WR Archetypes ---
  { term: "Alpha WR1 (WR Archetype)", id: "alpha-wr1",
    definition: "Dominant number-one receiver. Defined by 4+ radar axes \u2265 70th and Tgt/Game \u2265 65th. Commands targets and produces at an elite level." },
  { term: "Contested Catch WR (WR Archetype)", id: "contested-catch-wr",
    definition: "Wins downfield and at the catch point. Defined by aDOT \u2265 65th and Catch% \u2265 60th. High depth of target with reliable hands." },
  { term: "YAC Monster (WR Archetype)", id: "yac-monster",
    definition: "Dangerous after the catch. Defined by YAC/Rec \u2265 75th and aDOT \u2264 50th. Turns short throws into big gains." },
  { term: "Target Magnet (WR Archetype)", id: "target-magnet",
    definition: "Commands an elite target share. Defined by Tgt/Game \u2265 80th percentile. The offense runs through this receiver regardless of per-target efficiency." },
  { term: "Field Stretcher (WR Archetype)", id: "field-stretcher",
    definition: "Stretches the field vertically. Defined by aDOT \u2265 75th and Catch% \u2264 50th. Trades catch rate for chunk plays." },
  { term: "Possession Receiver (WR Archetype)", id: "possession-receiver",
    definition: "Reliable hands and route precision. Defined by Catch% \u2265 70th, YPRR \u2265 60th, and aDOT \u2264 45th." },
  { term: "Deep Threat (WR Archetype)", id: "deep-threat",
    definition: "Pure vertical threat. Defined by aDOT \u2265 80th percentile. Lives on deep routes." },
  { term: "Efficient Producer (WR Archetype)", id: "efficient-producer",
    definition: "Maximizes every route run. Defined by YPRR \u2265 75th and EPA/Tgt \u2265 65th with Tgt/Game \u2264 50th." },
  { term: "Playmaker (WR Archetype)", id: "playmaker-wr",
    definition: "Creates big plays through efficiency and after-catch ability. Defined by EPA/Tgt \u2265 65th, YAC/Rec \u2265 65th, and 3+ axes \u2265 60th." },
  // --- RB Archetypes ---
  { term: "Three-Down Back (RB Archetype)", id: "three-down-back",
    definition: "Does it all. Defined by Car/Game \u2265 55th, Tgt/Game \u2265 60th, Success% \u2265 55th, and 2+ of EPA/Car, Stuff Avoid, Explosive%, Success% \u2265 55th." },
  { term: "Elite Runner (RB Archetype)", id: "elite-runner-rb",
    definition: "Elite across multiple rushing dimensions. Defined by 3+ of EPA/Car, Stuff Avoid, Explosive%, Success% at the 70th percentile with Car/Game \u2265 55th. A dominant pure runner." },
  { term: "Dual-Threat Back (RB Archetype)", id: "dual-threat-back",
    definition: "Dangerous as both a runner and receiver. Defined by Car/Game \u2265 55th and Tgt/Game \u2265 70th. A true two-way weapon out of the backfield." },
  { term: "Workhorse (RB Archetype)", id: "workhorse",
    definition: "High-volume carrier. Defined by Car/Game \u2265 70th, EPA/Car \u2265 45th, and Tgt/Game \u2264 45th. Grinds out production on the ground." },
  { term: "Power Back (RB Archetype)", id: "power-back",
    definition: "Runs through contact. Defined by Stuff Avoid \u2265 70th, Car/Game \u2265 50th, and Explosive% \u2264 55th. Avoids getting stuffed." },
  { term: "Home Run Hitter (RB Archetype)", id: "home-run-hitter",
    definition: "Boom-or-bust runner. Defined by Explosive% \u2265 75th and Success% \u2264 45th. Trades consistency for chunk plays." },
  { term: "Pass-Catching Back (RB Archetype)", id: "pass-catching-back",
    definition: "Receiving weapon out of the backfield. Defined by Tgt/Game \u2265 75th and Car/Game \u2264 50th." },
  { term: "Efficient Runner (RB Archetype)", id: "efficient-runner",
    definition: "High EPA on limited carries. Defined by EPA/Car \u2265 70th, Success% \u2265 60th, and Car/Game \u2264 55th." },
  { term: "Change of Pace (RB Archetype)", id: "change-of-pace",
    definition: "Maximizes limited touches. Defined by EPA/Car \u2265 65th, Explosive% \u2265 60th, and Car/Game \u2264 40th." },
  { term: "Bell Cow (RB Archetype)", id: "bell-cow",
    definition: "Dominates touches in the backfield. Defined by Car/Game \u2265 85th percentile. The clear lead back regardless of efficiency." },
];

export default function GlossaryPage() {
  return (
    <div className="max-w-3xl mx-auto px-6 md:px-12 py-16">
      <h1 className="text-2xl font-extrabold text-navy tracking-tight mb-2">
        NFL Analytics Glossary
      </h1>
      <p className="text-sm text-gray-500 mb-8">
        Plain-English definitions for every stat on Yards Per Pass.
      </p>

      <dl className="space-y-6">
        {TERMS.map((t) => (
          <div key={t.term} id={t.id} className={t.id ? "scroll-mt-24" : undefined}>
            <dt className="text-sm font-bold text-navy">{t.term}</dt>
            <dd className="mt-1 text-sm text-gray-600 leading-relaxed">
              {t.definition}
            </dd>
          </div>
        ))}
      </dl>

      <p className="mt-12 text-xs text-gray-400 border-t border-gray-100 pt-4">
        Data source:{" "}
        <a
          href="https://github.com/nflverse"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-navy"
        >
          nflverse
        </a>{" "}
        play-by-play. Stats may differ slightly from Pro Football Reference due to
        methodology differences (sack handling, kneel exclusion, etc.).
      </p>
    </div>
  );
}
