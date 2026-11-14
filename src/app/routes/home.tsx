import type { Route } from "./+types/home";
import { Home } from "../components/Home";
import { homeMeta, originFromMatches } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches }) => homeMeta(originFromMatches(matches));

export default function HomeRoute() {
  return <Home />;
}
