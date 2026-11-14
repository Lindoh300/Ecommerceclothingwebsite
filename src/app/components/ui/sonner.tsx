"use client";

import { useEffect, useState } from "react";
import { Toaster as Sonner, ToasterProps } from "sonner";
import { readMode, type Mode } from "../../config/mode";

// Follows the site's own light/dark mode (data-mode on <html>), not the device setting.
const Toaster = ({ ...props }: ToasterProps) => {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    setMode(readMode());
    const observer = new MutationObserver(() => setMode(readMode()));
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-mode"],
    });
    return () => observer.disconnect();
  }, []);

  return (
    <Sonner
      theme={mode}
      className="toaster group"
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
        } as React.CSSProperties
      }
      {...props}
    />
  );
};

export { Toaster };
