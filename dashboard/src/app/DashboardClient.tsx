"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { ProfileDrawer, type Invite } from "@/components/ProfileDrawer";
import { ThemeToggle } from "@/components/ThemeToggle";
import { UsageTable } from "@/components/UsageTable";
import { formatUsd } from "@/lib/format";
import { kickIfAccessRevoked } from "@/lib/kick-revoked";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { summarizeUsage, type UsageRow } from "@/lib/usage";

export default function DashboardClient() {
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [cfoEmail, setCfoEmail] = useState<string | null>(null);
  const [trialEndsAt, setTrialEndsAt] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [settingsMessage, setSettingsMessage] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [busy, setBusy] = useState<"invite" | "uninvite" | "stripe" | "logout" | null>(null);
  const [uninviteEmail, setUninviteEmail] = useState<string | null>(null);
  const [inviteCooldown, setInviteCooldown] = useState(0);

  async function fetchRequests() {
    try {
      const response = await fetch("/api/workspace/usage");
      const payload = await response.json();
      if (await kickIfAccessRevoked(response, payload)) {
        return;
      }
      if (!response.ok) {
        setErrorMessage(payload.error || "Failed to load usage");
        setRows([]);
        return;
      }
      setRows((payload.rows as UsageRow[] | null) ?? []);
      if (payload.workspace_name) {
        setWorkspaceName(payload.workspace_name);
      }
      setErrorMessage(null);
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : "Failed to load data");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  async function fetchWorkspace() {
    const response = await fetch("/api/workspace?space=cfo");
    const payload = await response.json();
    if (await kickIfAccessRevoked(response, payload)) {
      return;
    }
    if (!response.ok) {
      setErrorMessage(payload.error || "Workspace unavailable. Run supabase/roles.sql");
      return;
    }
    if (payload.role === "developer") {
      window.location.replace("/developer");
      return;
    }
    setEmail(payload.email);
    setWorkspaceName(payload.workspace_name || null);
    setCfoEmail(payload.cfo_email || payload.email || null);
    setTrialEndsAt(payload.trial_ends_at);
    setInvites(payload.invites ?? []);
  }

  async function inviteDeveloper(event: FormEvent) {
    event.preventDefault();
    if (busy || inviteCooldown > 0) return;
    setBusy("invite");
    try {
      const response = await fetch("/api/workspace/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSettingsMessage(payload.error || "Unable to send invitation");
        return;
      }
      setInviteEmail("");
      setSettingsMessage(
        payload.message || `${inviteEmail.trim().toLowerCase()} can now sign in on the Developer space.`,
      );
      setInviteCooldown(3);
      await fetchWorkspace();
    } finally {
      setBusy(null);
    }
  }

  async function uninviteDeveloper(devEmail: string) {
    if (busy) return;
    setBusy("uninvite");
    setUninviteEmail(devEmail);
    try {
      const response = await fetch("/api/workspace/invite", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: devEmail }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setSettingsMessage(payload.error || "Unable to revoke invitation");
        return;
      }
      setSettingsMessage(`${devEmail} no longer has access to this workspace.`);
      await fetchWorkspace();
    } finally {
      setBusy(null);
      setUninviteEmail(null);
    }
  }

  async function startStripeCheckout() {
    if (busy) return;
    setBusy("stripe");
    try {
      const response = await fetch("/api/billing/checkout", { method: "POST" });
      const payload = await response.json();
      if (payload.checkout_url) {
        window.location.href = payload.checkout_url;
        return;
      }
      setSettingsMessage(payload.message || "Stripe placeholder: keys are not configured.");
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy("logout");
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    window.location.href = "/login?space=cfo";
  }

  useEffect(() => {
    fetchWorkspace();
    fetchRequests();
  }, []);

  useEffect(() => {
    if (inviteCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setInviteCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [inviteCooldown]);

  const totals = useMemo(() => summarizeUsage(rows), [rows]);
  const company = workspaceName || cfoEmail || "your company";
  const trialLabel = trialEndsAt
    ? `Trial until ${new Date(trialEndsAt).toLocaleDateString("en-US")}`
    : "3-day trial";

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl space-y-8 px-6 py-8">
        <header className="flex flex-col gap-4 border-b border-border pb-6 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Overview</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">FinOps CFO</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {cfoEmail ?? email ?? "Workspace"} · {company} · {trialLabel}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <ProfileDrawer
              email={email}
              open={profileOpen}
              invites={invites}
              onToggle={() => setProfileOpen((open) => !open)}
              onClose={() => setProfileOpen(false)}
              onUninvite={uninviteDeveloper}
              busyEmail={uninviteEmail}
            />
            <button
              type="button"
              onClick={logout}
              disabled={busy !== null}
              className="h-9 rounded-lg border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-60"
            >
              {busy === "logout" ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </header>

        {errorMessage ? (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-danger">
            {errorMessage}
          </div>
        ) : null}

        <section className="grid grid-cols-1 gap-4 md:grid-cols-4">
          <KpiCard
            label="Requests processed"
            value={totals.requests.toLocaleString()}
            hint={`${totals.promptTokens.toLocaleString()} prompt + ${totals.completionTokens.toLocaleString()} completion tokens`}
          />
          <KpiCard
            label="Cost without proxy"
            value={formatUsd(totals.withoutProxy)}
            hint="If every call had used the requested model"
            tone="warning"
          />
          <KpiCard
            label="Cost with proxy"
            value={formatUsd(totals.spent)}
            hint="Actual spend after Smart Router"
          />
          <KpiCard
            label="Estimated savings"
            value={formatUsd(totals.savings)}
            hint="Difference only when a cheaper model was used"
            tone="success"
          />
        </section>

        <section className="rounded-xl border border-violet-500/30 bg-violet-500/10 px-5 py-4">
          <p className="text-xs font-medium uppercase tracking-wide text-violet-700 dark:text-violet-300">
            Semantic cache
          </p>
          <p className="mt-1 text-sm text-foreground">
            {totals.cacheHits.toLocaleString()} reused answers · {formatUsd(totals.cacheSavings)} saved ·{" "}
            {totals.cacheTokens.toLocaleString()} tokens not sent to an LLM
          </p>
        </section>

        <UsageTable
          rows={rows}
          workspaceName={company}
          loading={loading}
          onRefresh={() => {
            setLoading(true);
            void fetchRequests();
          }}
        />

        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Invite lead developer</h2>
            <p className="text-sm text-muted-foreground">
              The invited email is linked to this CFO account only. That person signs in on the
              Developer space.
            </p>
            {settingsMessage ? <p className="text-sm text-warning">{settingsMessage}</p> : null}
            <form onSubmit={inviteDeveloper} className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                placeholder="lead.dev@company.com"
                className="rounded-lg border border-border bg-background px-3 py-2 text-sm sm:col-span-2"
              />
              <button
                type="submit"
                disabled={busy !== null || inviteCooldown > 0 || !inviteEmail.trim()}
                className="rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
              >
                {busy === "invite"
                  ? "Registering..."
                  : inviteCooldown > 0
                    ? `Wait ${inviteCooldown}s`
                    : "Invite"}
              </button>
            </form>
          </div>

          <div className="space-y-4 rounded-xl border border-border bg-card p-5 shadow-sm">
            <h2 className="text-sm font-semibold">Subscription</h2>
            <p className="text-sm text-muted-foreground">
              Keep the trial workspace live after the first three days.
            </p>
            <button
              type="button"
              onClick={startStripeCheckout}
              disabled={busy !== null}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-accent disabled:opacity-60"
            >
              {busy === "stripe" ? "Opening..." : "Subscribe (Stripe)"}
            </button>
          </div>
        </section>
      </div>
    </main>
  );
}
