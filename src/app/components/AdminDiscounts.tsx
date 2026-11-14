import { useEffect, useId, useState } from "react";
import { toast } from "../lib/toast";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { ApiError } from "../api/client";
import { listDiscounts, saveDiscount } from "../api/discountsAdmin";
import type { Discount, DiscountInput, DiscountKind } from "../api/types";
import { useAdminList } from "../hooks/useAdminList";
import { formatEventDate, formatPrice, inputToIso } from "../utils/eventTime";
import type { AdminSectionProps } from "./adminSections";

// These limits match validateDiscountInput on the server (supabase/functions/server/validation.ts).
const CODE_RE = /^[A-Z0-9-]{3,20}$/;
const MAX_PERCENT = 100;
const MAX_RAND = 100000;
const MAX_MIN_SPEND = 10000000;
const MAX_USES = 1000000;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-input-background px-3 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50";

/** Two decimal places at most, as the server requires. */
const hasCents = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) <= 1e-7;

/** The create form as typed. Every field is text, as the inputs hold it. */
export interface DiscountFormValues {
  code: string;
  kind: DiscountKind;
  amount: string;
  minSpend: string;
  expires: string;
  maxUses: string;
}

export const EMPTY_DISCOUNT_FORM: DiscountFormValues = {
  code: "",
  kind: "percent",
  amount: "",
  minSpend: "",
  expires: "",
  maxUses: "",
};

/**
 * The body for a new code, or the reason the form cannot be sent. Blank minimum spend means 0, blank expiry means no
 * expiry and blank use limit means no limit. The expiry is read as South African time.
 */
export function parseDiscountForm(form: DiscountFormValues): { input: DiscountInput } | { error: string } {
  const code = form.code.trim().toUpperCase();
  if (!CODE_RE.test(code)) return { error: "Code must be 3 to 20 letters, digits or hyphens" };

  const amountText = form.amount.trim();
  if (amountText === "") return { error: "Enter an amount" };
  const value = Number(amountText);
  const max = form.kind === "percent" ? MAX_PERCENT : MAX_RAND;
  if (!Number.isFinite(value) || value <= 0 || value > max) {
    return {
      error:
        form.kind === "percent"
          ? `Percent off must be above 0 and at most ${MAX_PERCENT}`
          : `Rand off must be above 0 and at most ${MAX_RAND}`,
    };
  }
  if (!hasCents(value)) return { error: "Amount can have at most 2 decimal places" };

  let minSpend = 0;
  const minText = form.minSpend.trim();
  if (minText !== "") {
    minSpend = Number(minText);
    if (!Number.isFinite(minSpend) || minSpend < 0 || minSpend > MAX_MIN_SPEND) {
      return { error: `Minimum spend must be from 0 to ${MAX_MIN_SPEND}` };
    }
    if (!hasCents(minSpend)) return { error: "Minimum spend can have at most 2 decimal places" };
  }

  let expiresAt: string | null = null;
  const expiresText = form.expires.trim();
  if (expiresText !== "") {
    expiresAt = inputToIso(expiresText);
    if (expiresAt === null) return { error: "Enter a valid expiry date and time" };
  }

  let maxUses: number | null = null;
  const usesText = form.maxUses.trim();
  if (usesText !== "") {
    const uses = Number(usesText);
    if (!Number.isInteger(uses) || uses < 1 || uses > MAX_USES) {
      return { error: `Use limit must be a whole number from 1 to ${MAX_USES}` };
    }
    maxUses = uses;
  }

  return { input: { code, kind: form.kind, value, minSpend, expiresAt, maxUses, active: true } };
}

/** The server's 409 for a code that already exists. */
function isCodeTaken(err: unknown): err is ApiError {
  return (
    err instanceof ApiError &&
    err.status === 409 &&
    typeof err.body === "object" &&
    err.body !== null &&
    (err.body as { code?: unknown }).code === "code_taken"
  );
}

const describeValue = (d: Discount) => (d.kind === "percent" ? `${d.value}% off` : `${formatPrice(d.value)} off`);

interface DiscountCardProps {
  discount: Discount;
  /** Epoch ms, set after mount so the first render matches the server. Null until then. */
  now: number | null;
  onApiError: (err: unknown) => void;
}

