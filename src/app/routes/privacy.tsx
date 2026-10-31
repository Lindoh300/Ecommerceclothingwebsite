import type { Route } from "./+types/privacy";
import { Privacy } from "../components/Privacy";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Privacy | 4Nguru",
    description: "How 4Nguru The Brand Online handles your personal information under POPIA, and how to ask about it.",
    path: location.pathname,
    canonical: location.pathname,
  });

export default function PrivacyRoute() {
  return <Privacy />;
}
