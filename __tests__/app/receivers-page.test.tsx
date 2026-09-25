// Spec A review I1: /receivers remounts its board when the season changes.
// SeasonSelect router.pushes the same route with a new ?season=, and Next 14
// reuses the client component across a search-param change, so without a key
// the board keeps the old season's useState: its sort (2025 -> 2026 on the
// Efficiency tab stays on the empty YPRR column) and its qualifier minimum.
import { describe, it, expect, vi } from "vitest";
import type { ReactElement } from "react";

vi.mock("@/lib/data/queries", () => ({
  getAvailableSeasons: vi.fn(async () => [2026, 2025]),
  getDataFreshness: vi.fn(async (s: number) => ({ season: s, through_week: s === 2026 ? 2 : 18, last_updated: "" })),
  fallbackSeason: () => 2026,
}));
vi.mock("@/lib/data/receivers", () => ({ getReceiverStats: vi.fn(async () => []) }));
vi.mock("@/lib/data/players", () => ({ getAllPlayerSlugs: vi.fn(async () => []) }));

import ReceiversPage from "@/app/receivers/page";
import ReceiverLeaderboard from "@/components/tables/ReceiverLeaderboard";

async function board(season?: string): Promise<ReactElement> {
  const page = (await ReceiversPage({ searchParams: Promise.resolve(season ? { season } : {}) })) as ReactElement<{
    children: ReactElement;
  }>;
  const child = page.props.children;
  expect(child.type).toBe(ReceiverLeaderboard);
  return child;
}

describe("/receivers", () => {
  it("keys the board by season, so choosing another season remounts it", async () => {
    expect((await board("2025")).key).toBe("2025");
    expect((await board("2026")).key).toBe("2026");
    expect((await board()).key).toBe("2026");
  });
});
