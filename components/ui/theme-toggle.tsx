"use client";

import { useSyncExternalStore } from "react";

// Light / dark / system. The choice is saved in localStorage and applied by
// the inline script in app/layout.tsx before the first paint (no flash).

type Theme = "system" | "light" | "dark";
const KEY = "ll-theme";
const listeners = new Set<() => void>();

function read(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}

function write(theme: Theme) {
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice still applies to this page view.
  }
  if (theme === "system") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function ThemeToggle({ className = "" }: { className?: string }) {
  const theme = useSyncExternalStore(subscribe, read, () => "system" as Theme);
  return (
    <label className={`inline-flex items-center gap-2 text-sm ${className}`}>
      <span>Theme</span>
      <select
        value={theme}
        onChange={(e) => write(e.target.value as Theme)}
        className="min-h-9 rounded-md border border-current bg-transparent px-2 text-current"
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
