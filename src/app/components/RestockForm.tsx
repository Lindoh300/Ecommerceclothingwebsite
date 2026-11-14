import { useId, useState } from "react";
import { ApiError } from "../api/client";
import { requestRestockAlert } from "../api/community";
import type { Product } from "../api/types";
import { restockOption } from "../utils/restock";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-input-background px-3 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50";

/**
 * "Tell me when it's back" on the product page. Offers the sold-out variants; renders nothing when there are none.
 * Props and state only, so it renders the same on the server and in the browser.
 */
export function RestockForm({ product, size, color }: { product: Product; size: string; color: string }) {
  const uid = useId();
  const options = (product.variants ?? []).filter((v) => v.stock <= 0);
  const allOut = options.length > 0 && options.length === product.variants.length;
  const [open, setOpen] = useState(allOut);
  const [picked, setPicked] = useState("");
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (options.length === 0) return null;

  const matching = options.find((v) => v.size === size && v.color === color);
  const variantId = options.some((v) => v.id === picked) ? picked : (matching?.id ?? options[0].id);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const value = contact.trim();
    if (!value) return void setError("Enter a phone number or an email address.");
    const isEmail = value.includes("@");
    if (isEmail && !EMAIL_RE.test(value)) return void setError("That email address doesn't look right.");
    if (!isEmail && value.replace(/\D/g, "").length < 9) return void setError("That phone number doesn't look right.");
    setBusy(true);
    setError(null);
    try {
      await requestRestockAlert(product.id, isEmail ? { variantId, email: value } : { variantId, phone: value });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && err.status === 409
          ? "That option is back in stock. Refresh the page to order it."
          : err instanceof ApiError && (err.status === 400 || err.status === 429)
            ? err.message
            : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-6">
      {!open ? (
        <button type="button" className="linkr min-h-11" aria-expanded={false} onClick={() => setOpen(true)}>
          Tell me when it's back
        </button>
      ) : done ? (
        <p role="status">Thanks. We'll tell you when it's back.</p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4" noValidate aria-label="Tell me when it's back">
          {options.length > 1 && (
            <div className="space-y-1">
              <Label htmlFor={`${uid}-option`}>Size and colour</Label>
              <select
                id={`${uid}-option`}
                className={selectClass}
                value={variantId}
                disabled={busy}
                onChange={(e) => setPicked(e.target.value)}
              >
                {options.map((v) => (
                  <option key={v.id} value={v.id}>
                    {restockOption(v)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <Label htmlFor={`${uid}-contact`}>Phone number or email</Label>
            <Input
              id={`${uid}-contact`}
              value={contact}
              maxLength={254}
              disabled={busy}
              onChange={(e) => setContact(e.target.value)}
            />
          </div>
          {error && (
            <p role="alert" className="text-sm text-status-low break-words">
              {error}
            </p>
          )}
          <button type="submit" className="cta w-full" disabled={busy}>
            {busy ? "Sending…" : "Notify me"}
          </button>
          <p className="micro text-b60">We'll use this only to tell you it's back, then remove it.</p>
        </form>
      )}
    </div>
  );
}
