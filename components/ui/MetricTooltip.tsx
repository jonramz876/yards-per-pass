// components/ui/MetricTooltip.tsx
"use client";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

const METRIC_DEFINITIONS: Record<string, string> = {
  "EPA/Play":
    "Expected Points Added per play across ALL plays (passing + rushing). The most complete measure of a QB's total value. Above 0 is good.",
  "EPA/DB":
    "EPA per dropback \u2014 passing plays only (attempts + sacks + scrambles). Isolates passing efficiency without rushing. Useful for comparing pure passers.",
  CPOE: "Completion Percentage Over Expected. How often a QB completes passes compared to what's expected given the difficulty. Higher is better.",
  "Comp%":
    "Completion percentage \u2014 completions divided by pass attempts. The baseline that makes CPOE meaningful.",
  "Success%":
    "Percentage of non-sack dropbacks that are successful (gained enough yards for the situation). Sacks excluded because they reflect OL failure, not QB decision-making.",
  Sk: "Sacks taken. Included in EPA/DB denominator \u2014 a QB who takes many sacks will have lower dropback EPA even if their completions are efficient.",
  "Rush Att":
    "Designed rush attempts (not scrambles \u2014 those are counted in dropbacks). Shows how often a QB runs by design.",
  aDOT: "Average Depth of Target. How far downfield a QB throws on average. Higher = more aggressive.",
  YPA: "Yards Per Attempt. Total passing yards divided by pass attempts (sacks excluded from denominator).",
  "ANY/A":
    "Adjusted Net Yards per Attempt. (Yards + 20\u00d7TD \u2212 45\u00d7INT) \u00f7 (Attempts + Sacks). The best single traditional stat for predicting wins.",
  Rating:
    "Traditional NFL passer rating (scale 0\u2013158.3). Combines completion %, yards, TDs, and INTs. The most familiar QB stat for casual fans, though EPA-based metrics are more predictive.",
  "Off EPA/Play":
    "Offensive EPA per play \u2014 how efficiently a team's offense generates expected points.",
  "Def EPA/Play":
    "Defensive EPA per play \u2014 how well a defense limits the opponent's expected points. Lower (more negative) is better.",
};

interface MetricTooltipProps {
  metric: string;
}

export default function MetricTooltip({ metric }: MetricTooltipProps) {
  const definition = METRIC_DEFINITIONS[metric];
  if (!definition) return null;

  return (
    <Popover>
      <PopoverTrigger
        className="inline-flex items-center justify-center w-4 h-4 ml-1 text-gray-400 hover:text-navy rounded-full border border-gray-300 text-[10px] font-bold leading-none align-middle"
        aria-label={`What is ${metric}?`}
      >
        i
      </PopoverTrigger>
      <PopoverContent
        className="w-72 text-sm text-gray-600 leading-relaxed"
        side="top"
      >
        <p className="font-semibold text-navy mb-1">{metric}</p>
        <p>{definition}</p>
      </PopoverContent>
    </Popover>
  );
}
