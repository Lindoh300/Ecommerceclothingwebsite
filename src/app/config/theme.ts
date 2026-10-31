/** Optional build-time theme: VITE_THEME names a [data-theme] block. */
export const theme: string | undefined = import.meta.env.VITE_THEME || undefined;
export const isGallery = theme === "gallery";
