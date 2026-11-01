/** Light or dark page. Dark is the attribute data-mode="dark" on <html>; light is no attribute. Gallery theme only. */
export const MODE_KEY = "clothing_store_mode";
export type Mode = "light" | "dark";

/** Inline script for <head>: runs before first paint so a saved dark choice never flashes light. */
export const MODE_SCRIPT = `try{if(localStorage.getItem("${MODE_KEY}")==="dark"){document.documentElement.dataset.mode="dark"}}catch(e){}`;

/** Browser only: call from effects. */
export function readMode(): Mode {
  return document.documentElement.dataset.mode === "dark" ? "dark" : "light";
}

/** Switches the page, then tries to remember it. A blocked storage still leaves the page switched. */
export function applyMode(mode: Mode): void {
  if (mode === "dark") document.documentElement.dataset.mode = "dark";
  else delete document.documentElement.dataset.mode;
  try {
    localStorage.setItem(MODE_KEY, mode);
  } catch {
    // storage blocked: the choice lasts until reload
  }
}
