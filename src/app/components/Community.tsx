import { useCallback, useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { getGallery } from "../api/community";
import { listEvents } from "../api/events";
import type { PublicEvent, PublicGalleryItem } from "../api/types";
import { whatsappLink } from "../config/shop";
import { EventCard } from "./Events";
import { SubscribeForm } from "./SubscribeForm";
import { LoadState } from "./common/LoadState";
import { ProductImage } from "./common/ProductImage";

const errorText = (err: unknown, what: string) => (err instanceof Error ? err.message : `Could not load ${what}`);

/** Community: photos from events, past events, and the mailing-list sign-up. */
export function Community() {
  const [gallery, setGallery] = useState<PublicGalleryItem[] | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [past, setPast] = useState<PublicEvent[] | null>(null);
  const [pastError, setPastError] = useState<string | null>(null);
  const live = useRef(true);

  const loadGallery = useCallback(async () => {
    setGalleryError(null);
    try {
      const list = await getGallery();
      if (live.current) setGallery(list);
    } catch (err) {
      if (live.current) setGalleryError(errorText(err, "photos"));
    }
  }, []);

  const loadPast = useCallback(async () => {
    setPastError(null);
    try {
      const list = await listEvents(true);
      if (live.current) setPast(list);
    } catch (err) {
      if (live.current) setPastError(errorText(err, "past events"));
    }
  }, []);

  useEffect(() => {
    live.current = true;
    loadGallery();
    loadPast();
    return () => {
      live.current = false;
    };
  }, [loadGallery, loadPast]);

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1360px] mx-auto px-6 space-y-16 md:space-y-24">
        <header>
          <p className="page-kicker micro text-b60 mb-3">4Nguru</p>
          <h1 className="display h-sec mb-6">Community</h1>
          <p className="max-w-xl text-lg leading-[1.45] mb-8">
            Photos from our events, the nights that came before, and a way to hear about the next one.
          </p>
          <a
            href={whatsappLink("Hi 4Nguru! I'd like to chat about the community.")}
            target="_blank"
            rel="noopener noreferrer"
            className="cta"
          >
            <MessageCircle className="w-4 h-4" aria-hidden="true" />
            Chat with us on WhatsApp
          </a>
        </header>

        <section aria-labelledby="community-gallery">
          <h2 id="community-gallery" className="display h-mid mb-6">
            Gallery
          </h2>
          <LoadState loading={gallery === null && galleryError === null} error={galleryError} onRetry={loadGallery}>
            {gallery && gallery.length === 0 ? (
              <div className="border border-b10 r-card p-12 text-center">
                <p className="text-b60">Photos from our events will appear here.</p>
              </div>
            ) : (
              <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-6 xl:grid-cols-4">
                {(gallery ?? []).map((item) => (
                  <li key={item.id} className="min-w-0">
                    <figure>
                      <div className="aspect-square overflow-hidden bg-b5">
                        <ProductImage src={item.image} alt={item.caption || "Photo from a 4Nguru event"} />
                      </div>
                      {item.caption && <figcaption className="mt-2 text-sm text-b60 break-words">{item.caption}</figcaption>}
                    </figure>
                  </li>
                ))}
              </ul>
            )}
          </LoadState>
        </section>

        <section aria-labelledby="community-past">
          <h2 id="community-past" className="display h-mid mb-6">
            Past events
          </h2>
          <LoadState loading={past === null && pastError === null} error={pastError} onRetry={loadPast}>
            {past && past.length === 0 ? (
              <div className="border border-b10 r-card p-12 text-center">
                <p className="text-b60">Past events will be listed here.</p>
              </div>
            ) : (
              <div className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {(past ?? []).map((e) => (
                  <EventCard key={e.id} event={e} />
                ))}
              </div>
            )}
          </LoadState>
        </section>

        <section aria-labelledby="community-join" className="max-w-xl">
          <h2 id="community-join" className="display h-mid mb-3">
            Join the list
          </h2>
          <p className="text-b60 mb-6">News about new drops and events. Leave your phone number or email.</p>
          <SubscribeForm source="community" />
        </section>
      </div>
    </div>
  );
}
