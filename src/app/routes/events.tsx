import type { Route } from "./+types/events";
import { Events } from "../components/Events";
import { SITE_NAME, originFromMatches, pageMeta } from "../lib/seo";

// No loader: events load in the browser. Event links are previewed through /event/:slug.
export const meta: Route.MetaFunction = ({ matches }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: `Events | ${SITE_NAME}`,
    description: "Upcoming 4Nguru events. RSVP for free tickets or get tickets on WhatsApp.",
    path: "/events",
    canonical: "/events",
  });

export default function EventsRoute() {
  return <Events />;
}
