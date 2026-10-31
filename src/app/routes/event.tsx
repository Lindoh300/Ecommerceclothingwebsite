import { data } from "react-router";
import type { Route } from "./+types/event";
import { EventDetail } from "../components/EventDetail";
import { getEvent } from "../api/events";
import { defaultMeta, eventMeta, originFromMatches, originOf } from "../lib/seo";

// A server loader, like routes/product.tsx, so an event link previews in WhatsApp and the page paints with the
// event on it. Approved in the plan for Phase E; other pages still get no loader without asking.
//   found    -> event, 200
//   missing  -> no event, 404 (draft, cancelled and unknown events look the same; the page shows "Event not found")
//   failed   -> no event, 200 (API down or not configured: the browser loads it as it does today)
const LOADER_TIMEOUT_MS = 4000;

// A slow API must not hold up the page: give up and let the browser load the event.
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const origin = originOf(request);
  try {
    const event = params.slug ? await withTimeout(getEvent(params.slug), LOADER_TIMEOUT_MS) : null;
    if (event) return { origin, event, missing: false };
    return data({ origin, event: null, missing: true }, { status: 404 });
  } catch {
    return { origin, event: null, missing: false };
  }
}

export const meta: Route.MetaFunction = ({ data: loaderData, matches, location }) => {
  if (loaderData?.event) return eventMeta(loaderData.origin, loaderData.event);
  const origin = loaderData?.origin ?? originFromMatches(matches);
  return defaultMeta(origin, location.pathname);
};

export default function EventRoute({ loaderData, params }: Route.ComponentProps) {
  // The key gives each event its own state when the visitor moves from one event page to another.
  return <EventDetail key={params.slug} initialEvent={loaderData.event} notFound={loaderData.missing} />;
}
