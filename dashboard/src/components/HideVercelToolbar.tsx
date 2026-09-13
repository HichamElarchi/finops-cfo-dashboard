"use client";

import { useEffect } from "react";

const SELECTOR = [
  'iframe[src*="vercel.live"]',
  'iframe[src*="vercel.com"]',
  "vercel-live-feedback",
  "[data-vercel-toolbar]",
  "#vercel-live-feedback",
].join(",");

export function HideVercelToolbar() {
  useEffect(() => {
    const remove = () => {
      document.querySelectorAll(SELECTOR).forEach((node) => node.remove());
    };
    remove();
    const observer = new MutationObserver(remove);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);
  return null;
}
