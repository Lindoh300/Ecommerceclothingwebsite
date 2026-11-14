import type { Route } from "./+types/size-guide";
import { SizeGuide } from "../components/SizeGuide";
import { originFromMatches, pageMeta } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, location }) =>
  pageMeta({
    origin: originFromMatches(matches),
    title: "Size guide | 4Nguru",
    description: "Find your 4Nguru size: S, M, L and XL measurements.",
    path: location.pathname,
    canonical: location.pathname,
  });

export default function SizeGuideRoute() {
  return <SizeGuide />;
}
