import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { POST } from "@/app/api/revalidate/route";
import { revalidatePath } from "next/cache";

const post = (secret?: string) =>
  POST({
    headers: { get: (k: string) => (k === "x-revalidate-secret" ? (secret ?? null) : null) },
  } as unknown as Parameters<typeof POST>[0]);

beforeEach(() => {
  vi.mocked(revalidatePath).mockReset();
  process.env.REVALIDATE_SECRET = "s3cret";
});

describe("/api/revalidate", () => {
  it("refreshes /game after an ingest, alongside the other detail routes", async () => {
    const res = await post("s3cret");
    expect(res.status).toBe(200);
    const paths = vi.mocked(revalidatePath).mock.calls;
    // The box score page is generated on demand at revalidate = 3600; this is
    // what turns a "stats arrive" page into a real box score after an ingest.
    expect(paths).toContainEqual(["/game", "layout"]);
    expect(paths).toContainEqual(["/team", "layout"]);
    expect(paths).toContainEqual(["/player", "layout"]);
    expect(paths).toContainEqual(["/card", "layout"]);
  });

  it("revalidates nothing without the secret", async () => {
    const res = await post("wrong");
    expect(res.status).toBe(401);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
