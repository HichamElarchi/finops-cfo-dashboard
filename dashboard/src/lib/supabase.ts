import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;
let clientKey: string | null = null;

export function getSupabase(url?: string, key?: string): SupabaseClient | null {
  const supabaseUrl = url || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey =
    key ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error(
      "Missing variables: NEXT_PUBLIC_SUPABASE_URL and publishable/anon key",
    );
    return null;
  }

  const cacheKey = `${supabaseUrl}:${supabaseKey}`;
  if (client && clientKey === cacheKey) {
    return client;
  }

  client = createClient(supabaseUrl, supabaseKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
  clientKey = cacheKey;
  return client;
}
