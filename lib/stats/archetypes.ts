// Archetype classification based on radar chart percentile values
// Evaluated in priority order — first match wins

export interface Archetype {
  label: string;
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
    description: "Elite across the board — efficiency, accuracy, and volume all in the upper tier.",
    glossaryAnchor: "complete-passer",
  };
  if (depth >= 75 && vol >= 60 && ballSec <= 40) return {
    label: "Gunslinger",
    description: "Pushes the ball downfield with volume and aggression, trading turnovers for big plays.",
    glossaryAnchor: "gunslinger",
  };
  if (acc >= 75 && cons >= 70 && eff >= 60) return {
    label: "Surgeon",
    description: "Picks apart defenses with precision and consistency, rarely forcing throws.",
    glossaryAnchor: "surgeon",
  };
  if (vol >= 70 && acc >= 65 && depth <= 45) return {
    label: "Distributor",
    description: "High-volume, high-accuracy passer who works the short-to-intermediate game.",
    glossaryAnchor: "distributor",
  };
  if (cons >= 70 && ballSec >= 70 && vol <= 40) return {
    label: "Game Manager",
    description: "Protects the football and moves the chains, leaning on efficiency over explosiveness.",
    glossaryAnchor: "game-manager",
  };
  return {
    label: "Versatile Passer",
    description: "Shows a balanced skill set without a single dominant trait.",
    glossaryAnchor: "versatile-passer",
  };
}

// WR axes: [Volume, Efficiency, Catch, Downfield, AfterCatch, Consistency]
export function classifyWR(percentiles: number[]): Archetype {
  const [vol, eff, catch_, downfield, yac, cons] = percentiles;
  const above70 = percentiles.filter(p => p >= 70).length;

  if (above70 >= 4 && vol >= 70) return {
    label: "Alpha WR1",
    description: "Dominates target share and production — a true number-one receiver.",
    glossaryAnchor: "alpha-wr1",
  };
  if (downfield >= 70 && catch_ >= 65) return {
    label: "Contested Catch WR",
    description: "Wins downfield and at the catch point — high ADOT with a high catch rate.",
    glossaryAnchor: "contested-catch-wr",
  };
  if (yac >= 80 && downfield <= 45) return {
    label: "YAC Monster",
    description: "Dangerous after the catch, turning short throws into big gains.",
    glossaryAnchor: "yac-monster",
  };
  if (downfield >= 80 && catch_ <= 45) return {
    label: "Field Stretcher",
    description: "Wins deep and stretches the field vertically, trading catch rate for chunk plays.",
    glossaryAnchor: "field-stretcher",
  };
  if (catch_ >= 75 && cons >= 65 && downfield <= 40) return {
    label: "Possession Receiver",
    description: "Reliable hands and route precision, converting targets at a high rate.",
    glossaryAnchor: "possession-receiver",
  };
  if (downfield >= 85) return {
    label: "Deep Threat",
    description: "Pure vertical threat who lives on deep routes.",
    glossaryAnchor: "deep-threat",
  };
  return {
    label: "Balanced Receiver",
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
    description: "Does it all — carries the load, catches passes, and stays on the field.",
    glossaryAnchor: "three-down-back",
  };
  if (vol >= 75 && eff >= 50 && rec <= 40) return {
    label: "Workhorse",
    description: "High-volume carrier who produces through sheer workload and steady efficiency.",
    glossaryAnchor: "workhorse",
  };
  if (power >= 75 && vol >= 55 && explosive <= 50) return {
    label: "Power Back",
    description: "Runs through contact and avoids getting stuffed, grinding for tough yards.",
    glossaryAnchor: "power-back",
  };
  if (explosive >= 80 && cons <= 40) return {
    label: "Home Run Hitter",
    description: "Boom-or-bust runner who trades consistency for explosive chunk plays.",
    glossaryAnchor: "home-run-hitter",
  };
  if (rec >= 80 && vol <= 45) return {
    label: "Pass-Catching Back",
    description: "Creates receiving value out of the backfield, a weapon in the passing game.",
    glossaryAnchor: "pass-catching-back",
  };
  if (eff >= 70 && explosive >= 65 && vol <= 35) return {
    label: "Change of Pace",
    description: "Maximizes limited touches with efficiency and explosiveness off the bench.",
    glossaryAnchor: "change-of-pace",
  };
  return {
    label: "Well-Rounded Runner",
    description: "Balanced across volume, efficiency, and style without a standout trait.",
    glossaryAnchor: "well-rounded-runner",
  };
}
