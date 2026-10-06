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

  // Chaos K2: JSON.stringify dropped an undefined message, so the body was
  // just {"status":"error"}.
  it("the error body always has a message string, even when the upstream error has none", async () => {
    for (const error of [{}, { code: "PGRST301", details: "JWT expired" }, { message: null }, { message: 42 }]) {
      order.mockResolvedValue({ data: null, error, status: 401 });
      const res = await GET();
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.status).toBe("error");
      expect(typeof body.message).toBe("string");
      expect(body.message.length).toBeGreaterThan(0);
      expect(body.message).not.toContain("undefined");
    }
    order.mockResolvedValue({ data: null, error: { code: "PGRST301", details: "JWT expired" } });
    expect((await (await GET()).json()).message).toContain("PGRST301");
  });

  // Chaos K3: an upstream HTML error page was echoed whole (8 KB) to any caller.
  it("an 8 KB upstream HTML error page is answered with one short sentence, not the page", async () => {
    const html =
      "<!DOCTYPE html><html><head><title>yardsperpass.supabase.co | 522: Connection timed out</title></head><body>" +
      "<script>alert('xss')</script>" +
      "<p>filler</p>".repeat(700) +
      "</body></html>";
    expect(html.length).toBeGreaterThan(8000);
    order.mockResolvedValue({ data: null, error: { message: html }, status: 522 });
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const text = await res.text();
    expect(text.length).toBeLessThan(400);
    expect(text).not.toContain("<script>");
    expect(JSON.parse(text)).toEqual({
      status: "error",
      message:
        "upstream returned an HTML error page (HTTP 522, yardsperpass.supabase.co | 522: Connection timed out)",
    });
  });

  it("a long plain-text upstream error is cut at 300 characters", async () => {
    order.mockResolvedValue({ data: null, error: { message: "x".repeat(5000) }, status: 500 });
    const body = await (await GET()).json();
    expect(body.message).toBe(`${"x".repeat(300)}... (4700 more characters)`);
  });

  it("returns 503 when the read rejects with something that is not an Error", async () => {
    order.mockRejectedValue("socket hang up");
    const res = await GET();
    expect(res.status).toBe(503);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(await res.json()).toEqual({ status: "error", message: "socket hang up" });
  });
});
