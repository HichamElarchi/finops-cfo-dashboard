import { createBrowserSupabase } from "@/lib/supabase/client";

export async function kickIfAccessRevoked(
  response: Response,
  payload: { code?: string; error?: string },
) {
  if (response.status !== 403 || payload.code !== "revoked") {
    return false;
  }
  const supabase = createBrowserSupabase();
  await supabase.auth.signOut();
  window.location.replace("/login?error=revoked");
  return true;
}
