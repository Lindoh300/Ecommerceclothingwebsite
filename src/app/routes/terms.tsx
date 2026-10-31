import type { Route } from "./+types/terms";
import { Terms } from "../components/Terms";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Terms | 4Nguru",
    description: "Terms for buying from 4Nguru The Brand Online: prices in Rand, order confirmation, stock holds and delivery fees.",
    path: location.pathname,
    canonical: location.pathname,
  });

export default function TermsRoute() {
  return <Terms />;
}
