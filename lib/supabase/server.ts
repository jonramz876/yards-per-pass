// lib/supabase/server.ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function createServerClient(): SupabaseClient {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing Supabase env vars. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local"
    );
  }
  client = createClient(url, key);
  return client;
}

/**
 * True when there is no real database behind the Supabase env vars: the fake
 * URL that .github/workflows/ci.yml (and the local build command in
 * memory/MEMORY.md) passes to `next build`, or no URL at all. Only then is an
 * empty page the right render (the homepage and the box score page both
 * check it before swallowing a data error). Next inlines NEXT_PUBLIC_* vars
 * when it compiles, so in a real build this is effectively fixed at build
 * time; only under vitest is the variable read again on each call.
 */
export function hasNoDatabase(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return !url || /^https?:\/\/placeholder\.supabase\.co(\/|$)/i.test(url.trim());
}
