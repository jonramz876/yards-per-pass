import { describe, it, expect, afterEach, vi } from "vitest";
import { hasNoDatabase } from "@/lib/supabase/server";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("hasNoDatabase", () => {
  it("is true for the CI placeholder URL (any case, trailing slash) and for no URL", () => {
    for (const url of ["https://placeholder.supabase.co", "HTTPS://PLACEHOLDER.SUPABASE.CO/", " https://placeholder.supabase.co ", ""]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(hasNoDatabase(), url).toBe(true);
    }
  });

  it("is false for a real project URL and for look-alikes", () => {
    for (const url of ["https://abcdefghijklmnop.supabase.co", "https://notplaceholder.supabase.co", "https://placeholder.supabase.co.example.com", "https://abc.supabase.co/?placeholder"]) {
      vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
      expect(hasNoDatabase(), url).toBe(false);
    }
  });
});
