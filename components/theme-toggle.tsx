"use client";

import { useLayoutEffect, useState } from "react";
import { RiMoonLine, RiSunLine } from "@remixicon/react";
import { Button } from "@/components/ui/button";

function getStoredTheme(): "dark" | "light" {
  if (typeof window === "undefined") return "light";
  const stored = localStorage.getItem("theme");
  if (stored === "dark" || stored === "light") return stored;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">("light");

  // Re-apply after React clears the class on the dev Strict Mode remount. No-op in production.
  useLayoutEffect(() => {
    const stored = getStoredTheme();
    setTheme(stored);
    document.documentElement.classList.toggle("dark", stored === "dark");
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    setTheme(next);
    localStorage.setItem("theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
  }

  return (
    <Button variant="outline" size="icon" onClick={toggle} aria-label="Toggle dark mode">
      {theme === "dark" ? <RiSunLine className="size-4" /> : <RiMoonLine className="size-4" />}
    </Button>
  );
}
