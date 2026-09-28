import { describe, it, expect, beforeEach, vi } from "vitest";

const order = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({
    from: () => ({ select: () => ({ order }) }),
  }),
}));

import { GET, revalidate } from "@/app/api/health/route";

const ROWS = [
  { season: 2026, through_week: 2, last_updated: "2026-09-24T16:00:00+00:00" },
  { season: 2025, through_week: 18, last_updated: "2026-02-10T12:00:00+00:00" },
];

beforeEach(() => {
  order.mockReset();
});

describe("/api/health", () => {
  it("always reads the database (revalidate = 0), so the answer is never a frozen copy", () => {
    expect(revalidate).toBe(0);
  });

  it("returns 200 with the freshness rows", async () => {
    order.mockResolvedValue({ data: ROWS, error: null });
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.freshness).toEqual(ROWS);
    expect(typeof body.timestamp).toBe("string");
  });

  it("returns 500 on a query error", async () => {
    order.mockResolvedValue({ data: null, error: { message: "boom" } });
    const res = await GET();
    expect(res.status).toBe(500);
    expect((await res.json()).status).toBe("error");
  });
});
