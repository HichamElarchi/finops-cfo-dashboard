"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase/client";

type OtpType = "signup" | "invite" | "magiclink" | "recovery" | "email_change" | "email";

export default function InvitePage() {
  const [status, setStatus] = useState("Signing you in to the developer dashboard...");

  useEffect(() => {
    async function accept() {
      const url = new URL(window.location.href);
      const invitedBy = url.searchParams.get("invited_by");
      const forEmail = (url.searchParams.get("for") || "").toLowerCase();
      const tokenHash = url.searchParams.get("token_hash");
      const token = url.searchParams.get("token");
      const type = (url.searchParams.get("type") || "magiclink") as OtpType;
      const code = url.searchParams.get("code");
      const hasHashToken = window.location.hash.includes("access_token");

      if (tokenHash || code) {
        const callback = new URL("/auth/callback", window.location.origin);
        if (tokenHash) callback.searchParams.set("token_hash", tokenHash);
        if (code) callback.searchParams.set("code", code);
        if (type) callback.searchParams.set("type", type);
        if (invitedBy) callback.searchParams.set("invited_by", invitedBy);
        if (forEmail) callback.searchParams.set("for", forEmail);
        window.location.replace(callback.toString());
        return;
      }

      const client = createBrowserSupabase();

      if (token && forEmail) {
        const types: OtpType[] = [type, "magiclink", "email", "invite", "signup"];
        for (const otpType of types) {
          const { error } = await client.auth.verifyOtp({
            type: otpType,
            email: forEmail,
            token,
          });
          if (!error) break;
        }
      } else if (hasHashToken) {
        await client.auth.getSession();
      }

      const { data } = await client.auth.getSession();
      if (data.session) {
        const workspace = await fetch("/api/workspace?space=developer");
        const payload = await workspace.json();
        window.location.replace(payload.role === "developer" ? "/developer" : "/");
        return;
      }

      window.setTimeout(async () => {
        const again = await client.auth.getSession();
        if (again.data.session) {
          window.location.replace("/developer");
          return;
        }
        setStatus("This invitation link is invalid or already used. Ask the CFO to send a new one.");
      }, 2500);
    }

    void accept();
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <p className="text-sm text-gray-400">{status}</p>
    </main>
  );
}
