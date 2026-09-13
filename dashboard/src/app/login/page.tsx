"use client";

import { FormEvent, Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { GoogleIcon } from "@/components/GoogleIcon";
import { kickIfAccessRevoked } from "@/lib/kick-revoked";

type Space = "cfo" | "developer";

function siteUrl() {
  return (process.env.NEXT_PUBLIC_SITE_URL || window.location.origin).replace(/\/$/, "");
}

function friendlyError(value: string | null) {
  if (!value) return null;
  if (value === "oauth") {
    return "Google sign-in failed. Please try again from this page.";
  }
  if (value === "email") {
    return "This link expired or was already used.";
  }
  if (value === "reset") {
    return "Choose a new password.";
  }
  if (value === "revoked") {
    return "Your invitation was revoked. You no longer have access to this workspace.";
  }
  if (/pkce|code verifier|storage/i.test(value)) {
    return null;
  }
  return value;
}

function LoginForm() {
  const searchParams = useSearchParams();
  const forEmail = (searchParams.get("for") || "").toLowerCase();
  const [space, setSpace] = useState<Space>(
    searchParams.get("space") === "developer" || Boolean(forEmail) ? "developer" : "cfo",
  );
  const [error, setError] = useState<string | null>(friendlyError(searchParams.get("error")));
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState<"google" | "signin" | "signup" | "forgot" | "reset" | null>(null);
  const [signupCooldown, setSignupCooldown] = useState(0);
  const [forgotCooldown, setForgotCooldown] = useState(0);
  const [showSignup, setShowSignup] = useState(false);
  const [accountExists, setAccountExists] = useState(false);
  const [resetMode, setResetMode] = useState(searchParams.get("reset") === "1");
  const [email, setEmail] = useState(forEmail || searchParams.get("email") || "");
  const [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");

  async function enterIfAllowed() {
    const response = await fetch(`/api/workspace?space=${space}`);
    const payload = await response.json();
    if (await kickIfAccessRevoked(response, payload)) {
      return;
    }
    if (!response.ok) {
      setError(payload.error || "Unable to open this space with this email.");
      return;
    }
    if (space === "developer") {
      window.location.replace("/developer");
      return;
    }
    window.location.replace("/");
  }

  function switchSpace(next: Space) {
    setSpace(next);
    setError(null);
    setInfo(null);
    setShowSignup(false);
    const url = new URL(window.location.href);
    url.searchParams.set("space", next);
    window.history.replaceState(null, "", url.toString());
  }

  async function signInWithGoogle() {
    setLoading("google");
    setError(null);
    setInfo(null);
    const supabase = createBrowserSupabase();
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${siteUrl()}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "select_account",
        },
      },
    });
    if (oauthError) {
      setError(oauthError.message);
      setLoading(null);
    }
  }

  async function signInDeveloper(event: FormEvent) {
    event.preventDefault();
    setLoading("signin");
    setError(null);
    setInfo(null);
    try {
      const supabase = createBrowserSupabase();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setError("Incorrect email or password. If this is your first visit, use Sign up.");
        return;
      }
      await enterIfAllowed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to sign in.");
    } finally {
      setLoading(null);
    }
  }

  async function signUpDeveloper(event: FormEvent) {
    event.preventDefault();
    if (signupCooldown > 0) return;
    setLoading("signup");
    setError(null);
    setInfo(null);
    try {
      const response = await fetch("/api/auth/developer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const payload = (await response.json()) as { error?: string; ok?: boolean };
      if (response.status === 409) {
        setShowSignup(false);
        setAccountExists(true);
        setError(payload.error || "This developer account already exists. Sign in instead.");
        return;
      }
      if (!response.ok) {
        setError(payload.error || "Unable to create the developer account.");
        return;
      }
      const supabase = createBrowserSupabase();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError) {
        setShowSignup(false);
        setInfo("Account created. Sign in with this email and password.");
        return;
      }
      await enterIfAllowed();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create the developer account.");
    } finally {
      setLoading(null);
    }
  }

  async function signInWithEmail(event: FormEvent) {
    event.preventDefault();
    setLoading("signin");
    setError(null);
    setInfo(null);
    const supabase = createBrowserSupabase();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (!signInError) {
      await supabase.auth.updateUser({ data: { password_set: true } });
      await enterIfAllowed();
      return;
    }
    setError(
      accountExists
        ? "This account already exists. The password does not match."
        : "Incorrect email or password.",
    );
    setLoading(null);
  }

  async function signUpWithEmail(event: FormEvent) {
    event.preventDefault();
    if (signupCooldown > 0) return;
    setLoading("signup");
    setError(null);
    setInfo(null);
    const supabase = createBrowserSupabase();
    const trimmed = email.trim();

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: trimmed,
      password,
    });
    if (!signInError) {
      await supabase.auth.updateUser({ data: { password_set: true } });
      await enterIfAllowed();
      return;
    }

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: trimmed,
      password,
      options: {
        emailRedirectTo: `${siteUrl()}/auth/session`,
      },
    });
    if (data.session) {
      await enterIfAllowed();
      return;
    }

    const alreadyRegistered =
      Boolean(signUpError && /already|registered|exists/i.test(signUpError.message)) ||
      Boolean(data.user && (data.user.identities?.length ?? 0) === 0);

    if (alreadyRegistered) {
      setShowSignup(false);
      setAccountExists(true);
      setError("This account already exists. Enter your password, or reset it.");
      setLoading(null);
      return;
    }

    if (signUpError) {
      setError(signUpError.message);
      setLoading(null);
      return;
    }

    setInfo("CFO account created. Open the link we emailed you to sign in.");
    setLoading(null);
    setSignupCooldown(60);
  }

  async function sendResetLink() {
    if (forgotCooldown > 0 || !email.trim()) return;
    setLoading("forgot");
    setError(null);
    setInfo(null);
    const supabase = createBrowserSupabase();
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${siteUrl()}/auth/callback?next=reset`,
    });
    if (resetError) {
      if (/after \d+ seconds|rate limit|too many/i.test(resetError.message)) {
        setInfo("A link was already sent. Check your inbox.");
      } else {
        setError(resetError.message);
      }
      setLoading(null);
      setForgotCooldown(60);
      return;
    }
    setInfo("Link sent. Open it to create a new password.");
    setLoading(null);
    setForgotCooldown(60);
  }

  async function saveNewPassword(event: FormEvent) {
    event.preventDefault();
    if (newPassword.length < 6) return;
    setLoading("reset");
    setError(null);
    const supabase = createBrowserSupabase();
    const { error: updateError } = await supabase.auth.updateUser({
      password: newPassword,
      data: { password_set: true },
    });
    if (updateError) {
      setError(updateError.message);
      setLoading(null);
      return;
    }
    setResetMode(false);
    await enterIfAllowed();
  }

  useEffect(() => {
    const supabase = createBrowserSupabase();

    async function boot() {
      const { data } = await supabase.auth.getSession();
      if (resetMode) {
        if (!data.session) {
          setResetMode(false);
          setError("This link expired. Request a new one.");
        }
        return;
      }
      if (space === "developer") {
        return;
      }
      if (data.session) {
        await enterIfAllowed();
      }
    }

    void boot();
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (resetMode || space === "developer") return;
      if (session && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
        void enterIfAllowed();
      }
    });
    return () => data.subscription.unsubscribe();
  }, [resetMode, space]);

  useEffect(() => {
    if (forgotCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setForgotCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [forgotCooldown]);

  useEffect(() => {
    if (signupCooldown <= 0) return;
    const timer = window.setInterval(() => {
      setSignupCooldown((seconds) => Math.max(0, seconds - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [signupCooldown]);

  const busy = loading !== null;
  const isDeveloper = space === "developer";

  return (
    <main className="min-h-screen bg-gray-950 text-white flex items-center justify-center p-6">
      <div className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-8 space-y-6">
        <div>
          <p className="text-blue-400 text-sm font-medium">AI FinOps Proxy</p>
          <h1 className="text-2xl font-bold mt-1">
            {resetMode ? "New password" : isDeveloper ? "Developer space" : "CFO space"}
          </h1>
          <p className="text-gray-400 text-sm mt-2">
            {resetMode
              ? "Choose a password so you can sign in next time."
              : isDeveloper
                ? showSignup
                  ? "Use the email your CFO invited and choose a password."
                  : "Sign in with the email and password you created."
                : "Sign in with Google, or with email and password."}
          </p>
        </div>

        {resetMode ? null : (
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-950 p-1 border border-gray-800">
            <button
              type="button"
              onClick={() => switchSpace("cfo")}
              className={`h-10 rounded-lg text-sm font-medium ${
                space === "cfo" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              CFO
            </button>
            <button
              type="button"
              onClick={() => switchSpace("developer")}
              className={`h-10 rounded-lg text-sm font-medium ${
                isDeveloper ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"
              }`}
            >
              Developer
            </button>
          </div>
        )}

        {error ? (
          <p className="text-sm text-red-300 bg-red-950/40 border border-red-800 rounded-lg p-3">
            {error}
          </p>
        ) : null}
        {info ? (
          <p className="text-sm text-emerald-200 bg-emerald-950/40 border border-emerald-800 rounded-lg p-3">
            {info}
          </p>
        ) : null}

        {resetMode ? (
          <form onSubmit={saveNewPassword} className="space-y-3">
            <label className="block space-y-1.5 text-sm">
              <span className="text-gray-400">New password</span>
              <input
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                placeholder="At least 6 characters"
                className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </label>
            <button
              type="submit"
              disabled={busy || newPassword.length < 6}
              className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg h-11 px-4 text-sm font-medium"
            >
              {loading === "reset" ? "Saving..." : "Save and sign in"}
            </button>
          </form>
        ) : isDeveloper ? (
          <>
            <form onSubmit={showSignup ? signUpDeveloper : signInDeveloper} className="space-y-3">
              <label className="block space-y-1.5 text-sm">
                <span className="text-gray-400">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="text-gray-400">{showSignup ? "Create a password" : "Password"}</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={showSignup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"
                />
              </label>
              <button
                type="submit"
                disabled={
                  busy ||
                  !email.trim() ||
                  password.length < 6 ||
                  (showSignup && signupCooldown > 0)
                }
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg h-11 px-4 text-sm font-medium"
              >
                {showSignup
                  ? loading === "signup"
                    ? "Creating..."
                    : signupCooldown > 0
                      ? `Wait ${signupCooldown}s`
                      : "Create developer account"
                  : loading === "signin"
                    ? "Signing in..."
                    : "Sign in"}
              </button>
            </form>
            <p className="text-center text-xs text-gray-500">
              {showSignup ? (
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline"
                  onClick={() => {
                    setShowSignup(false);
                    setError(null);
                    setInfo(null);
                  }}
                >
                  Already have an account? Sign in
                </button>
              ) : (
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline"
                  onClick={() => {
                    setShowSignup(true);
                    setError(null);
                    setInfo(null);
                  }}
                >
                  Sign up
                </button>
              )}
            </p>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={signInWithGoogle}
              disabled={busy}
              className="w-full flex items-center justify-center gap-3 bg-white hover:bg-gray-100 text-gray-800 font-medium rounded-lg h-11 px-4 disabled:opacity-60"
            >
              <GoogleIcon />
              {loading === "google" ? "Redirecting..." : "Continue with Google"}
            </button>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              <span className="flex-1 h-px bg-gray-800" />
              or email
              <span className="flex-1 h-px bg-gray-800" />
            </div>
            <form onSubmit={showSignup ? signUpWithEmail : signInWithEmail} className="space-y-3">
              <label className="block space-y-1.5 text-sm">
                <span className="text-gray-400">Email</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="you@company.com"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"
                />
              </label>
              <label className="block space-y-1.5 text-sm">
                <span className="text-gray-400">Password</span>
                <input
                  type="password"
                  required
                  minLength={6}
                  autoComplete={showSignup ? "new-password" : "current-password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="At least 6 characters"
                  className="w-full bg-gray-950 border border-gray-700 rounded-lg px-3 py-2 text-white"
                />
              </label>
              <p className="text-right">
                <button
                  type="button"
                  onClick={() => void sendResetLink()}
                  disabled={busy || !email.trim() || forgotCooldown > 0}
                  className="text-xs text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline disabled:opacity-60"
                >
                  {forgotCooldown > 0
                    ? "Link sent"
                    : accountExists
                      ? "Forgot password? Send a reset link"
                      : "Forgot password"}
                </button>
              </p>
              <button
                type="submit"
                disabled={
                  busy ||
                  !email.trim() ||
                  password.length < 6 ||
                  (showSignup && signupCooldown > 0)
                }
                className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-60 rounded-lg h-11 px-4 text-sm font-medium"
              >
                {showSignup
                  ? loading === "signup"
                    ? "Creating..."
                    : signupCooldown > 0
                      ? `Wait ${signupCooldown}s`
                      : "Create CFO account"
                  : loading === "signin"
                    ? "Signing in..."
                    : "Sign in"}
              </button>
            </form>
            <p className="text-center text-xs text-gray-500">
              {showSignup ? (
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline"
                  onClick={() => setShowSignup(false)}
                >
                  Already have an account? Sign in
                </button>
              ) : (
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-200 underline-offset-2 hover:underline"
                  onClick={() => setShowSignup(true)}
                >
                  Sign up
                </button>
              )}
            </p>
          </>
        )}
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
