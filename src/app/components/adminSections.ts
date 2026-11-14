import type { ComponentType } from "react";

// What every admin section is given, and how to link to one. The list of sections itself (ADMIN_SECTIONS)
// is in Admin.tsx. This file has only types and a helper, so a section can import it without a cycle.

export interface AdminSectionProps {
  /** Shows a failed API call to the admin; a 401 signs them out. */
  onApiError: (err: unknown) => void;
}

export interface AdminSection {
  /** The value of the `?section=` search parameter. Keep it short, lowercase and stable: it is in bookmarks. */
  id: string;
  /** The tab text. */
  label: string;
  Component: ComponentType<AdminSectionProps>;
}

/** The search parameter that holds the current section. */
export const SECTION_PARAM = "section";

/** A relative link to a section, with any extra search parameters (for example `{ filter: "to_pack" }`). */
export function sectionHref(id: string, extra: Record<string, string> = {}): string {
  return `?${new URLSearchParams({ [SECTION_PARAM]: id, ...extra }).toString()}`;
}
