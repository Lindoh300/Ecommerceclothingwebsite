import type { Route } from "./+types/returns";
import { Returns } from "../components/Returns";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Returns | 4Nguru",
    description: "How to exchange or return a 4Nguru item, and your rights as a customer in South Africa.",
    path: location.pathname,
    canonical: location.pathname,
  });

export default function ReturnsRoute() {
  return <Returns />;
}
