import type { Route } from "./+types/unsubscribe";
import { Unsubscribe } from "../components/Unsubscribe";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Unsubscribe | 4Nguru",
    description: "Leave the 4Nguru mailing list.",
    path: location.pathname,
    noindex: true,
  });

export default function UnsubscribeRoute() {
  return <Unsubscribe />;
}
