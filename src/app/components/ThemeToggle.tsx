import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { applyMode, readMode, type Mode } from "../config/mode";
import { isGallery } from "../config/theme";

export function ThemeToggle() {
  // Starts light, as the server HTML does; the real mode is read after mount.
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    setMode(readMode());
  }, []);

  if (!isGallery) return null;

  const dark = mode === "dark";
  const toggle = () => {
    const next: Mode = dark ? "light" : "dark";
    applyMode(next);
    setMode(next);
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className="mode-toggle text-ink"
    >
      {dark ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
    </button>
  );
}
