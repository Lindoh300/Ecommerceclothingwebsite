import { useId, useState } from "react";
import { ApiError } from "../api/client";
import { unsubscribe } from "../api/community";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The public unsubscribe page. One field takes a phone number or an email address, the same as the sign-up form. The
 * success wording is the same whether or not the contact was on the list.
 */
export function Unsubscribe() {
  const uid = useId();
  const [contact, setContact] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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
      await unsubscribe(isEmail ? { email: value } : { phone: value });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError && (err.status === 400 || err.status === 429)
          ? err.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-xl mx-auto px-6">
        <p className="page-kicker micro text-b60 mb-3">Mailing list</p>
        <h1 className="display h-sec mb-4">Unsubscribe</h1>
        {done ? (
          <p role="status" className="display h-mid">
            {"If that contact was on our list, it has been removed. You won't get any more news from us."}
          </p>
        ) : (
          <>
            <p className="text-b60 mb-8">Enter the phone number or email address you signed up with.</p>
            <form onSubmit={handleSubmit} className="space-y-4" noValidate aria-label="Unsubscribe from the mailing list">
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
                {busy ? "Unsubscribing…" : "Unsubscribe"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
