// The Instagram boundary. This is the ONLY file that knows Meta: its URLs and response shape. fit_sync.ts and the
// routes talk to `InstagramProvider`.
//
// Contract used here (Instagram Graph API):
//   GET https://graph.facebook.com/<userId>/tags?fields=id,media_type,media_url,permalink,timestamp,username
//       &limit=<n>&access_token=<token>   -> 200 {data: [{id, media_type, media_url?, permalink, timestamp, username}]}
//   Only the first page is read. Any non-200 is a failure.
// Photos are fetched from the media_url Instagram gives. Only Instagram's own image hosts are fetched, over https.
//
// The token is only ever held inside the provider object and is never put in an error message. Underlying fetch
// errors are NOT passed on: Deno puts the full request URL, token included, in them.
import type { InstagramProvider, TaggedMedia } from './types.ts';

const GRAPH_URL = 'https://graph.facebook.com';
const FIELDS = 'id,media_type,media_url,permalink,timestamp,username';
const TIMEOUT_MS = 10_000;

/** The largest photo that is fetched. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const IMAGE_HOST_SUFFIXES = ['.cdninstagram.com', '.fbcdn.net'];

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** True only for an https URL on one of Instagram's image hosts. */
export function isInstagramImageUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  return u.protocol === 'https:' && IMAGE_HOST_SUFFIXES.some((s) => u.hostname.endsWith(s));
}

export function createInstagramProvider(
  token: string,
  userId: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): InstagramProvider {
  return {
    async listTagged(limit) {
      const url = `${GRAPH_URL}/${encodeURIComponent(userId)}/tags?${
        new URLSearchParams({ fields: FIELDS, limit: String(limit), access_token: token })
      }`;
      let res: Response;
      try {
        res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new Error('Instagram request failed');
      }
      if (res.status !== 200) {
        await res.body?.cancel().catch(() => {});
        throw new Error(`Instagram error (HTTP ${res.status})`);
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        throw new Error('Instagram answered with something unreadable');
      }
      if (!isRecord(json) || !Array.isArray(json.data)) throw new Error('Instagram answered with something unreadable');
      const out: TaggedMedia[] = [];
      for (const m of json.data) {
        if (!isRecord(m) || typeof m.id !== 'string' || m.id === '') continue;
        out.push({
          id: m.id,
          mediaType: text(m.media_type),
          mediaUrl: typeof m.media_url === 'string' && m.media_url !== '' ? m.media_url : null,
          username: text(m.username),
          permalink: text(m.permalink),
          timestamp: text(m.timestamp),
        });
      }
      return out;
    },

    async download(url) {
      if (!isInstagramImageUrl(url)) throw new Error('Instagram image URL refused');
      let res: Response;
      try {
        res = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(TIMEOUT_MS) });
      } catch {
        throw new Error('Instagram image request failed');
      }
      const discard = () => res.body?.cancel().catch(() => {});
      if (!res.ok) {
        await discard();
        throw new Error(`Instagram image error (HTTP ${res.status})`);
      }
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const ext = IMAGE_TYPES[type];
      if (!ext) {
        await discard();
        throw new Error('Instagram image is not a jpeg, png or webp');
      }
      const declared = Number(res.headers.get('content-length'));
      if (res.headers.get('content-length') !== null && declared > MAX_IMAGE_BYTES) {
        await discard();
        throw new Error('Instagram image is too large');
      }
      // Count the real bytes as they arrive: the header may be missing or wrong.
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        const reader = res.body?.getReader();
        if (reader) {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > MAX_IMAGE_BYTES) {
              await reader.cancel().catch(() => {});
              throw new Error('Instagram image is too large');
            }
            chunks.push(value);
          }
        }
      } catch (e) {
        if (e instanceof Error && e.message === 'Instagram image is too large') throw e;
        throw new Error('Instagram image request failed');
      }
      if (size === 0) throw new Error('Instagram image is empty');
      return new File(chunks as BlobPart[], `photo.${ext}`, { type });
    },
  };
}

/** null when the token or the user id is unset or blank: the fit wall is then off. */
export function loadInstagramProvider(token: string | undefined, userId: string | undefined): InstagramProvider | null {
  const t = token?.trim();
  const u = userId?.trim();
  if (!t || !u) return null;
  return createInstagramProvider(t, u);
}
