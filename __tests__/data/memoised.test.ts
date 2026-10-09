import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// `memoised` (lib/data/team-radar-card.ts): the promise memo behind the team
// radar image route and the comparison card. Compare card PR 2, chaos COST-2:
// a failed read used to be forgotten at once, so during a fast-failing outage
// every image request was a new database request, at the visitor's (or a
// crawler's) rate. A rejection is now kept for ten seconds: never as a
// success, and the next read after that window can succeed again.
vi.mock("@/lib/supabase/server", () => ({ hasNoDatabase: () => false }));

import { memoised, MEMO_FAILURE_TTL_MS, TEAM_RADAR_MEMO_TTL_MS } from "@/lib/data/team-radar-card";

type Entry<T> = { at: number; promise: Promise<T> };
const T0 = new Date("2026-10-09T12:00:00Z").getTime();
const at = (ms: number) => vi.setSystemTime(new Date(T0 + ms));
const FAILED = new Error("Failed to fetch seasons: upstream 500");

let store: Map<string, Entry<string>>;
beforeEach(() => {
  store = new Map();
  vi.useFakeTimers();
  at(0);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("memoised: a failed read is kept for ten seconds", () => {
  it("the windows: a minute for an answer, ten seconds for a failure", () => {
    expect(TEAM_RADAR_MEMO_TTL_MS).toBe(60_000);
    expect(MEMO_FAILURE_TTL_MS).toBe(10_000);
  });

  it("20 requests during a fast-failing outage are ONE read, and every one of them gets the failure", async () => {
    const read = vi.fn(async () => { throw FAILED; });
    for (let i = 0; i < 20; i++) {
      at(i * 400); // 20 requests over 8 seconds
      await expect(memoised(store, "seasons", read)).rejects.toBe(FAILED);
    }
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("it is never kept as a success, and it recovers within ten seconds of the failure", async () => {
    const read = vi.fn<() => Promise<string>>().mockRejectedValueOnce(FAILED).mockResolvedValue("rows");
    await expect(memoised(store, "k", read)).rejects.toBe(FAILED);
    at(9_999);
    await expect(memoised(store, "k", read)).rejects.toBe(FAILED);
    expect(read).toHaveBeenCalledTimes(1);
    at(10_000);
    await expect(memoised(store, "k", read)).resolves.toBe("rows");
    expect(read).toHaveBeenCalledTimes(2);
    // And the answer is then kept for its own minute.
    at(69_999);
    await expect(memoised(store, "k", read)).resolves.toBe("rows");
    expect(read).toHaveBeenCalledTimes(2);
    at(70_000);
    await memoised(store, "k", read);
    expect(read).toHaveBeenCalledTimes(3);
  });

  it("the ten seconds count from the moment the read FAILED, not from when it started (a 5 s timeout still gets a full window)", async () => {
    let fail: (e: Error) => void = () => {};
    const read = vi.fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise<string>((_, reject) => { fail = reject; }))
      .mockResolvedValue("rows");
    const first = memoised(store, "k", read);
    at(5_000);
    fail(FAILED);
    await expect(first).rejects.toBe(FAILED);
    at(14_999);
    await expect(memoised(store, "k", read)).rejects.toBe(FAILED);
    expect(read).toHaveBeenCalledTimes(1);
    at(15_000);
    await expect(memoised(store, "k", read)).resolves.toBe("rows");
  });

  it("an outage that goes on: one read every ten seconds, not one per request", async () => {
    const read = vi.fn(async () => { throw FAILED; });
    for (let ms = 0; ms < 60_000; ms += 250) {
      at(ms);
      await memoised(store, "k", read).catch(() => {});
    }
    expect(read).toHaveBeenCalledTimes(6);
  });

  it("requests that arrive while the read is in flight share it, whether it ends well or badly", async () => {
    let fail: (e: Error) => void = () => {};
    const read = vi.fn(() => new Promise<string>((_, reject) => { fail = reject; }));
    const all = [memoised(store, "k", read), memoised(store, "k", read), memoised(store, "k", read)];
    fail(FAILED);
    expect((await Promise.allSettled(all)).map((r) => r.status)).toEqual(["rejected", "rejected", "rejected"]);
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("a read that throws before it returns a promise is a failure like any other: a rejection, kept ten seconds", async () => {
    const read = vi.fn<() => Promise<string>>()
      .mockImplementationOnce(() => { throw FAILED; })
      .mockResolvedValue("rows");
    await expect(memoised(store, "k", read)).rejects.toBe(FAILED);
    at(5_000);
    await expect(memoised(store, "k", read)).rejects.toBe(FAILED);
    expect(read).toHaveBeenCalledTimes(1);
    at(10_000);
    await expect(memoised(store, "k", read)).resolves.toBe("rows");
  });

  it("each key fails on its own: one failing table does not hold back the others", async () => {
    const bad = vi.fn(async () => { throw FAILED; });
    const good = vi.fn(async () => "rows");
    await expect(memoised(store, "QB:2026", bad)).rejects.toBe(FAILED);
    await expect(memoised(store, "WR:2026", good)).resolves.toBe("rows");
    await expect(memoised(store, "QB:2026", good)).rejects.toBe(FAILED);
  });

  it("a kept failure raises no unhandled rejection", async () => {
    const seen: unknown[] = [];
    const onUnhandled = (e: unknown) => seen.push(e);
    process.on("unhandledRejection", onUnhandled);
    try {
      await memoised(store, "k", async () => { throw FAILED; }).catch(() => {});
      await vi.advanceTimersByTimeAsync(11_000);
      await Promise.resolve();
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(seen).toEqual([]);
  });
});
