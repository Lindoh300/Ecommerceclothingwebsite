import type { Route } from "./+types/category";
import { CategoryPage } from "../components/CategoryPage";
import { categoryMeta, originFromMatches } from "../lib/seo";

export const meta: Route.MetaFunction = ({ matches, params, location }) =>
  categoryMeta(originFromMatches(matches), params.id ?? "", location.pathname);

export default function CategoryRoute({ params }: Route.ComponentProps) {
  return <CategoryPage id={params.id ?? ""} />;
}
