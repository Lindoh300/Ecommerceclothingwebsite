import type { Route } from "./+types/track";
import { Track } from "../components/Track";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Track an order | 4Nguru",
    description: "Find your 4Nguru order with its reference and phone number.",
    path: location.pathname,
    noindex: true,
  });

export default function TrackRoute() {
  return <Track />;
}
