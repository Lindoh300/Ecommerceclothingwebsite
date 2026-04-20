import { createBrowserRouter } from "react-router";
import { Root } from "./components/Root";
import { Home } from "./components/Home";
import { CategoryPage } from "./components/CategoryPage";
import { ProductDetail } from "./components/ProductDetail";
import { Cart } from "./components/Cart";
import { Admin } from "./components/Admin";
import { NotFound } from "./components/NotFound";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: Home },
      { path: "tshirts", Component: () => <CategoryPage category="tshirts" /> },
      { path: "jerseys", Component: () => <CategoryPage category="jerseys" /> },
      { path: "shorts", Component: () => <CategoryPage category="shorts" /> },
      { path: "pants", Component: () => <CategoryPage category="pants" /> },
      { path: "accessories", Component: () => <CategoryPage category="accessories" /> },
      { path: "product/:id", Component: ProductDetail },
      { path: "cart", Component: Cart },
      { path: "admin", Component: Admin },
      { path: "*", Component: NotFound },
    ],
  },
]);
