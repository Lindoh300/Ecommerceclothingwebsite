import { useState, useEffect, useRef } from "react";
import type { Session } from "@supabase/supabase-js";
import { Plus, Edit, Trash2, Save, X, Lock } from "lucide-react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { toast } from "sonner";
import { supabase, isSupabaseConfigured } from "../lib/supabase";
import { ApiError } from "../api/client";
import { createProduct, updateProduct, deleteProduct, uploadImage } from "../api/products";
import type { Category, Product, ProductInput } from "../api/types";
import { useProducts, loadProducts } from "../hooks/useProducts";

// Local dev server: no Supabase, but an API base. Writes use the dev-admin token.
const devMode = !isSupabaseConfigured && !!import.meta.env.VITE_API_BASE;

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

interface FormState {
  name: string;
  category: Category;
  price: number;
  description: string;
  images: string[];
  sizes: string; // comma-separated text, parsed on submit
  colors: string; // comma-separated text, parsed on submit
  stock: number;
}

const emptyForm = (): FormState => ({
  name: "",
  category: "tshirts",
  price: 0,
  description: "",
  images: ["", "", ""],
  sizes: "S, M, L, XL",
  colors: "Black, White",
  stock: 0,
});

const splitList = (text: string): string[] =>
  text.split(",").map((s) => s.trim()).filter((s) => s);

const isHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

