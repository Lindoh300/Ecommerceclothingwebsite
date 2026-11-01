import type { PublicFitPhoto } from "../api/types";

/** The wall always shows this many tiles: live photos first, placeholders for the rest. */
export const FIT_SLOTS = 6;

/**
 * "Your fit, here": tagged Instagram photos, newest first, then faded placeholders for the empty slots.
 * Photos are capped at FIT_SLOTS and keep the order they are given in.
 */
export function FitWall({ photos, placeholders }: { photos: PublicFitPhoto[]; placeholders: string[] }) {
  const live = photos.slice(0, FIT_SLOTS);
  const empty = Array.from({ length: FIT_SLOTS - live.length }, (_, i) => live.length + i);

  return (
    <ul className="cm-spot-grid">
      {live.map((p) => (
        <li key={p.id} className="cm-spot-tile cm-spot-live">
          <a
            href={p.permalink}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={p.username ? `Photo by @${p.username} on Instagram` : "Photo on Instagram"}
          >
            <img src={p.image} alt="" className="cm-spot-photo" loading="lazy" />
            <span className="cm-spot-tag">{p.username ? `@${p.username}` : "Instagram"}</span>
          </a>
        </li>
      ))}
      {empty.map((slot) => (
        <li key={`placeholder-${slot}`} aria-hidden="true" className="cm-spot-tile">
          {placeholders[slot] && <img src={placeholders[slot]} alt="" className="cm-spot-fig" />}
          <span className="cm-spot-tag">Your photo here</span>
        </li>
      ))}
    </ul>
  );
}
