import { useEffect, useRef, useState } from "react";
import { Save, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { AdminStockGrid, parseStock } from "./AdminStockGrid";
import { ApiError } from "../api/client";
import { createProduct, updateProduct, uploadImage } from "../api/products";
import type { Category, Product, ProductInput, StockConflict, Variant, VariantStockUpdate } from "../api/types";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

interface FormState {
  name: string;
  category: string;
  price: number;
  description: string;
  images: string[];
  sizes: string; // comma-separated text, parsed on submit
  colors: string; // comma-separated text, parsed on submit
  active: boolean;
  startingStock: number; // new products only
}

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

const variantLabel = (v: Variant) => [v.size, v.color].filter(Boolean).join(" ") || "Stock";

const stockMaps = (variants: Variant[]) => ({
  baseline: Object.fromEntries(variants.map((v) => [v.id, v.stock])) as Record<string, number>,
  values: Object.fromEntries(variants.map((v) => [v.id, String(v.stock)])) as Record<string, string>,
});

interface AdminProductFormProps {
  /** The product being edited, or null for a new one. */
  product: Product | null;
  /** Every category, inactive ones too. */
  categories: Category[];
  categoriesError: string | null;
  onRetryCategories: () => void;
  /** Reload the admin and shop product lists. */
  onReload: () => Promise<void>;
  /** Close the form. */
  onClose: () => void;
  onApiError: (err: unknown) => void;
}

export function AdminProductForm({
  product,
  categories,
  categoriesError,
  onRetryCategories,
  onReload,
  onClose,
  onApiError,
}: AdminProductFormProps) {
  const editing = product !== null;
  const [formData, setFormData] = useState<FormState>(() => {
    if (!product) {
      return {
        name: "",
        category: "",
        price: 0,
        description: "",
        images: ["", "", ""],
        sizes: "S, M, L, XL",
        colors: "Black, White",
        active: true,
        startingStock: 0,
      };
    }
    // Copy the array: product comes from a shared list and must not be mutated.
    const images = (product.images?.length ? [...product.images] : product.image ? [product.image] : []).slice(0, 3);
    while (images.length < 3) images.push("");
    return {
      name: product.name,
      category: product.category,
      price: product.price,
      description: product.description,
      images,
      sizes: product.sizes.join(", "),
      colors: product.colors.join(", "),
      active: product.active,
      startingStock: 0,
    };
  });
  // The stock grid: the variants as the server last reported them, and what is typed in each cell.
  const [variants, setVariants] = useState<Variant[]>(product?.variants ?? []);
  const [baseline, setBaseline] = useState<Record<string, number>>(() => stockMaps(product?.variants ?? []).baseline);
  const [values, setValues] = useState<Record<string, string>>(() => stockMaps(product?.variants ?? []).values);
  const [uploading, setUploading] = useState<boolean[]>([false, false, false]);
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  const isUploading = uploading.some(Boolean);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  // New product: pick the first active category once the list arrives.
  useEffect(() => {
    if (editing || formData.category) return;
    const first = categories.find((c) => c.active) ?? categories[0];
    if (first) setFormData((prev) => (prev.category ? prev : { ...prev, category: first.id }));
  }, [editing, formData.category, categories]);

  const setImage = (index: number, value: string) => {
    setFormData((prev) => {
      const images = [...prev.images];
      images[index] = value;
      return { ...prev, images };
    });
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

    const setSlot = (value: boolean) =>
      setUploading((prev) => prev.map((v, i) => (i === index ? value : v)));

    setSlot(true);
    try {
      const url = await uploadImage(file);
      if (!alive.current) return;
      setImage(index, url);
      toast.success(`Image ${index + 1} uploaded successfully`);
    } catch (err) {
      if (alive.current) onApiError(err);
    } finally {
      if (alive.current) setSlot(false);
    }
  };

  // The server's stock won over what was typed: show its numbers, keep the rest of the form.
  // Cells the server changed take its value; cells it did not change keep what was typed.
  const applyConflict = (body: StockConflict) => {
    const server = new Map((body.variants ?? []).map((v) => [v.id, v.stock]));
    const moved = variants.filter((v) => server.has(v.id) && server.get(v.id) !== baseline[v.id]);
    setVariants((prev) => prev.map((v) => (server.has(v.id) ? { ...v, stock: server.get(v.id)! } : v)));
    setBaseline((prev) => ({ ...prev, ...Object.fromEntries(server) }));
    setValues((prev) => ({
      ...prev,
      ...Object.fromEntries(moved.map((v) => [v.id, String(server.get(v.id))])),
    }));
    const shown = moved.slice(0, 4).map((v) => `${variantLabel(v)} ${server.get(v.id)}`);
    const more = moved.length - shown.length;
    toast.error("Stock changed", {
      description: `An order came in while you were editing. Stock is now ${body.stock} in total${
        shown.length ? ` (${shown.join(", ")}${more > 0 ? `, and ${more} more` : ""})` : ""
      }. Check the numbers and save again.`,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || isUploading) return;

    const name = formData.name.trim();
    const sizes = splitList(formData.sizes);
    const colors = splitList(formData.colors);
    const price = Number(formData.price);
    const startingStock = Number(formData.startingStock);
    const images = formData.images.map((u) => u.trim());

    if (!name) {
      toast.error("Product name is required");
      return;
    }
    if (!formData.category) {
      toast.error("Choose a category");
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
    if (!editing && (!Number.isInteger(startingStock) || startingStock < 0)) {
      toast.error("Starting stock must be a whole number of 0 or more");
      return;
    }
    if (images.some((u) => u !== "" && !isHttpUrl(u))) {
      toast.error("Image URLs must start with http:// or https://");
      return;
    }

    // Send only the variants that were changed, and only those that survive the new size and
    // colour lists (the server moves the stock of the others).
    const kept = variants.filter(
      (v) => (v.size === "" || sizes.includes(v.size)) && (v.color === "" || colors.includes(v.color)),
    );
    const updates: VariantStockUpdate[] = [];
    for (const v of kept) {
      const next = parseStock(values[v.id] ?? "");
      if (next === null) {
        toast.error(`Stock for ${variantLabel(v)} must be a whole number of 0 or more`);
        return;
      }
      if (next !== baseline[v.id]) updates.push({ id: v.id, stock: next, expectedStock: baseline[v.id] });
    }

    const fields = {
      name,
      category: formData.category,
      price,
      description: formData.description,
      images,
      sizes,
      colors,
    };

    setBusy(true);
    try {
      if (product) {
        await updateProduct(product.id, { ...fields, active: formData.active }, { variants: updates });
      } else {
        const input: ProductInput = { ...fields, stock: startingStock };
        const created = await createProduct(input);
        if (!formData.active) {
          // The server creates every product active, so switch it off straight after.
          try {
            await updateProduct(created.id, { active: false });
          } catch (err) {
            onApiError(err);
            toast.error("Product was added but is still active");
          }
        }
      }
      await onReload();
      toast.success(editing ? "Product updated successfully" : "Product added successfully");
      onClose();
    } catch (err) {
      const body = err instanceof ApiError && err.status === 409 ? (err.body as StockConflict | undefined) : undefined;
      if (editing && body && typeof body.stock === "number" && Array.isArray(body.variants)) {
        applyConflict(body);
        try {
          await onReload();
        } catch (refreshErr) {
          onApiError(refreshErr);
        }
      } else {
        onApiError(err);
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  // A category the product already has stays selectable even if it is no longer in the list.
  const categoryOptions =
    formData.category && !categories.some((c) => c.id === formData.category)
      ? [...categories, { id: formData.category, name: formData.category, sort: 0, active: false }]
      : categories;

  return (
    <div className="border border-b10 r-card p-6 md:p-8 mb-16">
      <h2 className="display h-mid mb-8">{editing ? "Edit Product" : "Add New Product"}</h2>
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
              onValueChange={(value) => setFormData({ ...formData, category: value })}
            >
              <SelectTrigger id="category">
                <SelectValue placeholder={categoriesError ? "Categories unavailable" : "Choose a category"} />
              </SelectTrigger>
              <SelectContent>
                {categoryOptions.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                    {c.active ? "" : " (inactive)"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {categoriesError && (
              <p className="text-sm text-b60 mt-1">
                Couldn't load categories: {categoriesError}{" "}
                <button type="button" onClick={onRetryCategories} className="linkr text-ink">
                  Try again
                </button>
              </p>
            )}
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
          {!editing && (
            <div>
              <Label htmlFor="startingStock">Starting stock</Label>
              <Input
                id="startingStock"
                type="number"
                value={formData.startingStock}
                onChange={(e) => setFormData({ ...formData, startingStock: Number(e.target.value) })}
                required
                min="0"
                step="1"
              />
              <p className="text-sm text-b60 mt-1">Split evenly over every size and colour. Adjust each one after saving.</p>
            </div>
          )}
          <div className="md:col-span-2">
            <label htmlFor="active" className="flex items-center gap-3 cursor-pointer w-fit">
              <input
                id="active"
                type="checkbox"
                checked={formData.active}
                onChange={(e) => setFormData({ ...formData, active: e.target.checked })}
                className="h-5 w-5 accent-prism"
              />
              <span>Active (shown in the shop)</span>
            </label>
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
                    Image {index + 1} {index === 0 && "(Main)"}
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
          {editing && (
            <div className="md:col-span-2 min-w-0">
              <AdminStockGrid
                variants={variants}
                values={values}
                baseline={baseline}
                disabled={busy}
                onChange={(id, value) => setValues((prev) => ({ ...prev, [id]: value }))}
              />
              <p className="text-sm text-b60 mt-2">
                If you change the sizes or colours, new combinations start at 0 and the grid reloads after you save.
              </p>
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || isUploading}>
            <Save className="w-4 h-4 mr-2" />
            {busy ? "Saving…" : "Save Product"}
          </Button>
          <Button type="button" variant="outline" onClick={onClose}>
            <X className="w-4 h-4 mr-2" />
            Cancel
          </Button>
        </div>
      </form>
    </div>
  );
}
