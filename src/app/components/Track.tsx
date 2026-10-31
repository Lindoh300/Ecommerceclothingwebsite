import { useState } from "react";
import { useNavigate } from "react-router";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { lookupOrder } from "../api/orders";
import { ApiError } from "../api/client";

export function Track() {
  const navigate = useNavigate();
  const [ref, setRef] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!ref.trim() || !phone.trim()) {
      setMessage("Enter your order reference and phone number.");
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { id } = await lookupOrder({ ref: ref.trim(), phone: phone.trim() });
      navigate(`/order/${encodeURIComponent(id)}`);
    } catch (err) {
      setBusy(false);
      if (err instanceof ApiError && err.status === 404) {
        setMessage("We couldn't find that order. Check the reference and phone number.");
      } else if (err instanceof ApiError && err.status === 429) {
        setMessage(err.message);
      } else {
        setMessage("Could not look up your order. Please try again.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-xl mx-auto px-6">
        <p className="page-kicker micro text-b60 mb-3">Orders</p>
        <h1 className="display h-sec mb-4">Track an order</h1>
        <p className="text-b60 mb-8">Enter the reference from your order and the phone number you used.</p>
        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-1">
            <Label htmlFor="track-ref">Order reference</Label>
            <Input id="track-ref" value={ref} maxLength={40} autoComplete="off" disabled={busy} onChange={(e) => setRef(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="track-phone">Phone</Label>
            <Input id="track-phone" type="tel" value={phone} maxLength={20} autoComplete="tel" disabled={busy} onChange={(e) => setPhone(e.target.value)} />
          </div>
          {message && <p role="alert" className="text-sm text-brand">{message}</p>}
          <button type="submit" disabled={busy} className="cta w-full">{busy ? "Looking…" : "Find my order"}</button>
        </form>
      </div>
    </div>
  );
}
