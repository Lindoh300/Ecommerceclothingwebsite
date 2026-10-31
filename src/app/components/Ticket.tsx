import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { getPublicTicket } from "../api/events";
import { ApiError } from "../api/client";
import type { PublicTicket } from "../api/types";
import { eventPath } from "../lib/seo";
import { formatEventDate } from "../utils/eventTime";
import { LoadState } from "./prism/LoadState";

const STATUS_TEXT = {
  valid: "Valid",
  used: "Already used",
  void: "Void",
} as const;

/** Draws the QR code for the full ticket URL. The qrcode package is fetched here, in the browser, on demand. */
function TicketQr({ code }: { code: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    // The full URL, so a phone camera opens the ticket and the door scanner reads either the URL or the bare code.
    const url = `${window.location.origin}/ticket/${code}`;
    import("qrcode")
      .then((m) => m.default.toDataURL(url, { margin: 2, width: 320, errorCorrectionLevel: "M" }))
      .then((dataUrl) => {
        if (!cancelled) setSrc(dataUrl);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) {
    return <p className="text-b60">The QR code could not be drawn. Show this code at the door instead: <span className="font-mono break-all">{code}</span></p>;
  }
  // The code is drawn dark on a white square by the library, which is what scanners need in any theme.
  return (
    <div className="w-full max-w-xs aspect-square mx-auto border border-b10 flex items-center justify-center">
      {src ? (
        <img src={src} alt="QR code for this ticket" width={320} height={320} className="w-full h-full" />
      ) : (
        <p className="micro text-b60">Drawing QR code…</p>
      )}
    </div>
  );
}

export function Ticket() {
  const { code = "" } = useParams();
  const [ticket, setTicket] = useState<PublicTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const t = await getPublicTicket(code);
      if (live.current) setTicket(t);
    } catch (err) {
      if (!live.current) return;
      if (err instanceof ApiError && err.status === 404) setNotFound(true);
      else setError(err instanceof Error ? err.message : "Could not load your ticket");
    } finally {
      if (live.current) setLoading(false);
    }
  }, [code]);

  // Loaded after mount only: the server sends the empty page.
  useEffect(() => {
    live.current = true;
    load();
    return () => {
      live.current = false;
    };
  }, [load]);

  return (
    <div className="min-h-screen bg-paper py-12 md:py-16">
      <div className="max-w-xl mx-auto px-6">
        <LoadState loading={loading && !ticket} error={ticket ? null : error} onRetry={load}>
          {notFound ? (
            <div className="text-center py-12">
              <p className="micro text-b60 mb-3">Your ticket</p>
              <h1 className="display h-sec mb-6">Ticket not found</h1>
              <p className="text-b60 mb-10">We couldn't find that ticket. Check the link you were sent.</p>
              <Link to="/events" className="cta">See events</Link>
            </div>
          ) : ticket ? (
            <div>
              <p className="micro text-b60 mb-3">Your ticket</p>
              <h1 className="display h-sec mb-2 break-words">{ticket.eventTitle}</h1>
              <p className="mb-8 text-b60">{ticket.holderFirstName}</p>

              <div
                role="status"
                className={`mb-8 p-4 border-2 ${
                  ticket.status === "valid"
                    ? "border-prism"
                    : ticket.status === "used"
                      ? "border-ink bg-b5"
                      : "border-destructive bg-b5"
                }`}
              >
                <p className="font-display h-weight h-case h-track-sm text-2xl">{STATUS_TEXT[ticket.status]}</p>
                {ticket.status === "used" && ticket.checkedInAt && (
                  <p className="text-b60 text-sm">Checked in {formatEventDate(ticket.checkedInAt)}</p>
                )}
                {ticket.status === "void" && <p className="text-b60 text-sm">This ticket was cancelled and will not be accepted.</p>}
              </div>

              {ticket.status === "valid" && (
                <div className="mb-8">
                  <TicketQr code={code} />
                  <p className="text-sm text-b60 mt-4 text-center">
                    Show this QR code at the door. Save this page to your phone or print it. Anyone who has this link can use the ticket, so keep it to yourself.
                  </p>
                </div>
              )}

              <dl className="border-t border-b10 mb-10">
                <div className="flex justify-between gap-4 py-3 border-b border-b10">
                  <dt className="micro text-b60">When</dt>
                  <dd className="text-right">{formatEventDate(ticket.startsAt)}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3 border-b border-b10">
                  <dt className="micro text-b60">Where</dt>
                  <dd className="text-right break-words min-w-0">{[ticket.venue, ticket.city].filter(Boolean).join(", ") || "To be announced"}</dd>
                </div>
                <div className="flex justify-between gap-4 py-3 border-b border-b10">
                  <dt className="micro text-b60">Ticket</dt>
                  <dd className="text-right break-words min-w-0">{ticket.ticketTypeName}</dd>
                </div>
              </dl>

              <Link to={eventPath(ticket.eventSlug)} className="linkr">Event details</Link>
            </div>
          ) : null}
        </LoadState>
      </div>
    </div>
  );
}
