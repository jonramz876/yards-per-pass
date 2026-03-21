// Archetype classification based on radar chart percentile values
// Evaluated in priority order — first match wins
// Returns null if no archetype matches (no generic fallbacks)

export interface Archetype {
  label: string;
  icon: string;
  description: string;
  glossaryAnchor: string;
}

// QB axes: [Efficiency, Accuracy, Volume, Depth, BallSecurity, Consistency]
export function classifyQB(percentiles: number[]): Archetype | null {
  const [eff, acc, vol, depth, ballSec, cons] = percentiles;
  const above70 = percentiles.filter(p => p >= 70).length;
  const above60 = percentiles.filter(p => p >= 60).length;

  // Complete Passer — elite across 4+ axes
  if (above70 >= 4) return {
    label: "Complete Passer",
    icon: "\u{1F451}",
    description: "Elite across the board \u2014 efficiency, accuracy, and volume all in the upper tier.",
    glossaryAnchor: "complete-passer",
  };
  // Playmaker — high efficiency + volume + consistency, the engine of the offense
  if (eff >= 70 && vol >= 70 && cons >= 60) return {
    label: "Playmaker",
    icon: "\u{1F3C6}",
    description: "High-efficiency, high-volume quarterback who drives the offense through production and consistency.",
    glossaryAnchor: "playmaker",
  };
  // Gunslinger — pushes deep, takes risks
  if (depth >= 65 && vol >= 55 && ballSec <= 45) return {
    label: "Gunslinger",
    icon: "\u{1F52B}",
    description: "Pushes the ball downfield with aggression, trading turnovers for big plays.",
    glossaryAnchor: "gunslinger",
  };
  // Surgeon — precise and consistent
  if (acc >= 70 && cons >= 65 && eff >= 55) return {
    label: "Surgeon",
    icon: "\u{1FA78}",
    description: "Picks apart defenses with precision and consistency, rarely forcing throws.",
    glossaryAnchor: "surgeon",
  };
  // Distributor — high volume, high accuracy, short game
  if (vol >= 70 && acc >= 60 && depth <= 45) return {
    label: "Distributor",
    icon: "\u{1F4E1}",
    description: "High-volume, accurate passer who works the short-to-intermediate game.",
    glossaryAnchor: "distributor",
  };
  // Volume Passer — huge volume with solid efficiency
  if (vol >= 80 && eff >= 50) return {
    label: "Volume Passer",
    icon: "\u{1F4CA}",
    description: "Throws at an extremely high rate with enough efficiency to move the offense.",
    glossaryAnchor: "volume-passer",
  };
  // Game Manager — safe and steady
  if (cons >= 65 && ballSec >= 65 && vol <= 45) return {
    label: "Game Manager",
    icon: "\u{1F6E1}\uFE0F",
    description: "Protects the football and moves the chains, leaning on efficiency over explosiveness.",
    glossaryAnchor: "game-manager",
  };
  // Sniper — deep + safe, doesn't need high volume
  if (depth >= 65 && ballSec >= 65) return {
    label: "Sniper",
    icon: "\u{1F3AF}",
    description: "Accurate deep passer who protects the football \u2014 high aDOT with elite ball security.",
    glossaryAnchor: "sniper",
  };
  // Improviser — high efficiency with low accuracy (makes plays outside structure)
  if (eff >= 65 && above60 >= 3 && acc <= 50) return {
    label: "Improviser",
    icon: "\u{1F300}",
    description: "Creates plays outside of structure \u2014 high efficiency despite inconsistent accuracy.",
    glossaryAnchor: "improviser",
  };
  // No match
  return null;
}

