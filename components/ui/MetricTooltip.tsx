// components/ui/MetricTooltip.tsx
"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// Spec A section 4.6: the entries marked "Describes:" below are pinned to the code
// they describe by the paired pytests in tests/ (spec A T13), which run the
// aggregator AND read this file's text, and by __tests__/components/MetricTooltip.test.tsx.
export const METRIC_DEFINITIONS: Record<string, string> = {
  // Describes: epa_per_play = (dropback EPA + designed-run EPA) / (dropbacks +
  // designed runs), kneels dropped (scripts/ingest.py aggregate_qb_stats).
  // Weighted league average by season: 2020 +0.075 ... 2023 -0.006 ... 2026 +0.072.
  "EPA/Play":
    "Points added per play, passing and rushing \u2014 every dropback and designed run, kneel-downs left out. The best single measure of QB impact. The league average moves from season to season (from about \u22120.01 to +0.07 since 2020), so compare with the league average given under the table rather than with 0.",
  "EPA/DB":
    "Points added per dropback (pass attempts + sacks + scrambles; spikes to stop the clock excluded). Passing-only version of EPA \u2014 isolates arm talent from running ability.",
  CPOE: "How often a QB completes passes vs. what\u2019s expected given throw difficulty. +3 means completing 3% more than expected. Higher is better.",
  "Comp%":
    "Completions \u00f7 attempts. The raw completion rate \u2014 doesn\u2019t account for throw difficulty like CPOE does.",
  // Describes: the mean of nflverse's `success` flag (EPA > 0). QB: non-sack
  // dropbacks (ingest.py aggregate_qb_stats, non_sack_dropbacks); RB: carries
  // (aggregate_rb_season_stats). Pinned by tests/test_leaderboard_stats.py
  // TestDefinitionsMatchCode.test_qb_season_success_is_the_flag_without_sacks.
  "Success%":
    "Share of plays that gained expected points (EPA above zero) \u2014 nflverse\u2019s success flag, not a yards-to-go rule. For quarterbacks it counts dropbacks other than sacks (sacks are an OL failure, not the QB\u2019s); for running backs, carries. Team-level success rate on the scatter plot includes sacks.",
  Sk: "Sacks taken. Counts against EPA/DB \u2014 a QB who holds the ball too long will see this drag down efficiency.",
  "Rush Att":
    "Rush attempts: designed runs + scrambles, excluding kneels. PFR includes kneels, so numbers may differ slightly.",
  // Describes: rush_epa_per_play = QB rush EPA / rush_attempts, designed runs
  // and scrambles, kneels dropped (ingest.py aggregate_qb_stats). The average
  // QB rush was +0.18 to +0.29 in every season 2020-2026.
  "Rush EPA":
    "Points added per QB rush \u2014 designed runs and scrambles, kneel-downs left out. The average QB rush is worth well above zero, so compare with the league average given under the table, not with 0.",
  "Sk Yds":
    "Total yards lost on sacks. Shown as a positive number (e.g., 150 = 150 yards lost).",
  aDOT: "Average throw depth in yards. Higher = throws farther downfield. Think deep-ball QBs vs. check-down QBs.",
  YPA: "Passing yards \u00f7 attempts. A simple per-throw efficiency measure (sacks excluded).",
  "ANY/A":
    "Adjusted Net Yards per Attempt \u2014 the best traditional stat for predicting wins. Rewards TDs and penalizes INTs and sacks in one number.",
  Rating:
    "Traditional passer rating (0\u2013158.3). The most familiar QB stat, combining completion %, yards, TDs, and INTs. EPA-based metrics are more predictive.",
  "Off EPA/Play":
    "Points added per play by the offense. Positive = the offense is helping the team score.",
  "Def EPA/Play":
    "Points allowed per play by the defense. More negative = better defense (giving up fewer points).",
  FL: "Fumbles lost \u2014 only fumbles recovered by the defense. The turnovers that actually cost you.",
  "TD:INT":
    "Passing touchdowns per interception. Higher is better. 2:1 is average, 3:1+ is elite.",
  // Describes: epa_per_target = mean EPA over targets (ingest.py
  // aggregate_receiver_stats). The average target was +0.15 to +0.23 in
  // every season 2020-2026.
  "EPA/Tgt":
    "Points added per target. The best single efficiency measure for receivers. The average target is worth well above zero, so a receiver near 0 is below average \u2014 compare with the league average given under the table.",
  "Catch%":
    "Receptions \u00f7 targets. How often a receiver catches the ball when targeted.",
  ADOT: "Average Depth of Target \u2014 how far downfield a receiver is targeted on average. Higher = more of a deep threat.",
  "YAC/Rec":
    "Yards after catch per reception. Measures a receiver\u2019s ability to gain yards with the ball in their hands.",
  // Divided by the team's TARGETS, not its pass attempts: scripts/ingest.py
  // builds target_share from target_plays (a receiver charged, a pass attempt,
  // no sack, no scramble), so the denominator is smaller than Comp/Att's and a
  // reader working from "pass attempts" gets a different number than the site
  // prints. Same denominator as the box score's TGT% column.
  "Tgt Share":
    "Percentage of the team's targets \u2014 throws charged to a receiver \u2014 aimed at this one. Higher = more involved in the passing game.",
  YPR: "Yards per reception. Total receiving yards \u00f7 receptions. A simple per-catch efficiency measure.",
  // Describes: routes_run = pass plays (pass_attempt, no sack, no scramble;
  // filter_plays has already dropped spikes) the player was on the field for
  // (ingest.py aggregate_receiver_stats). Pinned by tests/test_receiver_stats.py
  // TestRouteDefinitionsMatchCode.test_a_sack_is_not_a_route.
  YPRR: "Yards Per Route Run \u2014 receiving yards divided by routes run. A route here is any pass thrown while the player was on the field \u2014 sacks and scrambles don\u2019t count, and neither do spikes \u2014 so a back or tight end who stayed in to block still gets one.",
  // Describes: targets / routes_run, routes as for YPRR.
  TPRR: "Targets Per Route Run \u2014 targets divided by routes run, with routes counted as in YPRR. How often a player gets targeted on each route.",
  Snaps: "Total offensive plays the player was on the field. Derived from play-by-play participation data.",
  "Snap%": "Percentage of team\u2019s offensive plays the player was on the field. 100% means every snap.",
  // Describes: route_participation_rate = the player's dropback snaps with his
  // main team / that team's dropbacks (ingest.py aggregate_receiver_stats).
  // Pinned by tests/test_receiver_stats.py test_route_participation_rate and
  // TestRouteDefinitionsMatchCode.test_route_share_is_team_dropbacks.
  "Route%": "Share of his team\u2019s dropbacks the player was on the field for (his main team, for a player traded mid-season). High = on the field for nearly every pass play; lower for part-timers and players used mainly on running downs.",
  // Describes: epa_per_carry = mean EPA over RB carries (ingest.py
  // aggregate_rb_season_stats). The average RB carry was -0.05 to -0.10 in
  // every season 2020-2026.
  "EPA/Car":
    "Points added per carry. The best single efficiency measure for rushers. The average running-back carry is worth less than zero, so a back near 0 is above average \u2014 compare with the league average given under the table.",
  "Stuff%":
    "Percentage of carries stopped at or behind the line of scrimmage (\u22640 yards). Lower is better.",
  "Explosive%":
    "Percentage of carries that gain 10+ yards. Higher is better \u2014 measures big-play ability on the ground.",
  CROE: "Catch Rate Over Expected \u2014 actual catch rate minus the expected catch rate based on throw difficulty. Positive = catches more than expected. A better version of raw Catch%.",
  "TD%":
    "Touchdown percentage \u2014 passing TDs \u00f7 pass attempts \u00d7 100. What percentage of throws go for scores.",
  "INT%":
    "Interception percentage \u2014 INTs \u00f7 pass attempts \u00d7 100. Lower is better.",
  "SK%":
    "Sack percentage \u2014 sacks \u00f7 (attempts + sacks) \u00d7 100. Measures how often a QB is sacked. Lower is better.",
  "SCR%":
    "Scramble percentage \u2014 scrambles \u00f7 dropbacks \u00d7 100. How often a QB takes off running instead of throwing.",
  "AY%":
    "Air Yards Share \u2014 percentage of team\u2019s total air yards belonging to this receiver. Measures target quality, not just volume.",
  // Describes: receiving_success_rate = mean `success` over targets (ingest.py
  // aggregate_receiver_stats). Pinned by tests/test_leaderboard_stats.py
  // test_basic_receiving_sr and TestDefinitionsMatchCode.
  "Recv SR%":
    "Receiving Success Rate \u2014 the share of a player\u2019s targets that gained expected points (EPA above zero).",
  // Describes: QB total_epa = dropback EPA sum (ingest.py `qb_stats['total_epa']
  // = dropback_epa_sum`); RB total_rushing_epa = carry EPA sum; receiver
  // total_receiving_epa = target EPA sum. Pinned by tests/test_leaderboard_stats.py
  // TestDefinitionsMatchCode.test_qb_total_epa_is_dropback_epa_only.
  "Total EPA":
    "Total Expected Points Added \u2014 the sum of EPA over one kind of play: dropbacks for quarterbacks (the same plays as EPA/DB, so designed runs aren\u2019t included), carries for running backs, targets for receivers. Volume-based: more plays = a bigger total, up or down. With the heatmap off, its colour follows the player\u2019s per-play rate.",
  TCH: "Total touches \u2014 carries + receptions. Measures overall involvement in the offense.",
  "TCH/G":
    "Touches per game \u2014 (carries + receptions) \u00f7 games played. Measures per-game workload.",
  // Box score page (spec §4 definitions). "EPA / play" and "Success rate" are
  // the team-level, nflfastR-style versions — the QB entries above exclude sacks.
  "EPA / play":
    "Expected points added per play: how much each snap moved the offense\u2019s expected points. Counts every run and dropback, the way nflfastR and rbsdm.com do.",
  "Success rate": "Share of plays that gained expected points (EPA above zero).",
  // The efficiency set filters on (pass | rush) + EPA present + a possessing
  // team and counts first_down == 1 (scripts/ingest.py, _team_game_efficiency).
  // There is NO no_play exclusion, and nflverse sets first_down for a penalty
  // first down too, so penalty-wiped plays and flag-awarded first downs are
  // both inside this rate. The page's own numbers say so: BUF 36% x 56 plays
  // = 20 = 13 passing + 5 rushing + 2 penalty. The Team stats "1st downs" row
  // applies the official box-score rule to a different set of plays (and
  // deliberately double-counts a run that also drew a flag, to match ESPN), so
  // rate x plays need not land on it: HOU is 32% x 79 = 25 against 26.
  "1st down rate":
    "Share of plays that gained a first down, over the same runs and dropbacks EPA/play counts \u2014 penalty-wiped plays included, so a first down the flag awarded counts here too. The Team stats \u201c1st downs\u201d row follows the official box-score rule over a different set of plays, so the two need not agree.",
  "Explosive plays":
    "Runs of 10+ yards and completions of 20+ yards. QB scrambles of 10+ yards count as explosive runs.",
  "Toxic differential":
    "Turnover margin plus explosive-play margin, using the explosive plays counted above.",
};

interface MetricTooltipProps {
  metric: string;
}

export default function MetricTooltip({ metric }: MetricTooltipProps) {
  const definition = METRIC_DEFINITIONS[metric];
  if (!definition) return null;

  return (
    <Tooltip>
      <TooltipTrigger
        className="relative inline-flex items-center justify-center w-6 h-6 ml-1 text-gray-400 hover:text-navy rounded-full border border-gray-300 text-[10px] font-bold leading-none align-middle after:content-[''] after:absolute after:-inset-2.5"
        aria-label={`What is ${metric}?`}
      >
        i
      </TooltipTrigger>
      <TooltipContent
        side="top"
        className="max-w-xs bg-gray-900 text-white text-xs leading-relaxed px-3 py-2 rounded-md"
      >
        <p className="font-semibold mb-1">{metric}</p>
        <p>{definition}</p>
      </TooltipContent>
    </Tooltip>
  );
}
