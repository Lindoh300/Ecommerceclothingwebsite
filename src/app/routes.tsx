import { createBrowserRouter } from "react-router";
import { Root } from "./components/Root";

// Pages load on demand so the entry chunk stays small on mobile data.

function RootHydrateFallback() {
  return <div className="min-h-screen" />;
}

const categoryRoute = (path: string, category: "tshirts" | "jerseys" | "shorts" | "pants" | "accessories") => ({
  path,
  lazy: async () => {
    const { CategoryPage } = await import("./components/CategoryPage");
    return { Component: () => <CategoryPage category={category} /> };
  },
});

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    HydrateFallback: RootHydrateFallback,
    children: [
      { index: true, lazy: async () => ({ Component: (await import("./components/Home")).Home }) },
      categoryRoute("tshirts", "tshirts"),
      categoryRoute("jerseys", "jerseys"),
      categoryRoute("shorts", "shorts"),
      categoryRoute("pants", "pants"),
      categoryRoute("accessories", "accessories"),
      { path: "product/:id", lazy: async () => ({ Component: (await import("./components/ProductDetail")).ProductDetail }) },
      { path: "cart", lazy: async () => ({ Component: (await import("./components/Cart")).Cart }) },
      { path: "admin", lazy: async () => ({ Component: (await import("./components/Admin")).Admin }) },
      { path: "about", lazy: async () => ({ Component: (await import("./components/About")).About }) },
      { path: "customer-service", lazy: async () => ({ Component: (await import("./components/CustomerService")).CustomerService }) },
      { path: "*", lazy: async () => ({ Component: (await import("./components/NotFound")).NotFound }) },
    ],
  },
]);
