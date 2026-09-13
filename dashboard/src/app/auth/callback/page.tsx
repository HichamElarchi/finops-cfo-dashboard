"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

type OtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

const OTP_TYPES: OtpType[] = ["magiclink", "email", "invite", "signup", "recovery", "email_change"];

export default function AuthCallbackPage() {
  const [status, setStatus] = useState("Signing in...");

  useEffect(() => {
    async function finish() {
      const url = new URL(window.location.href);
      const next = url.searchParams.get("next");
      const invitedBy = url.searchParams.get("invited_by");
      const forEmail = (url.searchParams.get("for") || "").toLowerCase();
      const tokenHash = url.searchParams.get("token_hash");
      const token = url.searchParams.get("token");
      const code = url.searchParams.get("code");
      const type = (url.searchParams.get("type") || "magiclink") as OtpType;
      const hasHash = window.location.hash.includes("access_token");
      const supabase = createBrowserSupabase();

      const go = async () => {
        const { data } = await supabase.auth.getSession();
        if (!data.session) {
          setStatus("This link is invalid or already used. Ask for a new invitation.");
          window.setTimeout(() => {
            window.location.replace("/login?error=email");
          }, 2000);
          return;
        }
        if (next === "reset" || type === "recovery") {
          window.location.replace("/login?reset=1");
          return;
        }
        const workspace = await fetch(
          invitedBy || forEmail ? "/api/workspace?space=developer" : "/api/workspace?space=cfo",
        );
        const payload = await workspace.json();
        if (invitedBy || forEmail || payload.role === "developer") {
          window.location.replace("/developer");
          return;
        }
        window.location.replace("/");
      };

      if (tokenHash) {
        for (const otpType of [type, ...OTP_TYPES]) {
          const { error } = await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash });
          if (!error) {
            await go();
            return;
          }
        }
      }

      if (token && forEmail) {
        for (const otpType of [type, ...OTP_TYPES]) {
          const { error } = await supabase.auth.verifyOtp({
            type: otpType,
            email: forEmail,
            token,
          });
          if (!error) {
            await go();
            return;
          }
        }
      }

      if (code) {
        const { error } = await supabase.auth.exchangeCodeForSession(code);
        if (!error) {
          await go();
          return;
        }
      }

      if (hasHash) {
        await supabase.auth.getSession();
        await go();
        return;
      }

      window.setTimeout(async () => {
        const { data } = await supabase.auth.getSession();
        if (data.session) {
          await go();
          return;
        }
        setStatus("This link is invalid or already used.");
        window.location.replace(
          invitedBy || forEmail
            ? `/login?error=email&invited_by=${encodeURIComponent(invitedBy || "")}&for=${encodeURIComponent(forEmail)}`
            : "/login?error=email",
        );
      }, 1500);
    }

    void finish();
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <p className="text-sm text-gray-400">{status}</p>
    </main>
  );
}
