import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { Plus, Edit, Trash2, Lock } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "sonner";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { ApiError } from "../api/client";
import { deleteProduct, listAllProducts } from "../api/products";
import { listCategories } from "../api/categories";
import type { Category, Product } from "../api/types";
import { loadProducts } from "../hooks/useProducts";
import { loadCategories } from "../hooks/useCategories";
import { AdminOrders } from "./AdminOrders";
import { AdminCategories } from "./AdminCategories";
import { AdminProductForm } from "./AdminProductForm";

// Local dev server: no Supabase, but an API base. Writes use the dev-admin token.
const devMode = !isSupabaseConfigured && !!import.meta.env.VITE_API_BASE;

function AdminNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center py-16 px-6">
      <div className="max-w-md w-full border border-b10 r-card p-8 md:p-10 text-center">
        <Lock className="w-6 h-6 text-ink mx-auto mb-6" />
        <h1 className="display h-mid mb-4">Admin</h1>
        {children}
      </div>
    </div>
  );
}

export function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [authLoading, setAuthLoading] = useState(!!supabase);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signingIn, setSigningIn] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) setSession(data.session);
      })
      .catch(() => {
        if (!cancelled) setSession(null);
      })
      .finally(() => {
        if (!cancelled) setAuthLoading(false);
      });
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });
    return () => {
      cancelled = true;
      data.subscription.unsubscribe();
    };
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supabase || signingIn) return;
    setSigningIn(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) toast.error(error.message);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign in failed");
    } finally {
      setPassword("");
      setSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    if (!supabase) return;
    const { error } = await supabase.auth.signOut();
    if (error) toast.error(error.message);
  };

  if (devMode) {
    return <AdminPanel />;
  }

  if (!isSupabaseConfigured) {
    return (
      <AdminNotice>
        <p className="text-b60">
          Admin isn't configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in .env (see
          docs/SUPABASE_SETUP.md).
        </p>
      </AdminNotice>
    );
  }

  if (authLoading) {
    return (
      <AdminNotice>
        <p className="text-b60">Loading…</p>
      </AdminNotice>
    );
  }

  if (!session) {
    return (
      <div className="min-h-screen bg-paper flex items-center justify-center py-16 px-6">
        <div className="max-w-md w-full border border-b10 r-card p-8 md:p-10">
          <div className="text-center mb-8">
            <Lock className="w-6 h-6 text-ink mx-auto mb-6" />
            <h1 className="display h-mid mb-4">Admin</h1>
            <p className="text-b60">Sign in to access the admin panel</p>
          </div>
          <form onSubmit={handleLogin}>
            <div className="mb-6">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter admin email"
                autoComplete="email"
                required
                autoFocus
              />
            </div>
            <div className="mb-6">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                autoComplete="current-password"
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={signingIn}>
              {signingIn ? "Signing in…" : "Login"}
            </Button>
          </form>
        </div>
      </div>
    );
  }

  // app_metadata can only be set server-side; user_metadata is user-editable and must not be used.
  if (session.user.app_metadata?.role !== "admin") {
    return (
      <AdminNotice>
        <p className="text-b60 mb-8">This account doesn't have admin access.</p>
        <Button onClick={handleSignOut} variant="outline">
          Sign out
        </Button>
      </AdminNotice>
    );
  }

  return (
    <AdminPanel
      email={session.user.email ?? ""}
      onSignOut={handleSignOut}
    />
  );
}

interface AdminPanelProps {
  email?: string;
  onSignOut?: () => void;
}

