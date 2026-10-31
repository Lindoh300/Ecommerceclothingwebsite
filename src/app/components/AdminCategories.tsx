import { useState } from "react";
import { Edit, Plus, Save, Trash2, X } from "lucide-react";
import { toast } from "../lib/toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ApiError } from "../api/client";
import { deleteCategory, listCategories, saveCategory } from "../api/categories";
import type { Category } from "../api/types";
import { loadCategories } from "../hooks/useCategories";
import { useAdminList } from "../hooks/useAdminList";
import type { AdminSectionProps } from "./adminSections";

// "Summer Tops!" -> "summer-tops". Matches the server's id rule (a-z, 0-9, hyphens, up to 40).
export const categoryIdFromName = (name: string): string =>
  name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "");

interface AdminCategoriesProps {
  /** Every category, inactive ones too. */
  categories: Category[];
  loading: boolean;
  error: string | null;
  /** Reload the admin list and the shop's category cache. */
  onChanged: () => Promise<void>;
  onApiError: (err: unknown) => void;
}

export function AdminCategories({ categories, loading, error, onChanged, onApiError }: AdminCategoriesProps) {
  const [newName, setNewName] = useState("");
  const [newSort, setNewSort] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editSort, setEditSort] = useState("");
  const [busy, setBusy] = useState(false);

  const nextSort = categories.reduce((max, c) => Math.max(max, c.sort), 0) + 1;

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const count = (err.body as { count?: number } | undefined)?.count;
        toast.error("Category is in use", {
          description:
            typeof count === "number"
              ? `${count} ${count === 1 ? "product uses" : "products use"} it. Move or delete them first.`
              : "Products still use it. Move or delete them first.",
        });
      } else {
        onApiError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const sortValue = (text: string, fallback: number): number | null => {
    if (text.trim() === "") return fallback;
    const n = Number(text);
    return Number.isInteger(n) ? n : null;
  };

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    const id = categoryIdFromName(name);
    const sort = sortValue(newSort, nextSort);
    if (!name || !id) {
      toast.error("Enter a category name with letters or digits");
      return;
    }
    if (sort === null) {
      toast.error("Sort must be a whole number");
      return;
    }
    // Saving to an existing id would overwrite that category.
    if (categories.some((c) => c.id === id)) {
      toast.error("That category already exists", { description: `A category with the id "${id}" is already in the list.` });
      return;
    }
    void run(async () => {
      await saveCategory(id, { name, sort, active: true });
      await onChanged();
      setNewName("");
      setNewSort("");
      toast.success(`Added ${name}`);
    });
  };

  const startEdit = (cat: Category) => {
    setEditingId(cat.id);
    setEditName(cat.name);
    setEditSort(String(cat.sort));
  };

  const handleSaveEdit = (cat: Category) => {
    const name = editName.trim();
    const sort = sortValue(editSort, cat.sort);
    if (!name) {
      toast.error("Category name is required");
      return;
    }
    if (sort === null) {
      toast.error("Sort must be a whole number");
      return;
    }
    void run(async () => {
      await saveCategory(cat.id, { name, sort });
      await onChanged();
      setEditingId(null);
      toast.success(`Saved ${name}`);
    });
  };

  const handleToggle = (cat: Category) => {
    void run(async () => {
      await saveCategory(cat.id, { name: cat.name, active: !cat.active });
      await onChanged();
    });
  };

  const handleDelete = (cat: Category) => {
    if (busy) return;
    if (!window.confirm(`Delete "${cat.name}"? This cannot be undone.`)) return;
    void run(async () => {
      await deleteCategory(cat.id);
      await onChanged();
      toast.success(`Deleted ${cat.name}`);
    });
  };

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <h2 className="display h-mid">Categories</h2>
      </div>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-4 mb-6">
        <div className="w-full sm:w-64">
          <Label htmlFor="newCategoryName">New category</Label>
          <Input
            id="newCategoryName"
            value={newName}
            maxLength={60}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Hoodies"
          />
        </div>
        <div className="w-24">
          <Label htmlFor="newCategorySort">Sort</Label>
          <Input
            id="newCategorySort"
            type="number"
            step="1"
            value={newSort}
            onChange={(e) => setNewSort(e.target.value)}
            placeholder={String(nextSort)}
          />
        </div>
        <Button type="submit" disabled={busy}>
          <Plus className="w-4 h-4 mr-2" />
          Add
        </Button>
        {newName.trim() && (
          <p className="text-sm text-b60 w-full">Id: {categoryIdFromName(newName) || "-"}</p>
        )}
      </form>

      <div className="border border-b10 r-card overflow-x-auto">
        {loading && categories.length === 0 && <p className="px-6 py-4 micro text-b60">Loading categories…</p>}
        {error && <p className="px-6 py-4 text-b60">Couldn't load categories: {error}</p>}
        {!loading && !error && categories.length === 0 && <p className="px-6 py-4 text-b60">No categories yet.</p>}
        {categories.length > 0 && (
          <table className="min-w-full text-left">
            <thead>
              <tr className="border-b border-b10">
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Name</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Sort</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Active</th>
                <th className="px-6 py-4 font-normal micro text-b60 whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-b10">
              {categories.map((cat) => {
                const isEditing = editingId === cat.id;
                return (
                  <tr key={cat.id} className={cat.active ? "" : "text-b60"}>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <Input
                          aria-label={`Name for ${cat.name}`}
                          value={editName}
                          maxLength={60}
                          onChange={(e) => setEditName(e.target.value)}
                          className="min-w-40"
                        />
                      ) : (
                        <div>
                          <div className="text-ink">{cat.name}</div>
                          <div className="text-xs text-b60">{cat.id}</div>
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {isEditing ? (
                        <Input
                          aria-label={`Sort for ${cat.name}`}
                          type="number"
                          step="1"
                          value={editSort}
                          onChange={(e) => setEditSort(e.target.value)}
                          className="w-20"
                        />
                      ) : (
                        cat.sort
                      )}
                    </td>
                    <td className="px-6 py-4">
                      <input
                        type="checkbox"
                        checked={cat.active}
                        disabled={busy}
                        onChange={() => handleToggle(cat)}
                        aria-label={`${cat.name} active`}
                        className="h-5 w-5 accent-brand"
                      />
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleSaveEdit(cat)}
                              disabled={busy}
                              aria-label={`Save ${cat.name}`}
                              className="p-1 text-ink hover:text-b60 transition-colors disabled:opacity-50"
                            >
                              <Save className="w-6 h-6" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setEditingId(null)}
                              aria-label="Cancel edit"
                              className="p-1 text-ink hover:text-b60 transition-colors"
                            >
                              <X className="w-6 h-6" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => startEdit(cat)}
                              aria-label={`Edit ${cat.name}`}
                              className="p-1 text-ink hover:text-b60 transition-colors"
                            >
                              <Edit className="w-6 h-6" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDelete(cat)}
                              disabled={busy}
                              aria-label={`Delete ${cat.name}`}
                              className="p-1 text-ink hover:text-b60 transition-colors disabled:opacity-50"
                            >
                              <Trash2 className="w-6 h-6" />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

/** The Categories section: loads every category (inactive ones too) and reloads the shop's cache after a change. */
export function AdminCategoriesSection({ onApiError }: AdminSectionProps) {
  const categories = useAdminList(() => listCategories(true), onApiError);
  const reload = async () => {
    await categories.reload();
    await loadCategories(true).catch(() => {});
  };
  return (
    <AdminCategories
      categories={categories.data}
      loading={categories.loading}
      error={categories.error}
      onChanged={reload}
      onApiError={onApiError}
    />
  );
}
