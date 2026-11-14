// Fills the "Your fit, here" wall from the posts other people tag the shop in on Instagram. The wall holds the
// FIT_WALL_SIZE newest photo posts; a newer post pushes the oldest off. Only codes are logged, never a username,
// a URL or a token. When Instagram cannot be reached nothing stored is touched, so an outage leaves the wall alone.
import type { AdminFitPhoto, Deps, TaggedMedia } from './types.ts';

export const FIT_WALL_SIZE = 6;
export const FIT_FETCH_LIMIT = 25;
/** A visitor's page load starts a sync at most this often (seconds). */
export const FIT_PUBLIC_MIN_AGE = 900;
/** The owner's Sync now button and a hide or show always run. */
export const FIT_ADMIN_MIN_AGE = 0;

export type FitSyncResult = 'off' | 'skipped' | 'ok' | 'failed';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const PHOTO_TYPES = new Set(['IMAGE', 'CAROUSEL_ALBUM']);
/** Instagram ids are digits. The id becomes part of a file path, so anything else is refused. */
const ID_RE = /^[0-9]{1,40}$/;

/** Instagram writes 2026-11-01T10:00:00+0000; not every engine reads +0000, so make it +00:00. null = unreadable. */
export function parseInstagramTime(raw: string): string | null {
  const fixed = raw.trim().replace(/([+-]\d{2})(\d{2})$/, '$1:$2');
  const ms = Date.parse(fixed);
  return Number.isNaN(ms) ? null : new Date(ms).toISOString();
}

/** Compares two digit strings as numbers, so a longer id is the larger one. */
const compareIds = (a: string, b: string) => (a.length !== b.length ? a.length - b.length : a < b ? -1 : a > b ? 1 : 0);

interface Candidate {
  media: TaggedMedia & { mediaUrl: string };
  postedAt: string;
}

function eligible(media: TaggedMedia[], hidden: Set<string>): Candidate[] {
  const out: Candidate[] = [];
  for (const m of media) {
    if (!PHOTO_TYPES.has(m.mediaType) || !m.mediaUrl || !ID_RE.test(m.id) || hidden.has(m.id)) continue;
    // A photo with no username or link cannot be credited, so it does not go on the wall.
    if (!m.username || !m.permalink) continue;
    const postedAt = parseInstagramTime(m.timestamp);
    if (!postedAt) continue;
    out.push({ media: m as Candidate['media'], postedAt });
  }
  return out.sort((a, b) => (a.postedAt < b.postedAt ? 1 : a.postedAt > b.postedAt ? -1 : compareIds(b.media.id, a.media.id)));
}

const log = (code: string) => console.error(`fit sync: ${code}`);

/** Removes a stored file. A failure is swallowed: the row is already gone, and a stray file does no harm. */
async function dropFile(deps: Deps, path: string): Promise<void> {
  try {
    await deps.removeFitImage(path);
  } catch {
    log('file_remove_failed');
  }
}

async function finish(deps: Deps, code: string): Promise<void> {
  try {
    await deps.fits.finishSync(code);
  } catch {
    log('finish_failed');
  }
}

/**
 * One sync. `minAgeSeconds` is how long since the last attempt must have passed (0 = always run).
 * 'off' = no Instagram credentials. 'skipped' = another sync ran too recently. 'failed' = Instagram could not be
 * read, or a photo could not be fetched or stored, or something unexpected broke; the code is in the sync status.
 * It never throws.
 */
export async function syncFits(deps: Deps, minAgeSeconds: number): Promise<FitSyncResult> {
  const instagram = deps.instagram;
  if (!instagram) return 'off';
  const { fits } = deps;
  try {
    if (!(await fits.claimSync(minAgeSeconds))) return 'skipped';
  } catch {
    log('claim_failed');
    return 'failed';
  }

  let tagged: TaggedMedia[];
  try {
    tagged = await instagram.listTagged(FIT_FETCH_LIMIT);
  } catch {
    log('fetch_failed');
    await finish(deps, 'fetch_failed');
    return 'failed';
  }

  try {
    const stored = await fits.listAdmin();
    const hidden = new Set(stored.filter((r) => r.hidden).map((r) => r.id));
    const shown = new Map<string, AdminFitPhoto>(stored.filter((r) => !r.hidden).map((r) => [r.id, r]));
    const keep = new Set<string>();
    let imageFailed = false;

    for (const { media, postedAt } of eligible(tagged, hidden)) {
      if (keep.size >= FIT_WALL_SIZE) break;
      const have = shown.get(media.id);
      if (have && have.image) {
        keep.add(media.id);
        continue;
      }
      let path = '';
      try {
        const file = await instagram.download(media.mediaUrl);
        const ext = EXT[file.type];
        if (!ext) throw new Error('not an image');
        path = `fits/${media.id}.${ext}`;
        const image = await deps.storeFitImage(path, file);
        const stored = await fits.upsert({
          id: media.id,
          image,
          path,
          username: media.username,
          permalink: media.permalink,
          postedAt,
        });
        if (!stored) {
          // Hidden since the list was read: the file is not wanted.
          await dropFile(deps, path);
          continue;
        }
        keep.add(media.id);
      } catch {
        // The next post fills this slot. Its file, if one was stored, is cleaned up.
        if (path) await dropFile(deps, path);
        imageFailed = true;
        log('image_failed');
      }
    }

    // Whatever is stored and not in the final set: the oldest, or a post deleted or untagged on Instagram.
    for (const row of shown.values()) {
      if (keep.has(row.id)) continue;
      await fits.remove(row.id);
      if (row.path) await dropFile(deps, row.path);
    }

    await finish(deps, imageFailed ? 'image_failed' : '');
    return imageFailed ? 'failed' : 'ok';
  } catch {
    log('sync_failed');
    await finish(deps, 'sync_failed');
    return 'failed';
  }
}