function DiscountCard({ discount, now, onApiError }: DiscountCardProps) {
  const activeId = useId();
  const [active, setActive] = useState(discount.active);
  const [busy, setBusy] = useState(false);
  const expired = now !== null && discount.expiresAt !== null && Date.parse(discount.expiresAt) < now;

  // Saves straight away with the code's current values and only `active` changed.
  const toggle = async (next: boolean) => {
    if (busy) return;
    setActive(next);
    setBusy(true);
    try {
      await saveDiscount(discount.id, {
        code: discount.code,
        kind: discount.kind,
        value: discount.value,
        minSpend: discount.minSpend,
        expiresAt: discount.expiresAt,
        maxUses: discount.maxUses,
        active: next,
      });
    } catch (err) {
      // Put the checkbox back to what the server still has.
      setActive(!next);
      if (isCodeTaken(err)) toast.error(err.message);
      else onApiError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-b10 r-card p-4 md:p-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <p className="font-mono break-all text-ink">{discount.code}</p>
          <p className="text-ink">{describeValue(discount)}</p>
          {discount.minSpend > 0 && <p className="text-sm text-b60">Spend at least {formatPrice(discount.minSpend)}</p>}
          {discount.expiresAt !== null &&
            (expired ? (
              <p className="text-sm text-b60">Expired</p>
            ) : (
              <p className="text-sm text-b60">Expires {formatEventDate(discount.expiresAt)}</p>
            ))}
          <p className="text-sm text-b60">
            {discount.maxUses !== null ? `Used ${discount.uses} of ${discount.maxUses}` : `Used ${discount.uses}`}
          </p>
        </div>
        <div className="flex items-center gap-2 min-h-11">
          <input
            id={activeId}
            type="checkbox"
            checked={active}
            disabled={busy}
            onChange={(e) => toggle(e.target.checked)}
            className="h-5 w-5 accent-brand"
          />
          <Label htmlFor={activeId}>On</Label>
        </div>
      </div>
    </div>
  );
}

/** The Discounts section: a form to add a code, then every code with its On switch. Codes are never deleted. */
export function AdminDiscounts({ onApiError }: AdminSectionProps) {
  const discounts = useAdminList(() => listDiscounts(), onApiError);
  const [form, setForm] = useState<DiscountFormValues>(EMPTY_DISCOUNT_FORM);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState<number | null>(null);
  const codeId = useId();
  const kindId = useId();
  const amountId = useId();
  const minId = useId();
  const expiresId = useId();
  const usesId = useId();

  useEffect(() => {
    setNow(Date.now());
  }, []);

  const update = (patch: Partial<DiscountFormValues>) => setForm((f) => ({ ...f, ...patch }));

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const parsed = parseDiscountForm(form);
    if ("error" in parsed) {
      toast.error(parsed.error);
      return;
    }
    setBusy(true);
    try {
      const saved = await saveDiscount(crypto.randomUUID(), parsed.input);
      setForm(EMPTY_DISCOUNT_FORM);
      toast.success(`Added ${saved.code}`);
      setNow(Date.now());
      await discounts.reload();
    } catch (err) {
      if (isCodeTaken(err)) toast.error(err.message);
      else onApiError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <h2 className="display h-mid">Discounts</h2>
      </div>
      <p className="text-sm text-b60 mb-8">Codes can't be deleted. Turn one off to stop it working.</p>

      <form onSubmit={create} className="border border-b10 r-card p-4 md:p-6 mb-8">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="min-w-0">
            <Label htmlFor={codeId}>Code</Label>
            <Input
              id={codeId}
              value={form.code}
              onChange={(e) => update({ code: e.target.value.toUpperCase() })}
              className="w-full"
            />
          </div>
          <div className="min-w-0">
            <Label htmlFor={kindId}>Type</Label>
            <select
              id={kindId}
              className={selectClass}
              value={form.kind}
              onChange={(e) => update({ kind: e.target.value as DiscountKind })}
            >
              <option value="percent">Percent off</option>
              <option value="fixed">Rand off</option>
            </select>
          </div>
          <div className="min-w-0">
            <Label htmlFor={amountId}>Amount</Label>
            <Input
              id={amountId}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => update({ amount: e.target.value })}
              className="w-full"
            />
          </div>
          <div className="min-w-0">
            <Label htmlFor={minId}>Minimum spend (optional)</Label>
            <Input
              id={minId}
              type="number"
              min="0"
              step="0.01"
              inputMode="decimal"
              value={form.minSpend}
              onChange={(e) => update({ minSpend: e.target.value })}
              className="w-full"
            />
          </div>
          <div className="min-w-0">
            <Label htmlFor={expiresId}>Expires (optional)</Label>
            <Input
              id={expiresId}
              type="datetime-local"
              value={form.expires}
              onChange={(e) => update({ expires: e.target.value })}
              className="w-full"
            />
          </div>
          <div className="min-w-0">
            <Label htmlFor={usesId}>Use limit (optional)</Label>
            <Input
              id={usesId}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={form.maxUses}
              onChange={(e) => update({ maxUses: e.target.value })}
              className="w-full"
            />
          </div>
        </div>
        <Button type="submit" disabled={busy} className="w-full md:w-auto mt-6">
          Add code
        </Button>
      </form>

      {discounts.loading && discounts.data.length === 0 && <p className="micro text-b60">Loading discount codes…</p>}
      {discounts.error && <p className="text-b60">Couldn't load discount codes: {discounts.error}</p>}
      {!discounts.loading && !discounts.error && discounts.data.length === 0 && (
        <p className="text-b60">No discount codes yet.</p>
      )}

      <div className="flex flex-col gap-4">
        {discounts.data.map((discount) => (
          <DiscountCard key={discount.id} discount={discount} now={now} onApiError={onApiError} />
        ))}
      </div>
    </div>
  );
}