function AdminNotice({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-paper flex items-center justify-center py-16 px-6">
      <div className="max-w-md w-full border border-b10 p-8 md:p-10 text-center">
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
        <div className="max-w-md w-full border border-b10 p-8 md:p-10">
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
  const { products, loading, error, reload } = useProducts();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [formData, setFormData] = useState<FormState>(emptyForm());
  const [uploading, setUploading] = useState<boolean[]>([false, false, false]);
  const [busy, setBusy] = useState(false);
  // Bumped whenever the form is reset or switched, so a late upload result is not applied to a different form.
  const formGeneration = useRef(0);

  const isUploading = uploading.some(Boolean);

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

  const setImage = (index: number, value: string) => {
    setFormData((prev) => {
      const images = [...prev.images];
      images[index] = value;
      return { ...prev, images };
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || isUploading) return;

    const name = formData.name.trim();
    const sizes = splitList(formData.sizes);
    const colors = splitList(formData.colors);
    const price = Number(formData.price);
    const stock = Number(formData.stock);
    const images = formData.images.map((u) => u.trim());

    if (!name) {
      toast.error("Product name is required");
      return;
    }
    if (sizes.length === 0) {
      toast.error("Add at least one size");
      return;
    }
    if (colors.length === 0) {
      toast.error("Add at least one colour");
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      toast.error("Price must be a number of 0 or more");
      return;
    }
    if (!Number.isInteger(stock) || stock < 0) {
      toast.error("Stock must be a whole number of 0 or more");
      return;
    }
    if (images.some((u) => u !== "" && !isHttpUrl(u))) {
      toast.error("Image URLs must start with http:// or https://");
      return;
    }

    const input: ProductInput = {
      name,
      category: formData.category,
      price,
      description: formData.description,
      images,
      sizes,
      colors,
      stock,
    };

    setBusy(true);
    try {
      if (editing) {
        await updateProduct(editing, input);
      } else {
        await createProduct(input);
      }
      await loadProducts(true);
      toast.success(editing ? "Product updated successfully" : "Product added successfully");
      handleCancel();
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const handleEdit = (product: Product) => {
    formGeneration.current += 1;
    // Copy the array: product comes from the shared cache and must not be mutated.
    const images = (product.images?.length ? [...product.images] : [product.image]).slice(0, 3);
    while (images.length < 3) images.push("");
    setEditing(product.id);
    setFormData({
      name: product.name,
      category: product.category,
      price: product.price,
      description: product.description,
      images,
      sizes: product.sizes.join(", "),
      colors: product.colors.join(", "),
      stock: product.stock,
    });
    setUploading([false, false, false]);
    setAdding(false);
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>, index: number) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;

    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast.error("Image must be a JPEG, PNG, WebP or GIF file");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error("Image size should be less than 2MB");
      return;
    }

    const generation = formGeneration.current;
    const setSlot = (value: boolean) =>
      setUploading((prev) => prev.map((v, i) => (i === index ? value : v)));

    setSlot(true);
    try {
      const url = await uploadImage(file);
      if (generation !== formGeneration.current) return;
      setImage(index, url);
      toast.success(`Image ${index + 1} uploaded successfully`);
    } catch (err) {
      if (generation === formGeneration.current) handleApiError(err);
    } finally {
      if (generation === formGeneration.current) setSlot(false);
    }
  };

  const handleCancel = () => {
    formGeneration.current += 1;
    setEditing(null);
    setAdding(false);
    setUploading([false, false, false]);
    setFormData(emptyForm());
  };

  const handleDelete = async (id: string, name: string) => {
    if (busy) return;
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteProduct(id);
      await loadProducts(true);
      if (editing === id) {
        handleCancel();
      }
      toast.success(`Deleted ${name}`);
    } catch (err) {
      handleApiError(err);
    } finally {
      setBusy(false);
    }
  };

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
            <Button onClick={() => setAdding(true)} disabled={adding || editing !== null}>
              <Plus className="w-4 h-4 mr-2" />
              Add Product
            </Button>
          </div>
        </div>

        {/* Add/Edit Form */}
        {(adding || editing) && (
          <div className="border border-b10 p-6 md:p-8 mb-16">
            <h2 className="display h-mid mb-8">{editing ? 'Edit Product' : 'Add New Product'}</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="name">Product Name</Label>
                  <Input
                    id="name"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="category">Category</Label>
                  <Select
                    value={formData.category}
                    onValueChange={(value) => setFormData({ ...formData, category: value as Category })}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="tshirts">T-Shirts</SelectItem>
                      <SelectItem value="jerseys">Jerseys</SelectItem>
                      <SelectItem value="shorts">Shorts</SelectItem>
                      <SelectItem value="pants">Pants</SelectItem>
                      <SelectItem value="accessories">Accessories</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="price">Price (R)</Label>
                  <Input
                    id="price"
                    type="number"
                    value={formData.price}
                    onChange={(e) => setFormData({ ...formData, price: Number(e.target.value) })}
                    required
                    min="0"
                    step="0.01"
                  />
                </div>
                <div>
                  <Label htmlFor="stock">Stock</Label>
                  <Input
                    id="stock"
                    type="number"
                    value={formData.stock}
                    onChange={(e) => setFormData({ ...formData, stock: Number(e.target.value) })}
                    required
                    min="0"
                    step="1"
                  />
                </div>
                <div className="md:col-span-2">
                  <Label htmlFor="description">Description</Label>
                  <Textarea
                    id="description"
                    value={formData.description}
                    onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                    required
                  />
                </div>
                <div className="md:col-span-2">
                  <div className="flex flex-wrap justify-between items-end gap-2 mb-1">
                    <Label>Product Images (Max 3)</Label>
                    <span className="font-mono text-[11px] text-b60 border border-b10 px-2 py-1">
                      JPEG, PNG, WebP or GIF, up to 2MB each
                    </span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
                    {[0, 1, 2].map((index) => (
                      <div key={index} className="space-y-2">
                        <Label htmlFor={`imageFile-${index}`} className="text-xs text-b60">
                          Image {index + 1} {index === 0 && '(Main)'}
                        </Label>
                        <div className="flex flex-col gap-2">
                          <Input
                            id={`imageFile-${index}`}
                            type="file"
                            accept="image/jpeg,image/png,image/webp,image/gif"
                            onChange={(e) => handleImageUpload(e, index)}
                            disabled={uploading[index]}
                            className="text-xs"
                          />
                          <Input
                            value={formData.images[index] ?? ""}
                            onChange={(e) => setImage(index, e.target.value)}
                            placeholder="Or image URL"
                            className="text-xs"
                          />
                          {uploading[index] && (
                            <div className="aspect-square border border-b10 bg-b5 flex items-center justify-center font-mono text-xs text-b60">
                              Uploading…
                            </div>
                          )}
                          {!uploading[index] && formData.images[index] && (
                            <div className="aspect-square border border-b10 overflow-hidden bg-b5 relative group">
                              <img
                                src={formData.images[index]}
                                alt={`Preview ${index + 1}`}
                                className="w-full h-full object-cover"
                                onLoad={(e) => {
                                  e.currentTarget.style.visibility = "visible";
                                }}
                                onError={(e) => {
                                  e.currentTarget.style.visibility = "hidden";
                                }}
                              />
                              <button
                                type="button"
                                onClick={() => setImage(index, "")}
                                aria-label={`Remove image ${index + 1}`}
                                className="absolute top-1 right-1 bg-ink text-paper hover:bg-prism p-1 opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-3 h-3" />
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <div>
                  <Label htmlFor="sizes">Sizes (comma-separated)</Label>
                  <Input
                    id="sizes"
                    value={formData.sizes}
                    onChange={(e) => setFormData({ ...formData, sizes: e.target.value })}
                    placeholder="S, M, L, XL"
                  />
                </div>
                <div>
                  <Label htmlFor="colors">Colors (comma-separated)</Label>
                  <Input
                    id="colors"
                    value={formData.colors}
                    onChange={(e) => setFormData({ ...formData, colors: e.target.value })}
                    placeholder="Black, White, Blue"
                  />
                </div>
              </div>
              <div className="flex gap-2">
                <Button type="submit" disabled={busy || isUploading}>
                  <Save className="w-4 h-4 mr-2" />
                  {busy ? "Saving…" : "Save Product"}
                </Button>
                <Button type="button" variant="outline" onClick={handleCancel}>
                  <X className="w-4 h-4 mr-2" />
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}

        {/* Products List */}
        <div className="border border-b10 overflow-x-auto">
          {loading && products.length === 0 && (
            <p className="px-6 py-4 micro text-b60">Loading products…</p>
          )}
          {error && (
            <div className="px-6 py-4 flex flex-wrap items-center gap-4">
              <p className="text-b60">Couldn't load products: {error}</p>
              <Button variant="outline" onClick={() => reload().catch(() => {})}>
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
                <tr key={product.id}>
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
                      <div className="ml-4 text-ink">
                        <div>{product.name}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap micro text-b60">{product.category}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-ink">R{product.price}</td>
                  <td className="px-6 py-4 whitespace-nowrap font-mono text-ink">{product.stock}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleEdit(product)}
                        aria-label="Edit product"
                        className="p-1 text-ink hover:text-prism transition-colors"
                      >
                        <Edit className="w-6 h-6" />
                      </button>
                      <button
                        onClick={() => handleDelete(product.id, product.name)}
                        disabled={busy}
                        aria-label="Delete product"
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
      </div>
    </div>
  );
}
