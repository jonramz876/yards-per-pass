// components/ui/MetricTooltip.tsx
"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

const METRIC_DEFINITIONS: Record<string, string> = {
  "EPA/Play":
    "Points added per play \u2014 the best single measure of QB impact. Covers passing and rushing. Above 0 = above average.",
  "EPA/DB":
    "Points added per dropback (pass attempts + sacks + scrambles). Passing-only version of EPA \u2014 isolates arm talent from running ability.",
  CPOE: "How often a QB completes passes vs. what\u2019s expected given throw difficulty. +3 means completing 3% more than expected. Higher is better.",
  "Comp%":
    "Completions \u00f7 attempts. The raw completion rate \u2014 doesn\u2019t account for throw difficulty like CPOE does.",
  "Success%":
    "How often a QB\u2019s plays gain enough yards to stay on schedule. Sacks excluded (OL failure, not QB). Team-level success rate on the scatter plot includes sacks.",
  Sk: "Sacks taken. Counts against EPA/DB \u2014 a QB who holds the ball too long will see this drag down efficiency.",
  "Rush Att":
    "Rush attempts: designed runs + scrambles, excluding kneels. PFR includes kneels, so numbers may differ slightly.",
  "Rush EPA":
    "Points added per rush attempt. Measures a QB\u2019s value as a runner. Positive = above-average rushing.",
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
  "EPA/Tgt":
    "Points added per target. The best single efficiency measure for receivers. Above 0 = above average.",
  "Catch%":
    "Receptions \u00f7 targets. How often a receiver catches the ball when targeted.",
  ADOT: "Average Depth of Target \u2014 how far downfield a receiver is targeted on average. Higher = more of a deep threat.",
  "YAC/Rec":
    "Yards after catch per reception. Measures a receiver\u2019s ability to gain yards with the ball in their hands.",
  "Tgt Share":
    "Percentage of team pass attempts directed at this receiver. Higher = more involved in the passing game.",
  YPR: "Yards per reception. Total receiving yards \u00f7 receptions. A simple per-catch efficiency measure.",
  YPRR: "Yards Per Route Run \u2014 receiving yards divided by routes run. Measures how productive a receiver is on every route, not just when targeted.",
  TPRR: "Targets Per Route Run \u2014 targets divided by routes run. Measures how often a receiver gets targeted on each route they run.",
  Snaps: "Total offensive plays the player was on the field. Derived from play-by-play participation data.",
  "Snap%": "Percentage of team\u2019s offensive plays the player was on the field. 100% means every snap.",
  "Route%": "How often the player runs a route when on the field. High = pure pass catcher, low = run blocker. WRs are typically 80\u201395%, blocking TEs can be 40\u201360%.",
  "EPA/Car":
    "Points added per carry. The best single efficiency measure for rushers. Above 0 = above average.",
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
  "Recv SR%":
    "Receiving Success Rate \u2014 percentage of targets that produce positive EPA. Measures how often a receiver\u2019s plays move the chains.",
  "Total EPA":
    "Total Expected Points Added \u2014 the raw sum of EPA across all plays. Volume-based: more plays = higher total. Measures overall impact, not per-play efficiency.",
  TCH: "Total touches \u2014 carries + receptions. Measures overall involvement in the offense.",
  "TCH/G":
    "Touches per game \u2014 (carries + receptions) \u00f7 games played. Measures per-game workload.",
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
