"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { CopyButton } from "@/components/CopyButton";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { kickIfAccessRevoked } from "@/lib/kick-revoked";

const PYTHON_SNIPPET = (baseUrl: string) => `import os
from openai import OpenAI

client = OpenAI(
    api_key=os.environ["PROXY_API_KEY"],
    base_url="${baseUrl}",
)

response = client.chat.completions.create(
    model="openai/gpt-4o",
    messages=[{"role": "user", "content": "Hello"}],
)
print(response.choices[0].message.content)
`;

const NODE_SNIPPET = (baseUrl: string) => `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: process.env.PROXY_API_KEY,
  baseURL: "${baseUrl}",
});

const response = await client.chat.completions.create({
  model: "openai/gpt-4o",
  messages: [{ role: "user", content: "Hello" }],
});

console.log(response.choices[0].message.content);
`;

function SnippetBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-gray-800 overflow-hidden bg-gray-950">
      <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800 bg-gray-900/80">
        <h3 className="text-sm font-medium text-gray-300">{title}</h3>
        <CopyButton value={value} label="Copy" showLabel />
      </div>
      <pre className="m-0 p-4 text-[13px] leading-6 overflow-x-auto text-gray-200 font-mono whitespace-pre">
        <code>{value}</code>
      </pre>
    </div>
  );
}

