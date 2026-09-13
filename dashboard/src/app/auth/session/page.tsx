"use client";

import { useEffect } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

export default function AuthSessionPage() {
  useEffect(() => {
    const supabase = createBrowserSupabase();
    let done = false;

    async function finish() {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const type = (params.get("type") || "signup") as
        | "signup"
        | "invite"
        | "magiclink"
        | "recovery"
        | "email_change"
        | "email";

      if (tokenHash) {
        const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
        if (!error) {
          window.location.replace(type === "recovery" ? "/login?reset=1" : "/");
          return;
        }
      }

      const { data } = await supabase.auth.getSession();
      if (data.session) {
        window.location.replace("/");
        return;
      }

      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (done) return;
        if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
          done = true;
          window.location.replace("/");
        }
      });

      window.setTimeout(() => {
        listener.subscription.unsubscribe();
        if (!done) {
          window.location.replace("/login");
        }
      }, 2500);
    }

    void finish();
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <p className="text-sm text-gray-400">Signing in...</p>
    </main>
  );
}
