import { describe, it, expect, beforeEach, vi } from "vitest";

const order = vi.fn();
const createServerClient = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createServerClient: () => createServerClient(),
}));

import { GET, revalidate } from "@/app/api/health/route";

const ROWS = [
  { season: 2026, through_week: 2, last_updated: "2026-09-24T16:00:00+00:00" },
  { season: 2025, through_week: 18, last_updated: "2026-02-10T12:00:00+00:00" },
];

beforeEach(() => {
  order.mockReset();
  createServerClient.mockReset();
  createServerClient.mockReturnValue({ from: () => ({ select: () => ({ order }) }) });
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

  // Read resilience spec §1.2: 503 (the database is unavailable, try later),
  // never stored by a cache. The refresh workflow's health gate (spec §2.2(e))
  // will read this status to decide whether to purge.
  it("returns 503, no-store, on a query error", async () => {
    order.mockResolvedValue({ data: null, error: { message: "TimeoutError: The operation was aborted due to timeout" } });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({
      status: "error",
      message: "TimeoutError: The operation was aborted due to timeout",
    });
  });

  it("returns 503, no-store, when the client itself throws (missing env vars)", async () => {
    createServerClient.mockImplementation(() => {
      throw new Error("Missing Supabase env vars.");
    });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "error", message: "Missing Supabase env vars." });
  });

  it("returns 503 when the read rejects with something that is not an Error", async () => {
    order.mockRejectedValue("socket hang up");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "error", message: "socket hang up" });
  });
});
