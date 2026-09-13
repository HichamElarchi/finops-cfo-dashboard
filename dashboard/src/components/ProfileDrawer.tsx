"use client";

import { useMemo } from "react";

export interface Invite {
  id: string;
  email: string;
  status: string;
}

type ProfileDrawerProps = {
  email: string | null;
  open: boolean;
  invites: Invite[];
  onToggle: () => void;
  onClose: () => void;
  onUninvite: (email: string) => void;
  busyEmail?: string | null;
};

function initials(email: string | null) {
  const value = (email || "C").trim();
  return value.slice(0, 1).toUpperCase();
}

export function ProfileDrawer({
  email,
  open,
  invites,
  onToggle,
  onClose,
  onUninvite,
  busyEmail,
}: ProfileDrawerProps) {
  const letter = useMemo(() => initials(email), [email]);

  return (
    <>
      <button
        type="button"
        onClick={onToggle}
        aria-label="Profile and invited developers"
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-sm font-semibold hover:bg-accent"
      >
        {letter}
      </button>
      {open ? (
        <button
          type="button"
          aria-label="Close panel"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40"
        />
      ) : null}
      <aside
        className={`fixed top-0 right-0 z-50 h-full w-80 max-w-[90vw] border-l border-border bg-card p-5 shadow-2xl transition-transform duration-300 ${
          open ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center gap-3 border-b border-border pb-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full border border-border bg-muted text-lg font-semibold">
            {letter}
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">CFO</p>
            <p className="truncate text-sm">{email ?? "Workspace"}</p>
          </div>
        </div>
        <h2 className="mb-3 mt-5 text-sm font-semibold">Invited developers</h2>
        {invites.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No developers yet. Only an email invited here can join this account.
          </p>
        ) : (
          <ul className="space-y-2">
            {invites.map((invite) => (
              <li
                key={invite.id}
                className="flex items-start justify-between gap-2 rounded-lg border border-border p-3"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm">{invite.email}</p>
                  <p className="text-xs text-muted-foreground">{invite.status}</p>
                </div>
                <button
                  type="button"
                  disabled={Boolean(busyEmail)}
                  onClick={() => onUninvite(invite.email)}
                  className="rounded-md border border-red-300/40 px-2 py-1 text-xs text-danger hover:bg-red-500/10 disabled:opacity-60"
                >
                  {busyEmail === invite.email ? "..." : "Uninvite"}
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </>
  );
}