function AdminPanel({ email, onSignOut }: AdminPanelProps) {
  // Admin lists include inactive products and categories, so they are kept apart from the shop's cache.
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [categoriesError, setCategoriesError] = useState<string | null>(null);
  // null = form closed, "new" = adding, otherwise the product being edited.
  const [formFor, setFormFor] = useState<Product | "new" | null>(null);
  const [busy, setBusy] = useState(false);

  const handleApiError = (err: unknown) => {
    if (err instanceof ApiError && err.status === 401 && onSignOut) {
      toast.error("Session expired, please sign in again");
      onSignOut();
    } else if (err instanceof ApiError && err.status === 403) {
      toast.error("Not authorised");
    } else {
      toast.error(err instanceof Error ? err.message : "Something went wrong");
    }
  };

  // Returns the fresh list, or null if it could not be loaded.
  const refreshProducts = useCallback(async (): Promise<Product[] | null> => {
    setLoading(true);
    setError(null);
    try {
      const list = await listAllProducts();
      setProducts(list);
      return list;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshCategories = useCallback(async () => {
    setCategoriesLoading(true);
    setCategoriesError(null);
    try {
      setCategories(await listCategories(true));
    } catch (err) {
      setCategoriesError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setCategoriesLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProducts().catch(() => {});
    refreshCategories().catch(() => {});
  }, [refreshProducts, refreshCategories]);

  // After a product change: the admin list and the shop's cache both reload.
  const reloadProducts = async () => {
    const list = await refreshProducts();
    await loadProducts(true).catch(() => {});
    if (!list) throw new Error("Couldn't reload products");
  };

  const reloadCategories = async () => {
    await refreshCategories();
    await loadCategories(true).catch(() => {});
  };

  const handleEdit = async (product: Product) => {
    // Open with fresh stock: an order may have come in since the list was loaded.
    const list = await refreshProducts();
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
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? id;
  const editing = typeof formFor === "object" ? formFor : null;

  return (
    <div className="min-h-screen bg-paper">
      <div className="max-w-[1968px] mx-auto px-6 py-16">
        {devMode && (
          <div className="border border-b10 px-4 py-3 mb-8 font-mono text-sm text-b60">
            Local dev mode: writes use the dev-admin token
          </div>
        )}
        {onSignOut && (
          <div className="flex flex-wrap justify-end items-center gap-4 mb-8">
            <span className="font-mono text-sm text-ink">{email}</span>
            <Button onClick={onSignOut} variant="outline">
              Sign out
            </Button>
          </div>
        )}
        <div className="flex flex-wrap justify-between items-end gap-6 pb-12 mb-16 border-b border-b10">
          <div>
            <p className="micro text-b60 mb-6">Admin</p>
            <h1 className="display h-sec">Admin Panel</h1>
          </div>
          <div className="flex gap-2">
            <Button onClick={() => setFormFor("new")} disabled={formFor !== null}>
              <Plus className="w-4 h-4 mr-2" />
              Add Product
            </Button>
          </div>
        </div>

        {/* Add/Edit Form. The key gives each product its own form state. */}
        {formFor !== null && (
          <AdminProductForm
            key={editing ? editing.id : "new"}
            product={editing}
            categories={categories}
            categoriesError={categoriesError}
            onRetryCategories={() => refreshCategories().catch(() => {})}
            onReload={reloadProducts}
            onClose={() => setFormFor(null)}
            onApiError={handleApiError}
          />
        )}

        {/* Products List */}
        <div className="border border-b10 r-card overflow-x-auto">
          {loading && products.length === 0 && (
            <p className="px-6 py-4 micro text-b60">Loading products…</p>
          )}
          {error && (
            <div className="px-6 py-4 flex flex-wrap items-center gap-4">
              <p className="text-b60">Couldn't load products: {error}</p>
              <Button variant="outline" onClick={() => refreshProducts().catch(() => {})}>
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
              {products.map((product) => (
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
                        {!product.active && <div className="micro text-prism">Inactive</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap micro text-b60">{categoryName(product.category)}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-ink">R{product.price}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-ink">{product.stock}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(product).catch(() => {})}
                        disabled={formFor !== null}
                        aria-label={`Edit ${product.name}`}
                        className="p-1 text-ink hover:text-prism transition-colors disabled:opacity-50"
                      >
                        <Edit className="w-6 h-6" />
                      </button>
                      <button
                        onClick={() => handleDelete(product.id, product.name)}
                        disabled={busy}
                        aria-label={`Delete ${product.name}`}
                        className="p-1 text-ink hover:text-prism transition-colors disabled:opacity-50"
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

        <div className="mt-16">
          <AdminCategories
            categories={categories}
            loading={categoriesLoading}
            error={categoriesError}
            onChanged={reloadCategories}
            onApiError={handleApiError}
          />
        </div>

        <div className="mt-16">
          <AdminOrders onApiError={handleApiError} />
        </div>
      </div>
    </div>
  );
}
