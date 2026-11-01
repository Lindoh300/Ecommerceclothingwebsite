import type { Route } from "./+types/community";
import { Community } from "../components/Community";
import { SITE_NAME, originFromMatches, pageMeta } from "../lib/seo";

// No loader: the gallery and fit wall load in the browser.
export const meta: Route.MetaFunction = ({ matches }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: `Community | ${SITE_NAME}`,
    description: "Photos from 4Nguru events, your fits, and a mailing list for news about new drops and events.",
    path: "/community",
    canonical: "/community",
  });

export default function CommunityRoute() {
  return <Community />;
}
