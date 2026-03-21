// Archetype classification based on radar chart percentile values
// Evaluated in priority order — first match wins

export interface Archetype {
  label: string;
  icon: string; // emoji icon for leaderboard display
  description: string;
  glossaryAnchor: string; // for linking to glossary
}

// Percentile values are 0-100, matching radar chart axes order

// QB axes: [Efficiency, Accuracy, Volume, Depth, BallSecurity, Consistency]
export function classifyQB(percentiles: number[]): Archetype {
  const [eff, acc, vol, depth, ballSec, cons] = percentiles;
  const above70 = percentiles.filter(p => p >= 70).length;

  if (above70 >= 4) return {
    label: "Complete Passer",
    icon: "\u{1F451}", // crown
    description: "Elite across the board \u2014 efficiency, accuracy, and volume all in the upper tier.",
    glossaryAnchor: "complete-passer",
  };
  if (depth >= 75 && vol >= 60 && ballSec <= 40) return {
    label: "Gunslinger",
    icon: "\u{1F52B}", // gun
    description: "Pushes the ball downfield with volume and aggression, trading turnovers for big plays.",
    glossaryAnchor: "gunslinger",
  };
  if (acc >= 75 && cons >= 70 && eff >= 60) return {
    label: "Surgeon",
    icon: "\u{1FA78}", // scalpel
    description: "Picks apart defenses with precision and consistency, rarely forcing throws.",
    glossaryAnchor: "surgeon",
  };
  if (vol >= 70 && acc >= 65 && depth <= 45) return {
    label: "Distributor",
    icon: "\u{1F4E1}", // satellite antenna
    description: "High-volume, high-accuracy passer who works the short-to-intermediate game.",
    glossaryAnchor: "distributor",
  };
  if (cons >= 70 && ballSec >= 70 && vol <= 40) return {
    label: "Game Manager",
    icon: "\u{1F6E1}\uFE0F", // shield
    description: "Protects the football and moves the chains, leaning on efficiency over explosiveness.",
    glossaryAnchor: "game-manager",
  };
  return {
    label: "Versatile Passer",
    icon: "\u{1F504}", // arrows cycle
    description: "Shows a balanced skill set without a single dominant trait.",
    glossaryAnchor: "versatile-passer",
  };
}

// WR axes: [Volume, Efficiency, Catch, Downfield, AfterCatch, Consistency]
export function classifyWR(percentiles: number[]): Archetype {
  const [vol, _eff, catch_, downfield, yac, cons] = percentiles;
  void _eff; // used indirectly via above70 filter
  const above70 = percentiles.filter(p => p >= 70).length;

  if (above70 >= 4 && vol >= 70) return {
    label: "Alpha WR1",
    icon: "\u{2B50}", // star
    description: "Dominates target share and production \u2014 a true number-one receiver.",
    glossaryAnchor: "alpha-wr1",
  };
  if (downfield >= 70 && catch_ >= 65) return {
    label: "Contested Catch WR",
    icon: "\u{1F91C}", // fist
    description: "Wins downfield and at the catch point \u2014 high ADOT with a high catch rate.",
    glossaryAnchor: "contested-catch-wr",
  };
  if (yac >= 80 && downfield <= 45) return {
    label: "YAC Monster",
    icon: "\u26A1", // lightning
    description: "Dangerous after the catch, turning short throws into big gains.",
    glossaryAnchor: "yac-monster",
  };
  if (downfield >= 80 && catch_ <= 45) return {
    label: "Field Stretcher",
    icon: "\u{1F680}", // rocket
    description: "Wins deep and stretches the field vertically, trading catch rate for chunk plays.",
    glossaryAnchor: "field-stretcher",
  };
  if (catch_ >= 75 && cons >= 65 && downfield <= 40) return {
    label: "Possession Receiver",
    icon: "\u{1F3AF}", // bullseye
    description: "Reliable hands and route precision, converting targets at a high rate.",
    glossaryAnchor: "possession-receiver",
  };
  if (downfield >= 85) return {
    label: "Deep Threat",
    icon: "\u{1F4A8}", // dash/wind
    description: "Pure vertical threat who lives on deep routes.",
    glossaryAnchor: "deep-threat",
  };
  return {
    label: "Balanced Receiver",
    icon: "\u{2696}\uFE0F", // scales
    description: "Versatile skill set across routes, catches, and production.",
    glossaryAnchor: "balanced-receiver",
  };
}

// RB axes: [Volume, Efficiency, Power, Explosiveness, Receiving, Consistency]
export function classifyRB(percentiles: number[]): Archetype {
  const [vol, eff, power, explosive, rec, cons] = percentiles;
  const above55 = [eff, power, explosive, cons].filter(p => p >= 55).length;

  if (vol >= 60 && rec >= 65 && cons >= 60 && above55 >= 1) return {
    label: "Three-Down Back",
    icon: "\u{1F48E}", // gem
    description: "Does it all \u2014 carries the load, catches passes, and stays on the field.",
    glossaryAnchor: "three-down-back",
  };
  if (vol >= 75 && eff >= 50 && rec <= 40) return {
    label: "Workhorse",
    icon: "\u{1F434}", // horse
    description: "High-volume carrier who produces through sheer workload and steady efficiency.",
    glossaryAnchor: "workhorse",
  };
  if (power >= 75 && vol >= 55 && explosive <= 50) return {
    label: "Power Back",
    icon: "\u{1F4AA}", // flexed bicep
    description: "Runs through contact and avoids getting stuffed, grinding for tough yards.",
    glossaryAnchor: "power-back",
  };
  if (explosive >= 80 && cons <= 40) return {
    label: "Home Run Hitter",
    icon: "\u{1F4A5}", // boom/explosion
    description: "Boom-or-bust runner who trades consistency for explosive chunk plays.",
    glossaryAnchor: "home-run-hitter",
  };
  if (rec >= 80 && vol <= 45) return {
    label: "Pass-Catching Back",
    icon: "\u{1F91D}", // handshake
    description: "Creates receiving value out of the backfield, a weapon in the passing game.",
    glossaryAnchor: "pass-catching-back",
  };
  if (eff >= 70 && explosive >= 65 && vol <= 35) return {
    label: "Change of Pace",
    icon: "\u{1F3C3}", // runner
    description: "Maximizes limited touches with efficiency and explosiveness off the bench.",
    glossaryAnchor: "change-of-pace",
  };
  return {
    label: "Well-Rounded Runner",
    icon: "\u{1F504}", // arrows cycle
    description: "Balanced across volume, efficiency, and style without a standout trait.",
    glossaryAnchor: "well-rounded-runner",
  };
}
