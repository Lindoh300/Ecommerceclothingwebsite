import { createBrowserRouter, useParams } from "react-router";
import { Root } from "./components/Root";
import { LEGACY_CATEGORY_IDS } from "./utils/categoryPath";

// Pages load on demand so the entry chunk stays small on mobile data.

function RootHydrateFallback() {
  return <div className="min-h-screen" />;
}

// Legacy paths (/tshirts etc.) keep working. Their ids live in utils/categoryPath.ts, which the
// nav also uses. Every other category is served by category/:id.
const categoryRoute = (id: string) => ({
  path: id,
  lazy: async () => {
    const { CategoryPage } = await import("./components/CategoryPage");
    return { Component: () => <CategoryPage id={id} /> };
  },
});

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    HydrateFallback: RootHydrateFallback,
    children: [
      { index: true, lazy: async () => ({ Component: (await import("./components/Home")).Home }) },
      ...LEGACY_CATEGORY_IDS.map(categoryRoute),
      {
        path: "category/:id",
        lazy: async () => {
          const { CategoryPage } = await import("./components/CategoryPage");
          return {
            Component: function CategoryRoute() {
              const { id } = useParams();
              return <CategoryPage id={id ?? ""} />;
            },
          };
        },
      },
      { path: "product/:id", lazy: async () => ({ Component: (await import("./components/ProductDetail")).ProductDetail }) },
      { path: "cart", lazy: async () => ({ Component: (await import("./components/Cart")).Cart }) },
      { path: "admin", lazy: async () => ({ Component: (await import("./components/Admin")).Admin }) },
      { path: "about", lazy: async () => ({ Component: (await import("./components/About")).About }) },
      { path: "customer-service", lazy: async () => ({ Component: (await import("./components/CustomerService")).CustomerService }) },
      { path: "*", lazy: async () => ({ Component: (await import("./components/NotFound")).NotFound }) },
    ],
  },
]);
