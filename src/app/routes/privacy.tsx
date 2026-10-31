import type { Route } from "./+types/privacy";
import { Privacy } from "../components/Privacy";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Privacy | 4Nguru",
    description: "What 4Nguru The Brand Online collects when you shop with us, why, and how to ask about it.",
    path: location.pathname,
    canonical: location.pathname,
  });

export default function PrivacyRoute() {
  return <Privacy />;
}