// WR axes: [Volume, Efficiency, Catch, Downfield, AfterCatch, Consistency]
export function classifyWR(percentiles: number[]): Archetype | null {
  const [vol, eff, catch_, downfield, yac, cons] = percentiles;
  const above70 = percentiles.filter(p => p >= 70).length;
  const above60 = percentiles.filter(p => p >= 60).length;

  // Alpha WR1 — elite across the board
  if (above70 >= 4 && vol >= 65) return {
    label: "Alpha WR1",
    icon: "\u{2B50}",
    description: "Dominates target share and production \u2014 a true number-one receiver.",
    glossaryAnchor: "alpha-wr1",
  };
  // Contested Catch WR — wins downfield with reliable hands
  if (downfield >= 65 && catch_ >= 60) return {
    label: "Contested Catch WR",
    icon: "\u{1F91C}",
    description: "Wins downfield and at the catch point \u2014 high ADOT with a high catch rate.",
    glossaryAnchor: "contested-catch-wr",
  };
  // YAC Monster — elite after the catch
  if (yac >= 75 && downfield <= 50) return {
    label: "YAC Monster",
    icon: "\u26A1",
    description: "Dangerous after the catch, turning short throws into big gains.",
    glossaryAnchor: "yac-monster",
  };
  // Target Magnet — commands a huge target share (eff threshold low — volume dominance matters)
  if (vol >= 80) return {
    label: "Target Magnet",
    icon: "\u{1F9F2}",
    description: "Commands an elite target share \u2014 the offense runs through this receiver.",
    glossaryAnchor: "target-magnet",
  };
  // Field Stretcher — deep threat with low catch rate
  if (downfield >= 75 && catch_ <= 50) return {
    label: "Field Stretcher",
    icon: "\u{1F680}",
    description: "Stretches the field vertically, trading catch rate for chunk plays.",
    glossaryAnchor: "field-stretcher",
  };
  // Possession Receiver — reliable short-area target
  if (catch_ >= 70 && cons >= 60 && downfield <= 45) return {
    label: "Possession Receiver",
    icon: "\u{1F3AF}",
    description: "Reliable hands and route precision, converting targets at a high rate.",
    glossaryAnchor: "possession-receiver",
  };
  // Deep Threat — pure vertical
  if (downfield >= 80) return {
    label: "Deep Threat",
    icon: "\u{1F4A8}",
    description: "Pure vertical threat who lives on deep routes.",
    glossaryAnchor: "deep-threat",
  };
  // Efficient Producer — high YPRR/efficiency but lower volume
  if (cons >= 75 && eff >= 65 && vol <= 50) return {
    label: "Efficient Producer",
    icon: "\u{1F4B0}",
    description: "Maximizes every route run \u2014 elite efficiency without needing high volume.",
    glossaryAnchor: "efficient-producer",
  };
  // Playmaker WR — high efficiency + YAC combo
  if (eff >= 65 && yac >= 65 && above60 >= 3) return {
    label: "Playmaker",
    icon: "\u{1F3C6}",
    description: "Creates big plays through a combination of efficiency and after-catch ability.",
    glossaryAnchor: "playmaker-wr",
  };
  // No match
  return null;
}

// TE axes: same as WR [Volume, Efficiency, Catch, Downfield, AfterCatch, Consistency]
// but percentiles should be computed against TE-only pool (not WRs)
export function classifyTE(percentiles: number[]): Archetype | null {
  const [vol, eff, catch_, downfield, yac, cons] = percentiles;
  const above70 = percentiles.filter(p => p >= 70).length;

  // Elite TE1 — dominant across the board
  if (above70 >= 4 && vol >= 60) return {
    label: "Elite TE1",
    icon: "\u{1F48E}",
    description: "Dominant tight end \u2014 elite receiving production across volume, efficiency, and consistency.",
    glossaryAnchor: "elite-te1",
  };
  // Seam Stretcher — attacks downfield
  if (downfield >= 70 && eff >= 50) return {
    label: "Seam Stretcher",
    icon: "\u{1F680}",
    description: "Attacks downfield as a seam threat \u2014 high aDOT for a tight end, stretching the middle of the field.",
    glossaryAnchor: "seam-stretcher",
  };
  // YAC Weapon — dangerous after the catch
  if (yac >= 70 && downfield <= 55) return {
    label: "YAC Weapon",
    icon: "\u26A1",
    description: "Dangerous after the catch \u2014 turns short targets into chunk gains with run-after-catch ability.",
    glossaryAnchor: "yac-weapon-te",
  };
  // Security Blanket — reliable short-area target
  if (catch_ >= 70 && vol >= 55) return {
    label: "Security Blanket",
    icon: "\u{1F3AF}",
    description: "Reliable short-area target with a high catch rate \u2014 the QB\u2019s safety valve.",
    glossaryAnchor: "security-blanket",
  };
  // Move TE — deployed like a WR, high route participation
  if (cons >= 70 && eff >= 55 && vol >= 50) return {
    label: "Move TE",
    icon: "\u{1F504}",
    description: "Deployed like a wide receiver \u2014 high YPRR and consistent production as a pass catcher.",
    glossaryAnchor: "move-te",
  };
  // Target Hog — commands heavy target share at TE
  if (vol >= 80) return {
    label: "Target Hog",
    icon: "\u{1F9F2}",
    description: "Commands a massive target share for a tight end \u2014 the primary receiving option at the position.",
    glossaryAnchor: "target-hog-te",
  };
  // Blocking TE — low volume, likely a blocker who catches occasionally
  if (vol <= 25 && cons <= 35) return {
    label: "Blocking TE",
    icon: "\u{1F6E1}\uFE0F",
    description: "Primarily a blocker who catches the occasional pass \u2014 low target volume and route involvement.",
    glossaryAnchor: "blocking-te",
  };
  // No match
  return null;
}

