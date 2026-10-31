/**
 * The wording next to the sign-up tick box. KEEP EQUAL to CONSENT_TEXT in
 * supabase/functions/server/community_routes.ts: the server stores its own copy as the consent record, and the
 * test in supabase/functions/server/community.test.ts fails if the two differ. This file has no imports so that
 * test can load it.
 */
export const CONSENT_TEXT =
  "Yes, I'd like 4Nguru to send me news about new drops and events. I can opt out at any time."
