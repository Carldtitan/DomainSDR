"use client";

import { useEffect } from "react";
import { Moon, Sun } from "lucide-react";

export function ThemeToggle() {
  useEffect(() => {
    const stored = localStorage.getItem("domainsdr-theme");
    const shouldUseDark = stored === "dark" || (!stored && window.matchMedia("(prefers-color-scheme: dark)").matches);
    document.documentElement.classList.toggle("dark", shouldUseDark);
  }, []);

  function toggle() {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("domainsdr-theme", next ? "dark" : "light");
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-700 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-900"
      aria-label="Toggle dark mode"
      title="Toggle dark mode"
    >
      <Moon className="dark:hidden" size={16} />
      <Sun className="hidden dark:block" size={16} />
    </button>
  );
}
