// An in-memory InstagramProvider for tests and the local dev server. It talks to nobody. Instagram's own wire format
// is only in instagram.ts, and tested there against a stubbed fetch.
import type { InstagramProvider, TaggedMedia } from './types.ts';

export interface FakeInstagram extends InstagramProvider {
  /** The posts listTagged answers with, in the order given (the sync sorts them). */
  media: TaggedMedia[];
  /** Replace the posts. */
  setMedia(media: TaggedMedia[]): void;
  /** The next listTagged calls throw this (until cleared with null). */
  failList(error: Error | null): void;
  /** download throws for the posts with these ids (replaces the earlier set; pass [] to clear). */
  failDownloads(ids: Iterable<string>): void;
  /** How many times listTagged was called. */
  readonly listCalls: number;
  /** Every download() URL, in order. */
  readonly downloads: string[];
}

const BASE_MS = Date.parse('2026-10-31T12:00:00Z');
const HOUR_MS = 3_600_000;

/** Instagram's timestamp text: 2026-11-01T10:00:00+0000. */
export function instagramTime(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, '+0000');
}

/** The URL of a fake post's picture. It is on an allowed Instagram host, so instagram.ts would accept it. */
export const fakeImageUrl = (id: string) => `https://scontent.cdninstagram.com/fake/${id}.jpg`;

/** Eight tagged posts, newest first, with numeric ids falling with the time. The third is a VIDEO. */
export function sampleTagged(): TaggedMedia[] {
  return Array.from({ length: 8 }, (_, i): TaggedMedia => {
    // BigInt: these ids are past 2^53.
    const id = String(17_900_000_000_000_100n - BigInt(i));
    return {
      id,
      mediaType: i === 2 ? 'VIDEO' : i === 4 ? 'CAROUSEL_ALBUM' : 'IMAGE',
      mediaUrl: fakeImageUrl(id),
      username: `sample.fit${i + 1}`,
      permalink: `https://www.instagram.com/p/sample${i + 1}/`,
      timestamp: instagramTime(BASE_MS - i * HOUR_MS),
    };
  });
}

/** A fake provider holding the eight samples. Tests change them with setMedia and break it with failList and
 *  failDownloads. */
export function createFakeInstagram(initial: TaggedMedia[] = sampleTagged()): FakeInstagram {
  let listError: Error | null = null;
  let failing = new Set<string>();
  let listCalls = 0;
  const downloads: string[] = [];
  const fake: FakeInstagram = {
    media: initial,
    setMedia(media) {
      fake.media = media;
    },
    failList(error) {
      listError = error;
    },
    failDownloads(ids) {
      failing = new Set(ids);
    },
    get listCalls() {
      return listCalls;
    },
    downloads,
    listTagged(limit) {
      listCalls++;
      if (listError) return Promise.reject(listError);
      return Promise.resolve(fake.media.slice(0, limit).map((m) => ({ ...m })));
    },
    download(url) {
      downloads.push(url);
      const id = fake.media.find((m) => m.mediaUrl === url)?.id ?? '';
      if (failing.has(id)) return Promise.reject(new Error('fake download failed'));
      return Promise.resolve(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], `${id}.jpg`, { type: 'image/jpeg' }));
    },
  };
  return fake;
}