export default function DeveloperClient() {
  const [email, setEmail] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [workspaceName, setWorkspaceName] = useState<string | null>(null);
  const [cfoEmail, setCfoEmail] = useState<string | null>(null);
  const [memberships, setMemberships] = useState<
    { workspaceId: string; workspaceName: string; role: string; cfoEmail: string | null }[]
  >([]);
  const [proxyBaseUrl, setProxyBaseUrl] = useState("https://finops-cfo-dashboard.vercel.app/v1");
  const [openRouterKey, setOpenRouterKey] = useState("");
  const [hasOpenRouterKey, setHasOpenRouterKey] = useState(false);
  const [proxyKeyPrefix, setProxyKeyPrefix] = useState<string | null>(null);
  const [generatedProxyKey, setGeneratedProxyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState<"openrouter" | "key" | "logout" | "switch" | null>(null);

  const python = useMemo(() => PYTHON_SNIPPET(proxyBaseUrl), [proxyBaseUrl]);
  const node = useMemo(() => NODE_SNIPPET(proxyBaseUrl), [proxyBaseUrl]);

  async function fetchWorkspace() {
    const response = await fetch("/api/workspace?space=developer");
    const payload = await response.json();
    if (await kickIfAccessRevoked(response, payload)) {
      return;
    }
    if (!response.ok) {
      setErrorMessage(payload.error || "Workspace unavailable. Run supabase/members.sql");
      return;
    }
    if (payload.role !== "developer") {
      window.location.replace("/");
      return;
    }
    setEmail(payload.email);
    setWorkspaceId(payload.workspace_id || null);
    setWorkspaceName(payload.workspace_name || null);
    setCfoEmail(payload.cfo_email || null);
    setMemberships(payload.memberships ?? []);
    setHasOpenRouterKey(Boolean(payload.has_openrouter_key));
    setProxyKeyPrefix(payload.proxy_key_prefix);
    if (payload.proxy_base_url) setProxyBaseUrl(payload.proxy_base_url);
  }

  async function selectWorkspace(nextId: string) {
    if (!nextId || nextId === workspaceId || busy) return;
    setBusy("switch");
    setGeneratedProxyKey(null);
    try {
      const response = await fetch("/api/workspace/select", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspace_id: nextId }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setErrorMessage(payload.error || "Unable to switch company");
        return;
      }
      await fetchWorkspace();
    } finally {
      setBusy(null);
    }
  }

  async function saveOpenRouterKey(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy("openrouter");
    try {
      const response = await fetch("/api/credentials/openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouter_api_key: openRouterKey }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || "Unable to save");
        return;
      }
      setHasOpenRouterKey(true);
      setOpenRouterKey("");
      setMessage("OpenRouter key saved for this workspace.");
    } finally {
      setBusy(null);
    }
  }

  async function generateProxyKey() {
    if (busy) return;
    setBusy("key");
    try {
      const response = await fetch("/api/keys/generate", { method: "POST" });
      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error || "Unable to generate key");
        return;
      }
      setGeneratedProxyKey(payload.proxy_api_key);
      setProxyKeyPrefix(payload.key_prefix);
      setMessage("Copy the key now. It will not be shown in full again.");
    } finally {
      setBusy(null);
    }
  }

  async function logout() {
    if (busy) return;
    setBusy("logout");
    const supabase = createBrowserSupabase();
    await supabase.auth.signOut();
    window.location.href = `/login?space=developer&email=${encodeURIComponent(email || "")}`;
  }

  useEffect(() => {
    fetchWorkspace();
  }, []);

  return (
    <main className="min-h-screen bg-gray-950 text-white p-8 font-sans">
      <div className="max-w-4xl mx-auto space-y-8">
        <div className="border-b border-gray-800 pb-5 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold text-emerald-400">Developer View</h1>
            <p className="text-gray-400 text-sm mt-1">
              {email ?? "Lead Developer"} · technical setup only
            </p>
            <p className="text-sm text-emerald-200/90 mt-2">
              Linked to CFO:{" "}
              <span className="font-medium text-white">{cfoEmail || workspaceName || "unknown"}</span>
            </p>
            {memberships.length > 1 ? (
              <label className="mt-3 block text-sm text-gray-400">
                Active company
                <select
                  value={workspaceId ?? ""}
                  onChange={(event) => void selectWorkspace(event.target.value)}
                  className="mt-1 w-full max-w-md bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
                >
                  {memberships.map((item) => (
                    <option key={item.workspaceId} value={item.workspaceId}>
                      {item.cfoEmail || item.workspaceName}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <button
            type="button"
            onClick={logout}
            disabled={busy !== null}
            className="text-sm border border-gray-700 rounded-lg px-3 py-2 text-gray-300 hover:bg-gray-800 disabled:opacity-60"
          >
            {busy === "logout" ? "Signing out..." : "Sign out"}
          </button>
        </div>

        {errorMessage ? (
          <div className="bg-red-950/40 border border-red-800 text-red-300 rounded-xl p-4 text-sm">
            {errorMessage}
          </div>
        ) : null}
        {message ? <p className="text-sm text-amber-200">{message}</p> : null}

        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-3">
          <h2 className="text-lg font-semibold">Proxy Base URL</h2>
          <div className="flex items-start gap-2 bg-gray-950 border border-gray-700 rounded-lg p-3">
            <code className="flex-1 text-sm text-emerald-200 break-all">{proxyBaseUrl}</code>
            <CopyButton value={proxyBaseUrl} />
          </div>
          <p className="text-xs text-gray-500">
            Point the OpenAI SDK at this base URL. Auth:{" "}
            <code>Authorization: Bearer pk_live_...</code>
          </p>
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-4">
          <h2 className="text-lg font-semibold">Company OpenRouter key</h2>
          {!hasOpenRouterKey ? (
            <p className="text-sm text-amber-200">
              Required before test prompts work: paste your <code>sk-or-...</code> key and click
              Save OpenRouter.
            </p>
          ) : null}
          <form onSubmit={saveOpenRouterKey} className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input
              type="password"
              value={openRouterKey}
              onChange={(event) => setOpenRouterKey(event.target.value)}
              placeholder={hasOpenRouterKey ? "sk-or-•••••••• (replace)" : "sk-or-..."}
              className="md:col-span-2 bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-sm"
            />
            <button
              type="submit"
              disabled={busy !== null || !openRouterKey.trim()}
              className="bg-gray-800 hover:bg-gray-700 disabled:opacity-60 rounded-lg px-3 py-2 text-sm"
            >
              {busy === "openrouter" ? "Saving..." : "Save OpenRouter"}
            </button>
          </form>
        </section>

        <section className="border border-blue-800/60 bg-gray-950/70 rounded-xl p-6 space-y-3">
          <h2 className="text-lg font-semibold text-blue-300">Proxy API key</h2>
          <button
            type="button"
            onClick={generateProxyKey}
            disabled={busy !== null}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg px-4 py-2 text-sm"
          >
            {busy === "key" ? "Generating..." : "Generate Proxy API Key"}
          </button>
          <p className="text-xs text-gray-500">Current prefix: {proxyKeyPrefix || "none"}</p>
          {generatedProxyKey ? (
            <div className="flex items-start gap-2 bg-gray-900 border border-amber-700 rounded-lg p-3">
              <p className="flex-1 text-sm font-mono break-all text-amber-100">{generatedProxyKey}</p>
              <CopyButton value={generatedProxyKey} />
            </div>
          ) : null}
        </section>

        <section className="bg-gray-900 border border-gray-800 rounded-xl p-6 space-y-5">
          <div>
            <h2 className="text-lg font-semibold">Integration guide</h2>
            <p className="text-sm text-gray-400 mt-2">
              Authenticate with your proxy key: <code>Authorization: Bearer pk_live_...</code>
            </p>
          </div>
          <p className="text-sm text-emerald-100/90 bg-emerald-950/40 border border-emerald-800/60 rounded-lg px-4 py-3 leading-relaxed">
            You can keep requesting your usual models (like gpt-4o or claude-3.5-sonnet). Our
            Smart Balance proxy automatically optimizes and routes routine tasks to cost-effective
            models in the background to save costs, without breaking your code.
          </p>
          <SnippetBlock title="Python" value={python} />
          <SnippetBlock title="Node.js" value={node} />
        </section>
      </div>
    </main>
  );
}
