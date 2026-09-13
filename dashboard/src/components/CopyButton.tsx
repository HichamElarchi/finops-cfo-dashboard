"use client";

import { useState } from "react";

type CopyButtonProps = {
  value: string;
  label?: string;
  showLabel?: boolean;
};

export function CopyButton({ value, label = "Copy", showLabel = false }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (copied) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } finally {
      window.setTimeout(() => setCopied(false), 1200);
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      disabled={copied}
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-gray-700 hover:bg-gray-800 px-2 py-1.5 text-xs text-gray-300 disabled:opacity-100 disabled:text-emerald-300"
    >
      {copied ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path
            d="M5 12.5 9.5 17 19 7"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
          <rect x="9" y="9" width="11" height="11" rx="2" stroke="currentColor" strokeWidth="1.8" />
          <path
            d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"
            stroke="currentColor"
            strokeWidth="1.8"
          />
        </svg>
      )}
      {showLabel ? (copied ? "Copied" : label) : null}
    </button>
  );
}
