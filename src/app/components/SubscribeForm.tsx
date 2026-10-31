import { useId, useState } from "react";
import { Link } from "react-router";
import { ApiError } from "../api/client";
import { subscribe } from "../api/community";
import { CONSENT_TEXT } from "../api/communityConsent";
import type { SubscriberSource } from "../api/types";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

/** The wording beside the tick box. The server keeps its own copy of it as the consent record. */
export { CONSENT_TEXT };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The mailing-list sign-up. The tick box starts unticked and the button stays off until it is ticked. One field takes
 * a phone number or an email address. `compact` is the footer version: no name, tighter spacing.
 */
export function SubscribeForm({ source, compact = false }: { source: SubscriberSource; compact?: boolean }) {
  const uid = useId();
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || !consent) return;
    const value = contact.trim();
    if (!value) return void setError("Enter a phone number or an email address.");
    const isEmail = value.includes("@");
    if (isEmail && !EMAIL_RE.test(value)) return void setError("That email address doesn't look right.");
    if (!isEmail && value.replace(/\D/g, "").length < 9) return void setError("That phone number doesn't look right.");
    setBusy(true);
    setError(null);
    try {
      await subscribe({
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(isEmail ? { email: value } : { phone: value }),
        consent: true,
        source,
      });
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

  if (done) {
    return (
      <p role="status" className="display h-mid">
        {"You're on the list."}
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate aria-label="Join the mailing list" className={compact ? "space-y-3" : "space-y-4"}>
      {!compact && (
        <div className="space-y-1">
          <Label htmlFor={`${uid}-name`}>Name (optional)</Label>
          <Input id={`${uid}-name`} value={name} maxLength={100} autoComplete="name" disabled={busy} onChange={(e) => setName(e.target.value)} />
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
      <div className="flex items-start gap-3">
        <input
          id={`${uid}-consent`}
          type="checkbox"
          checked={consent}
          disabled={busy}
          onChange={(e) => setConsent(e.target.checked)}
          className="mt-1 h-5 w-5 shrink-0 accent-prism"
        />
        <label htmlFor={`${uid}-consent`} className="min-w-0 text-sm leading-snug break-words">
          {CONSENT_TEXT}{" "}
          <Link to="/privacy" className="underline underline-offset-2 hover:text-prism">
            Privacy
          </Link>
        </label>
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-low break-words">
          {error}
        </p>
      )}
      <button type="submit" className="cta" disabled={!consent || busy}>
        {busy ? "Joining…" : "Join the list"}
      </button>
    </form>
  );
}
