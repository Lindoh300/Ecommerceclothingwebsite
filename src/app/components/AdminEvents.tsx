import { useState } from "react";
import { Link } from "react-router";
import { Plus } from "lucide-react";
import { toast } from "../lib/toast";
import { ApiError } from "../api/client";
import { deleteEvent, listAdminEvents, saveEvent } from "../api/eventsAdmin";
import type { AdminEvent, EventStatus } from "../api/types";
import { useAdminList } from "../hooks/useAdminList";
import { eventPath } from "../lib/seo";
import { formatEventDate, formatPrice } from "../utils/eventTime";
import type { AdminSectionProps } from "./adminSections";
import { AdminEventForm } from "./AdminEventForm";
import { AdminEventTickets } from "./AdminEventTickets";

const STATUS_LABEL: Record<EventStatus, string> = {
  draft: "Draft",
  published: "Published",
  cancelled: "Cancelled",
};

type Panel = { kind: "new" } | { kind: "edit" | "tickets"; id: string } | null;

/** The Events section: events, their ticket types, the tickets issued, and publishing. */
export function AdminEvents({ onApiError }: AdminSectionProps) {
  const events = useAdminList(listAdminEvents, onApiError);
  const [panel, setPanel] = useState<Panel>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const reload = async () => {
    await events.reload();
  };

  const withBusy = async (id: string, action: () => Promise<void>) => {
    if (busyId) return;
    setBusyId(id);
    try {
      await action();
    } catch (err) {
      onApiError(err);
    } finally {
      setBusyId(null);
    }
  };

  const togglePublished = (e: AdminEvent) =>
    withBusy(e.id, async () => {
      const next: EventStatus = e.status === "published" ? "draft" : "published";
      await saveEvent(e.id, { status: next });
      toast.success(next === "published" ? `${e.title} is published` : `${e.title} is hidden`);
      await reload();
    });

  const handleDelete = (e: AdminEvent) => {
    if (!window.confirm(`Delete "${e.title}" and its ticket types? This cannot be undone.`)) return;
    void withBusy(e.id, async () => {
      try {
        await deleteEvent(e.id);
        toast.success(`Deleted ${e.title}`);
        if (panel && panel.kind !== "new" && panel.id === e.id) setPanel(null);
        await reload();
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          toast.error("Tickets were issued for this event", { description: "Set it to Cancelled instead of deleting it." });
        } else {
          throw err;
        }
      }
    });
  };

  const panelEvent = panel && panel.kind !== "new" ? events.data.find((e) => e.id === panel.id) ?? null : null;

  return (
    <div>
      <div className="flex flex-wrap justify-between items-center gap-4 mb-8">
        <h2 className="display h-mid">Events</h2>
        <button type="button" className="cta" onClick={() => setPanel({ kind: "new" })}>
          <Plus className="w-4 h-4" aria-hidden="true" />
          New event
        </button>
      </div>

      {panel?.kind === "new" && (
        <div className="mb-8">
          <AdminEventForm
            event={null}
            onSaved={async (saved) => {
              await reload();
              setPanel({ kind: "edit", id: saved.id });
            }}
            onChanged={reload}
            onClose={() => setPanel(null)}
            onApiError={onApiError}
          />
        </div>
      )}

      {events.loading && events.data.length === 0 && <p className="micro text-b60">Loading events…</p>}
      {events.error && <p className="text-b60">Couldn't load events: {events.error}</p>}
      {!events.loading && !events.error && events.data.length === 0 && panel?.kind !== "new" && (
        <p className="text-b60 border border-b10 p-6">No events yet. Create the first one.</p>
      )}

      <ul className="space-y-6">
        {events.data.map((e) => {
          const sold = e.ticketTypes.reduce((n, t) => n + t.sold, 0);
          const capacity = e.ticketTypes.reduce((n, t) => n + t.capacity, 0);
          const open = panel && panel.kind !== "new" && panel.id === e.id ? panel.kind : null;
          const busy = busyId === e.id;
          return (
            <li key={e.id} className="border border-b10 r-card p-4 md:p-6">
              <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 mb-1">
                <p className="micro text-b60">{formatEventDate(e.startsAt)}</p>
                <p className={`micro ${e.status === "published" ? "text-ink" : "text-b60"}`}>{STATUS_LABEL[e.status]}</p>
              </div>
              <h3 className="display h-mid break-words mb-1">{e.title}</h3>
              <p className="text-b60 break-words mb-3">{[e.venue, e.city].filter(Boolean).join(", ") || "No venue yet"}</p>
              <p className="text-sm mb-1">
                {sold} sold of {capacity}
              </p>
              {e.ticketTypes.length > 0 && (
                <ul className="text-sm text-b60 mb-4">
                  {e.ticketTypes.map((t) => (
                    <li key={t.id} className="break-words">
                      {t.name}: {t.sold}/{t.capacity} sold, {formatPrice(t.price)}
                      {t.active ? "" : " (hidden)"}
                    </li>
                  ))}
                </ul>
              )}
              <div className="flex flex-wrap gap-x-5 gap-y-2">
                <button type="button" className="linkr min-h-11" aria-pressed={open === "edit"} onClick={() => setPanel(open === "edit" ? null : { kind: "edit", id: e.id })}>
                  Edit
                </button>
                <button type="button" className="linkr min-h-11" aria-pressed={open === "tickets"} onClick={() => setPanel(open === "tickets" ? null : { kind: "tickets", id: e.id })}>
                  Tickets
                </button>
                {e.status !== "cancelled" && (
                  <button type="button" className="linkr min-h-11" disabled={busy} onClick={() => void togglePublished(e)}>
                    {e.status === "published" ? "Unpublish" : "Publish"}
                  </button>
                )}
                {e.status === "published" && (
                  <Link to={eventPath(e.slug)} target="_blank" rel="noopener noreferrer" className="linkr min-h-11">
                    View page
                  </Link>
                )}
                <button type="button" className="linkr min-h-11" disabled={busy} onClick={() => handleDelete(e)}>
                  Delete
                </button>
              </div>

              {open === "edit" && panelEvent && (
                <div className="mt-6">
                  <AdminEventForm
                    key={panelEvent.id}
                    event={panelEvent}
                    onSaved={reload}
                    onChanged={reload}
                    onClose={() => setPanel(null)}
                    onApiError={onApiError}
                  />
                </div>
              )}
              {open === "tickets" && panelEvent && (
                <div className="mt-6">
                  <AdminEventTickets key={panelEvent.id} event={panelEvent} onChanged={reload} onApiError={onApiError} />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
