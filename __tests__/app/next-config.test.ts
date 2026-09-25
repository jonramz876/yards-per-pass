import { describe, it, expect } from "vitest";
import nextConfig from "@/next.config.mjs";

describe("next.config redirects", () => {
  it("sends www to the apex with a permanent redirect, path and query carried over", async () => {
    const rules = await nextConfig.redirects?.();
    expect(rules).toEqual([
      {
        source: "/:path*",
        has: [{ type: "host", value: "www.yardsperpass.com" }],
        destination: "https://yardsperpass.com/:path*",
        permanent: true,
      },
    ]);
  });

  it("cannot loop: the destination host is not the matched host", async () => {
    const rules = (await nextConfig.redirects?.()) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      const destHost = new URL(rule.destination.replace(":path*", "")).host;
      for (const cond of rule.has ?? []) {
        if (cond.type === "host") expect(destHost).not.toBe(cond.value);
      }
    }
  });
});
