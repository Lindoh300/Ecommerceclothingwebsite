import { useLocation } from "react-router";
import type { Route } from "./+types/category-legacy";
import { CategoryPage } from "../components/CategoryPage";
import { categoryMeta, originFromMatches } from "../lib/seo";

// Serves the legacy paths (/tshirts, /jerseys ...). The category id is the path itself.
const idFromPath = (pathname: string) => pathname.replace(/^\/+|\/+$/g, "");

export const meta: Route.MetaFunction = ({ matches, location }) =>
  categoryMeta(originFromMatches(matches), idFromPath(location.pathname), location.pathname);

export default function LegacyCategoryRoute() {
  const { pathname } = useLocation();
  return <CategoryPage id={idFromPath(pathname)} />;
}
