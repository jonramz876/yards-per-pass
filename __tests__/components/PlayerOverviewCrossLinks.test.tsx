// Spec A §4.8 (T8): the player-page team boxes say what their numbers are.
// "Catches From" printed the team QB's whole-season passing line under a
// receiver (Flowers: Lamar's 559 yards, not the 150 Flowers caught); "Throws
// To" printed each receiver's season from every QB. lib/data/players.ts has no
// passer-to-receiver pairs, so the boxes are relabelled, not recomputed.
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import PlayerOverviewWR from "@/components/player/PlayerOverviewWR";
import PlayerOverviewQB from "@/components/player/PlayerOverviewQB";
import type { QBSeasonStat, ReceiverSeasonStat } from "@/lib/types";
import wrPool from "../stats/fixtures/wr-te-2025-pool.json";
import qbPool from "../stats/fixtures/qb-2025-pool.json";

const RECEIVERS = (wrPool as { rows: unknown[] }).rows as ReceiverSeasonStat[];
const QBS = qbPool as unknown as QBSeasonStat[];

describe("PlayerOverviewWR team box", () => {
  it("is 'Team QB' with a labelled season passing line", () => {
    const wr = RECEIVERS.find((r) => r.position === "WR")!;
    const { container } = render(
      <PlayerOverviewWR
        stats={wr}
        allReceivers={RECEIVERS}
        season={2026}
        teamId="BAL"
        teamQBData={{ player_id: "00-0034796", player_name: "L.Jackson", slug: "lamar-jackson", dropbacks: 70, passing_yards: 559, touchdowns: 2 }}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Team QB");
    expect(text).toContain("559 pass yds · 2 pass TD in 2026, all teams");
    expect(text).not.toContain("Catches From");
    expect(text).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });
});

describe("PlayerOverviewQB team box", () => {
  it("is 'Team’s Top Receivers'", () => {
    const qb = QBS.find((q) => q.attempts > 300)!;
    const { container } = render(
      <PlayerOverviewQB
        stats={qb}
        allQBs={QBS}
        season={2025}
        teamId="CIN"
        topReceivers={[
          { player_id: "00-0036900", player_name: "J.Chase", slug: "jamarr-chase", targets: 185, receptions: 125, receiving_yards: 1412, receiving_tds: 8 },
        ]}
      />,
    );
    const text = container.textContent ?? "";
    expect(text).toContain("Team’s Top Receivers");
    expect(text).toContain("185 tgt · 1412 yds · 8 TD");
    expect(text).not.toContain("Throws To");
    expect(text).not.toMatch(/\\u[0-9a-fA-F]{4}/);
  });
});
