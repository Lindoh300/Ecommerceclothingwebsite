import { useId, useState } from "react";
import { toast } from "../lib/toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ApiError } from "../api/client";
import { listDeliveryOptionsAdmin, updateDeliveryOption } from "../api/deliveryAdmin";
import type { DeliveryOptionAdmin } from "../api/types";
import { useAdminList } from "../hooks/useAdminList";
import type { AdminSectionProps } from "./adminSections";

const MAX_NAME = 60;
const MAX_PRICE = 10000;

/** The price as a number, or the reason it is not valid. Two decimal places at most, as the server requires. */
export function parseDeliveryPrice(text: string): { price: number } | { error: string } {
  const trimmed = text.trim();
  if (trimmed === "") return { error: "Enter a price" };
  const price = Number(trimmed);
  if (!Number.isFinite(price) || price < 0 || price > MAX_PRICE) {
    return { error: `Price must be a number from 0 to ${MAX_PRICE}` };
  }
  if (Math.abs(price * 100 - Math.round(price * 100)) > 1e-7) {
    return { error: "Price can have at most 2 decimal places" };
  }
  return { price };
}

interface DeliveryRowProps {
  option: DeliveryOptionAdmin;
  onApiError: (err: unknown) => void;
}

function DeliveryRow({ option, onApiError }: DeliveryRowProps) {
  const nameId = useId();
  const priceId = useId();
  const activeId = useId();
  const [name, setName] = useState(option.name);
  const [price, setPrice] = useState(String(option.price));
  const [active, setActive] = useState(option.active);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error("Enter a delivery name");
      return;
    }
    if (trimmed.length > MAX_NAME) {
      toast.error(`Name must be ${MAX_NAME} characters or fewer`);
      return;
    }
    const parsed = parseDeliveryPrice(price);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const saved = await updateDeliveryOption(option.id, { name: trimmed, price: parsed.price, active });
      setName(saved.name);
      setPrice(String(saved.price));
      setActive(saved.active);
      toast.success(`Saved ${saved.name}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        // The server refuses to switch off the last active option. Show why and put the checkbox back on.
        toast.error(err.message);
        setActive(true);
      } else {
        onApiError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-b10 r-card p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-end">
        <div className="w-full min-w-0 md:flex-1">
          <Label htmlFor={nameId}>Name</Label>
          <Input
            id={nameId}
            value={name}
            maxLength={MAX_NAME}
            onChange={(e) => setName(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="w-full md:w-40">
          <Label htmlFor={priceId}>Price (R)</Label>
          <Input
            id={priceId}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="flex items-center gap-2 min-h-11">
          <input
            id={activeId}
            type="checkbox"
            checked={active}
            disabled={busy}
            onChange={(e) => setActive(e.target.checked)}
            className="h-5 w-5 accent-brand"
          />
          <Label htmlFor={activeId}>On</Label>
        </div>
        <Button type="button" onClick={save} disabled={busy} className="w-full md:w-auto">
          Save
        </Button>
      </div>
    </div>
  );
}

/** The Delivery section: every delivery option, on or off, each saved on its own row. */
export function AdminDelivery({ onApiError }: AdminSectionProps) {
  const options = useAdminList(() => listDeliveryOptionsAdmin(), onApiError);

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <h2 className="display h-mid">Delivery</h2>
      </div>
      <p className="text-sm text-b60 mb-8">
        Changes apply to new orders straight away. Orders already placed keep their fee.
      </p>

      {options.loading && options.data.length === 0 && <p className="micro text-b60">Loading delivery options…</p>}
      {options.error && <p className="text-b60">Couldn't load delivery options: {options.error}</p>}
      {!options.loading && !options.error && options.data.length === 0 && (
        <p className="text-b60">No delivery options.</p>
      )}

      <div className="flex flex-col gap-4">
        {options.data.map((option) => (
          <DeliveryRow key={option.id} option={option} onApiError={onApiError} />
        ))}
      </div>
    </div>
  );
}