// RB axes: [Volume, Efficiency, Power, Explosiveness, Receiving, Consistency]
export function classifyRB(percentiles: number[]): Archetype | null {
  const [vol, eff, power, explosive, rec, cons] = percentiles;
  const above55 = [eff, power, explosive, cons].filter(p => p >= 55).length;

  // Three-Down Back — does it all
  if (vol >= 55 && rec >= 60 && cons >= 55 && above55 >= 2) return {
    label: "Three-Down Back",
    icon: "\u{1F48E}",
    description: "Does it all \u2014 carries the load, catches passes, and stays on the field.",
    glossaryAnchor: "three-down-back",
  };
  // Elite Runner — elite across multiple rushing dimensions
  const rushAxesAbove70 = [eff, power, explosive, cons].filter(p => p >= 70).length;
  if (rushAxesAbove70 >= 3 && vol >= 55) return {
    label: "Elite Runner",
    icon: "\u{1F525}",
    description: "Elite across multiple rushing dimensions \u2014 efficiency, power, explosiveness, or consistency.",
    glossaryAnchor: "elite-runner-rb",
  };
  // Dual-Threat Back — high volume + receiving regardless of other axes
  if (vol >= 55 && rec >= 70) return {
    label: "Dual-Threat Back",
    icon: "\u{1F504}",
    description: "Dangerous as both a runner and receiver \u2014 a true two-way weapon out of the backfield.",
    glossaryAnchor: "dual-threat-back",
  };
  // Workhorse — high volume grinder
  if (vol >= 70 && eff >= 45 && rec <= 45) return {
    label: "Workhorse",
    icon: "\u{1F434}",
    description: "High-volume carrier who produces through sheer workload.",
    glossaryAnchor: "workhorse",
  };
  // Power Back — runs through contact
  if (power >= 70 && vol >= 50 && explosive <= 55) return {
    label: "Power Back",
    icon: "\u{1F4AA}",
    description: "Runs through contact and avoids getting stuffed, grinding for tough yards.",
    glossaryAnchor: "power-back",
  };
  // Home Run Hitter — boom or bust
  if (explosive >= 75 && cons <= 45) return {
    label: "Home Run Hitter",
    icon: "\u{1F4A5}",
    description: "Boom-or-bust runner who trades consistency for explosive chunk plays.",
    glossaryAnchor: "home-run-hitter",
  };
  // Pass-Catching Back — receiving weapon
  if (rec >= 75 && vol <= 50) return {
    label: "Pass-Catching Back",
    icon: "\u{1F91D}",
    description: "Creates receiving value out of the backfield, a weapon in the passing game.",
    glossaryAnchor: "pass-catching-back",
  };
  // Efficient Runner — high EPA without huge volume
  if (eff >= 70 && cons >= 60 && vol <= 55) return {
    label: "Efficient Runner",
    icon: "\u{2705}",
    description: "Maximizes efficiency on limited carries \u2014 high EPA/carry with solid consistency.",
    glossaryAnchor: "efficient-runner",
  };
  // Change of Pace — explosive spark off the bench
  if (eff >= 65 && explosive >= 60 && vol <= 40) return {
    label: "Change of Pace",
    icon: "\u{1F3C3}",
    description: "Maximizes limited touches with efficiency and explosiveness off the bench.",
    glossaryAnchor: "change-of-pace",
  };
  // Bell Cow — sheer volume dominance
  if (vol >= 85) return {
    label: "Bell Cow",
    icon: "\u{1F402}",
    description: "Dominates touches in the backfield \u2014 the clear lead back regardless of efficiency.",
    glossaryAnchor: "bell-cow",
  };
  // No match
  return null;
}
