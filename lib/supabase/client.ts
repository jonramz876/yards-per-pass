// lib/supabase/client.ts
// Browser-only singleton. Do NOT import this in server components — use lib/supabase/server.ts instead.

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_BROWSER_READ_TIMEOUT_MS, withReadTimeout } from "@/lib/supabase/timeout";

let client: ReturnType<typeof createClient> | null = null;

export function getSupabaseClient() {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        // Every read from the browser gets a 15 s limit (read resilience spec
        // §1.3; lib/supabase/timeout.ts). Longer than the server's 5 s because
        // it covers the download on the visitor's own connection. When it
        // passes, search and Compare show their "not responding" sentence.
        global: { fetch: withReadTimeout((input, init) => fetch(input, init), SUPABASE_BROWSER_READ_TIMEOUT_MS) },
      }
    );
  }
  return client;
}
