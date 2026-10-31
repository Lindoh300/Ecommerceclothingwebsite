/** Build-time theme. Gallery is the default; VITE_THEME names another [data-theme] block, and "plain" gives the unthemed look. */
const name: string = import.meta.env.VITE_THEME || "gallery";
export const theme: string | undefined = name === "plain" ? undefined : name;
export const isGallery = theme === "gallery";
