import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";
import { whatsappLink } from "../config/shop";
import { placeOrder } from "../api/orders";
import { ApiError } from "../api/client";
import type { CartQuoteItem, Order, StockShortfall } from "../api/types";
import { buildOrderMessage } from "../utils/orderMessage";

interface CheckoutPanelProps {
  items: CartQuoteItem[];
  blocked: boolean;
  onStockShort: () => void;
  onCartCleared: () => void;
  onOrderChange: (placed: boolean) => void;
}

function validate(name: string, phone: string, note: string): Record<string, string> {
  const errors: Record<string, string> = {};
  const n = name.trim();
  const p = phone.trim();
  if (n.length < 1 || n.length > 80) errors.name = "Enter your name (up to 80 characters)";
  if (p.length < 7 || p.length > 20 || !/^[0-9 +\-()]+$/.test(p) || p.replace(/\D/g, "").length < 7) {
    errors.phone = "Enter a valid phone number (at least 7 digits)";
  }
  if (note.trim().length > 500) errors.note = "Note is too long (500 characters max)";
  return errors;
}

export function CheckoutPanel({ items, blocked, onStockShort, onCartCleared, onOrderChange }: CheckoutPanelProps) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);
  const [awaitingConfirm, setAwaitingConfirm] = useState(false);
  const orderId = useRef<string | null>(null);
  const inFlight = useRef(false);

  const itemsKey = JSON.stringify(items);
  useEffect(() => {
    // Cart changed: a previous attempt's id no longer matches these lines.
    orderId.current = null;
  }, [itemsKey]);

  const handlePlaceOrder = async () => {
    if (inFlight.current || order) return;
    const found = validate(name, phone, note);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      toast.error("Check your details", { description: Object.values(found)[0] });
      return;
    }
    inFlight.current = true;
    setSubmitting(true);
    if (!orderId.current) orderId.current = crypto.randomUUID();
    try {
      const trimmedNote = note.trim();
      const placed = await placeOrder({
        id: orderId.current,
        items: JSON.parse(itemsKey) as CartQuoteItem[],
        customer: {
          name: name.trim(),
          phone: phone.trim(),
          ...(trimmedNote ? { note: trimmedNote } : {}),
        },
      });
      setOrder(placed);
      onOrderChange(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        orderId.current = null;
        const short = ((err.body as { short?: StockShortfall[] } | undefined)?.short ?? []);
        toast.error("Not enough stock", {
          description: short.length
            ? short.map((s) => `${s.name}: only ${s.available} left`).join(", ")
            : "Some items are no longer available in that quantity.",
        });
        onStockShort();
      } else if (err instanceof ApiError && err.status === 400 && (err.body as { missing?: unknown } | undefined)?.missing) {
        orderId.current = null;
        toast.error("Some items are no longer available", { description: "Remove them from your cart and try again." });
        onStockShort();
      } else {
        toast.error("Could not place your order", {
          description: err instanceof Error ? `${err.message}. Please try again.` : "Please try again.",
        });
      }
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };

  const handleSendWhatsApp = () => {
    if (!order) return;
    window.open(whatsappLink(buildOrderMessage(order)), "_blank");
    setAwaitingConfirm(true);
  };

  const handleConfirmSent = () => {
    onCartCleared();
    setAwaitingConfirm(false);
    setOrder(null);
    onOrderChange(false);
    orderId.current = null;
    toast.success("Order sent", { description: "Thanks! We will reply on WhatsApp." });
  };

  return (
    <div>
      {order ? (
        <div className="border border-b10 p-4 mb-4">
          <p className="micro text-b60 mb-2">Order {order.ref} saved</p>
          <div className="flex justify-between mb-2">
            <span>Total</span>
            <span className="font-mono">R{order.total.toFixed(2)}</span>
          </div>
          <p className="text-b60 text-sm">Now send it to us on WhatsApp so we can confirm.</p>
        </div>
      ) : (
        <div className="space-y-4 mb-4">
          <p className="micro text-b60">Your details</p>
          <div className="space-y-1">
            <Label htmlFor="checkout-name">Name</Label>
            <Input
              id="checkout-name"
              value={name}
              maxLength={80}
              autoComplete="name"
              disabled={submitting}
              aria-invalid={!!errors.name}
              onChange={(e) => setName(e.target.value)}
            />
            {errors.name && <p className="text-sm text-prism">{errors.name}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="checkout-phone">Phone</Label>
            <Input
              id="checkout-phone"
              type="tel"
              value={phone}
              maxLength={20}
              autoComplete="tel"
              disabled={submitting}
              aria-invalid={!!errors.phone}
              onChange={(e) => setPhone(e.target.value)}
            />
            {errors.phone && <p className="text-sm text-prism">{errors.phone}</p>}
          </div>
          <div className="space-y-1">
            <Label htmlFor="checkout-note">Note (optional)</Label>
            <Textarea
              id="checkout-note"
              value={note}
              maxLength={500}
              disabled={submitting}
              aria-invalid={!!errors.note}
              onChange={(e) => setNote(e.target.value)}
            />
            {errors.note && <p className="text-sm text-prism">{errors.note}</p>}
          </div>
        </div>
      )}

      {order ? (
        <button onClick={handleSendWhatsApp} className="cta w-full">
          <MessageCircle className="w-5 h-5" />
          {awaitingConfirm ? "Open WhatsApp again" : "Send on WhatsApp"}
        </button>
      ) : (
        <button onClick={handlePlaceOrder} disabled={blocked || submitting} className="cta w-full">
          {submitting ? "Placing order…" : "Place order"}
        </button>
      )}

      {order && awaitingConfirm && (
        <div className="border border-b10 p-4 mt-4">
          <p className="micro text-b60 mb-2">Did you send your order?</p>
          <p className="text-b60 text-sm mb-4">
            Your cart is kept until you confirm, in case WhatsApp didn't send.
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button onClick={handleConfirmSent} className="cta">
              Yes, clear cart
            </button>
            <button onClick={() => setAwaitingConfirm(false)} className="linkr">
              Not yet
            </button>
          </div>
        </div>
      )}
      <p className="micro text-b60 text-center mt-4 text-xs">
        Your order is saved first, then sent to us on WhatsApp.
      </p>
    </div>
  );
}
