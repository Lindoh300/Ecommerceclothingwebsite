import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Instagram, MessageCircle } from "lucide-react";
import { getFits, getGallery } from "../api/community";
import { listEvents } from "../api/events";
import type { PublicEvent, PublicFitPhoto, PublicGalleryItem } from "../api/types";
import { shop, whatsappLink } from "../config/shop";
import { useProducts } from "../hooks/useProducts";
import { EventRow } from "./EventTiles";
import { FitWall } from "./FitWall";
import { SubscribeForm } from "./SubscribeForm";
import { LoadState } from "./common/LoadState";
import { ProductImage } from "./common/ProductImage";

const errorText = (err: unknown, what: string) => (err instanceof Error ? err.message : `Could not load ${what}`);

/** Community: upcoming events, photos, your fit, and the mailing-list sign-up. */
export function Community() {
  const [gallery, setGallery] = useState<PublicGalleryItem[] | null>(null);
  const [galleryError, setGalleryError] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<PublicEvent[]>([]);
  const [fits, setFits] = useState<PublicFitPhoto[]>([]);
  const { products } = useProducts();
  const spotted = products.filter((p) => p.active !== false && p.image).slice(0, 6);
  const placeholders = spotted.flatMap((p) => (p.image ? [p.image] : []));
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

  const loadUpcoming = useCallback(async () => {
    try {
      const list = await listEvents();
      if (live.current) setUpcoming(list);
    } catch {
      // Coming up is left out when it fails.
    }
  }, []);

  const loadFits = useCallback(async () => {
    try {
      const list = await getFits();
      if (live.current) setFits(list);
    } catch {
      // The wall keeps its placeholders when it fails.
    }
  }, []);

  useEffect(() => {
    live.current = true;
    loadGallery();
    loadUpcoming();
    loadFits();
    return () => {
      live.current = false;
    };
  }, [loadGallery, loadUpcoming, loadFits]);

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-[1360px] mx-auto px-6 space-y-16 md:space-y-24">
        <header>
          <p className="page-kicker micro text-b60 mb-3">4Nguru</p>
          <h1 className="display h-sec mb-4">Community</h1>
          <p className="page-sub">
            Photos from our events, your fits, and a way to hear about the next night.
          </p>
        </header>

        {upcoming.length > 0 && (
          <section aria-labelledby="community-coming">
            <div className="sec-head">
              <h2 id="community-coming" className="display h-sec">
                See you there
              </h2>
              <Link to="/events" className="linkr">
                All events
              </Link>
            </div>
            <ul>
              {upcoming.map((e) => (
                <li key={e.id}>
                  <EventRow event={e} />
                </li>
              ))}
            </ul>
          </section>
        )}

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
              <ul className="cm-photos">
                {(gallery ?? []).map((item) => (
                  <li key={item.id} className="cm-photo min-w-0">
                    <figure>
                      <ProductImage src={item.image} alt={item.caption || "Photo from a 4Nguru event"} />
                      {item.caption && <figcaption className="cm-photo-cap">{item.caption}</figcaption>}
                    </figure>
                  </li>
                ))}
              </ul>
            )}
          </LoadState>
        </section>

        <section aria-labelledby="community-fit">
          <h2 id="community-fit" className="display h-sec mb-4">Your fit, here</h2>
          <p className="page-sub mb-6">Wear it, post it, tag us, and your photo can land on this wall.</p>
          <FitWall photos={fits} placeholders={placeholders} />
          <a href={shop.social.instagram} target="_blank" rel="noopener noreferrer" className="cta cta-quiet">
            <Instagram className="w-4 h-4" aria-hidden="true" />
            Tag us on Instagram
          </a>
        </section>

        <section aria-labelledby="community-join" className="band-tile cm-join">
          <div>
            <h2 id="community-join" className="display h-sec mb-4">
              Join the list
            </h2>
            <p className="lede">News about new drops and events. Leave your phone number or email.</p>
          </div>
          <div className="cm-join-form">
            <SubscribeForm source="community" />
            <a
              href={whatsappLink("Hi 4Nguru! I'd like to chat about the community.")}
              target="_blank"
              rel="noopener noreferrer"
              className="cta cta-quiet"
            >
              <MessageCircle className="w-4 h-4" aria-hidden="true" />
              Chat with us on WhatsApp
            </a>
          </div>
        </section>
      </div>
    </div>
  );
}
