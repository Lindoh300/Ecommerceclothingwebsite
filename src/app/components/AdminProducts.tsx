import { useState } from "react";
import { Plus, Edit, Trash2 } from "lucide-react";
import { Button } from "./ui/button";
import { toast } from "../lib/toast";
import { deleteProduct, listAllProducts } from "../api/products";
import { listCategories } from "../api/categories";
import type { Product } from "../api/types";
import { loadProducts } from "../hooks/useProducts";
import { useAdminList } from "../hooks/useAdminList";
import { AdminProductForm } from "./AdminProductForm";
import type { AdminSectionProps } from "./adminSections";

/** The Products section: every product (inactive ones too), with the add and edit form. */
export function AdminProducts({ onApiError }: AdminSectionProps) {
  // Admin lists include inactive products and categories, so they are kept apart from the shop's cache.
  const products = useAdminList(listAllProducts, onApiError);
  const categories = useAdminList(() => listCategories(true), onApiError);
  // null = form closed, "new" = adding, otherwise the product being edited.
  const [formFor, setFormFor] = useState<Product | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  // After a product change: the admin list and the shop's cache both reload.
  const reloadProducts = async () => {
    const list = await products.reload();
    await loadProducts(true).catch(() => {});
    if (!list) throw new Error("Couldn't reload products");
  };

  const handleEdit = async (product: Product) => {
    // Open with fresh stock: an order may have come in since the list was loaded.
    const list = await products.reload();
    setFormFor(list?.find((p) => p.id === product.id) ?? product);
  };

  const handleDelete = async (id: string, name: string) => {
    if (busy) return;
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteProduct(id);
      await reloadProducts();
      if (typeof formFor === "object" && formFor?.id === id) setFormFor(null);
      toast.success(`Deleted ${name}`);
    } catch (err) {
      onApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const categoryName = (id: string) => categories.data.find((c) => c.id === id)?.name ?? id;
  const editing = typeof formFor === "object" ? formFor : null;

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <h2 className="display h-mid">Products</h2>
        <Button onClick={() => setFormFor("new")} disabled={formFor !== null}>
          <Plus className="w-4 h-4 mr-2" />
          Add Product
        </Button>
      </div>

      {/* Add/Edit Form. The key gives each product its own form state. */}
      {formFor !== null && (
        <AdminProductForm
          key={editing ? editing.id : "new"}
          product={editing}
          categories={categories.data}
          categoriesError={categories.error}
          onRetryCategories={() => categories.reload().catch(() => {})}
          onReload={reloadProducts}
          onClose={() => setFormFor(null)}
          onApiError={onApiError}
        />
      )}

      {/* Products List */}
      <div className="border border-b10 r-card overflow-x-auto">
        {products.loading && products.data.length === 0 && (
          <p className="px-6 py-4 micro text-b60">Loading products…</p>
        )}
        {products.error && (
          <div className="px-6 py-4 flex flex-wrap items-center gap-4">
            <p className="text-b60">Couldn't load products: {products.error}</p>
            <Button variant="outline" onClick={() => products.reload().catch(() => {})}>
              Retry
            </Button>
          </div>
        )}
        <table className="min-w-full text-left">
          <thead>
            <tr className="border-b border-b10">
              <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Product</th>
              <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Category</th>
              <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Price</th>
              <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Stock</th>
              <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-b10">
            {products.data.map((product) => (
              <tr key={product.id} className={product.active ? "" : "bg-b5"}>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex items-center">
                    <img
                      src={product.image}
                      alt={product.name}
                      className="w-10 h-10 object-cover border border-b10 bg-b5"
                      onLoad={(e) => {
                        e.currentTarget.style.visibility = "visible";
                      }}
                      onError={(e) => {
                        e.currentTarget.style.visibility = "hidden";
                      }}
                    />
                    <div className={`ml-4 ${product.active ? "text-ink" : "text-b60"}`}>
                      <div>{product.name}</div>
                      {!product.active && <div className="micro text-brand">Inactive</div>}
                    </div>
                  </div>
                </td>
                <td className="px-6 py-4 whitespace-nowrap micro text-b60">{categoryName(product.category)}</td>
                <td className="px-6 py-4 whitespace-nowrap text-ink">R{product.price}</td>
                <td className="px-6 py-4 whitespace-nowrap text-ink">{product.stock}</td>
                <td className="px-6 py-4 whitespace-nowrap">
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEdit(product).catch(() => {})}
                      disabled={formFor !== null}
                      aria-label={`Edit ${product.name}`}
                      className="p-1 text-ink hover:text-b60 transition-colors disabled:opacity-50"
                    >
                      <Edit className="w-6 h-6" />
                    </button>
                    <button
                      onClick={() => handleDelete(product.id, product.name)}
                      disabled={busy}
                      aria-label={`Delete ${product.name}`}
                      className="p-1 text-ink hover:text-b60 transition-colors disabled:opacity-50"
                    >
                      <Trash2 className="w-6 h-6" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
