import { useRef, useState } from "react";
import { Save, Trash2, X } from "lucide-react";
import { toast } from "../lib/toast";
import { ApiError } from "../api/client";
import { deleteTicketType, saveEvent, saveTicketType } from "../api/eventsAdmin";
import { uploadImage } from "../api/products";
import type { AdminEvent, AdminTicketType, EventStatus } from "../api/types";
import { inputToIso, isoToInput } from "../utils/eventTime";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-input-background px-3 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50";

const isHttpUrl = (value: string): boolean => {
  try {
    const u = new URL(value);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
};

/** One ticket type: edit it in place, or (with no `type`) add a new one to the event. */
function TicketTypeRow({
  eventId,
  type,
  nextSort,
  onChanged,
  onApiError,
}: {
  eventId: string;
  type: AdminTicketType | null;
  nextSort: number;
  onChanged: () => Promise<unknown>;
  onApiError: (err: unknown) => void;
}) {
  const [name, setName] = useState(type?.name ?? "");
  const [price, setPrice] = useState(type ? String(type.price) : "0");
  const [capacity, setCapacity] = useState(type ? String(type.capacity) : "50");
  const [from, setFrom] = useState(isoToInput(type?.saleStartsAt));
  const [to, setTo] = useState(isoToInput(type?.saleEndsAt));
  const [active, setActive] = useState(type?.active ?? true);
  const [sort, setSort] = useState(String(type?.sort ?? nextSort));
  const [busy, setBusy] = useState(false);
  // A new row keeps one id, so saving twice cannot add the type twice.
  const newId = useRef<string | null>(null);
  const uid = type?.id ?? "new";

  const handleSave = async () => {
    if (busy) return;
    const cleanName = name.trim();
    const p = Number(price);
    const c = Number(capacity);
    const s = Number(sort);
    if (!cleanName) return void toast.error("Ticket type needs a name");
    if (price.trim() === "" || !Number.isFinite(p) || p < 0 || Math.round(p * 100) / 100 !== p) {
      return void toast.error("Price must be 0 or more, with at most 2 decimals. Use 0 for a free RSVP.");
    }
    if (capacity.trim() === "" || !Number.isInteger(c) || c < 0) return void toast.error("Capacity must be a whole number of 0 or more");
    if (!Number.isInteger(s)) return void toast.error("Sort must be a whole number");
    const saleStartsAt = from ? inputToIso(from) : null;
    const saleEndsAt = to ? inputToIso(to) : null;
    if ((from && !saleStartsAt) || (to && !saleEndsAt)) return void toast.error("Check the sale dates");
    if (saleStartsAt && saleEndsAt && saleEndsAt < saleStartsAt) return void toast.error("The sale cannot end before it starts");
    setBusy(true);
    try {
      newId.current ??= crypto.randomUUID();
      await saveTicketType(type?.id ?? newId.current, {
        ...(type ? {} : { eventId }),
        name: cleanName,
        price: p,
        capacity: c,
        saleStartsAt,
        saleEndsAt,
        active,
        sort: s,
      });
      toast.success(type ? `Saved ${cleanName}` : `Added ${cleanName}`);
      if (!type) {
        newId.current = null;
        setName("");
        setPrice("0");
        setCapacity("50");
        setFrom("");
        setTo("");
        setSort(String(nextSort + 1));
      }
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const sold = (err.body as { sold?: number } | undefined)?.sold;
        toast.error(
          typeof sold === "number" ? `Capacity can't go below the ${sold} tickets already sold` : err.message,
        );
      } else {
        onApiError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!type || busy) return;
    if (!window.confirm(`Delete the ticket type "${type.name}"? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await deleteTicketType(type.id);
      toast.success(`Deleted ${type.name}`);
      await onChanged();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        toast.error("Tickets were issued for this type", { description: "Set it inactive instead of deleting it." });
      } else {
        onApiError(err);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border border-b10 r-card p-4 space-y-4" role="group" aria-label={type ? `Ticket type ${type.name}` : "New ticket type"}>
      {type && (
        <p className="micro text-b60">
          {type.sold} sold of {type.capacity}, {type.available} left
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-3">
        <div className="space-y-1 sm:col-span-3">
          <Label htmlFor={`tt-name-${uid}`}>Name</Label>
          <Input id={`tt-name-${uid}`} value={name} maxLength={80} disabled={busy} onChange={(e) => setName(e.target.value)} placeholder="General entry" />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`tt-price-${uid}`}>Price (R, 0 = free RSVP)</Label>
          <Input id={`tt-price-${uid}`} type="number" inputMode="decimal" min={0} step="0.01" value={price} disabled={busy} onChange={(e) => setPrice(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`tt-cap-${uid}`}>Capacity</Label>
          <Input id={`tt-cap-${uid}`} type="number" inputMode="numeric" min={0} step={1} value={capacity} disabled={busy} onChange={(e) => setCapacity(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor={`tt-sort-${uid}`}>Sort</Label>
          <Input id={`tt-sort-${uid}`} type="number" inputMode="numeric" step={1} value={sort} disabled={busy} onChange={(e) => setSort(e.target.value)} />
        </div>
        <div className="space-y-1 sm:col-span-3 sm:grid sm:grid-cols-2 sm:gap-4 sm:space-y-0">
          <div className="space-y-1">
            <Label htmlFor={`tt-from-${uid}`}>Sale opens (optional)</Label>
            <Input id={`tt-from-${uid}`} type="datetime-local" value={from} disabled={busy} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="space-y-1 mt-4 sm:mt-0">
            <Label htmlFor={`tt-to-${uid}`}>Sale closes (optional)</Label>
            <Input id={`tt-to-${uid}`} type="datetime-local" value={to} disabled={busy} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </div>
      <label className="flex items-center gap-3 min-h-11 text-sm">
        <input type="checkbox" checked={active} disabled={busy} onChange={(e) => setActive(e.target.checked)} className="h-5 w-5 accent-brand" />
        Shown on the event page
      </label>
      <div className="flex flex-wrap gap-4">
        <button type="button" onClick={() => void handleSave()} disabled={busy} className="cta">
          <Save className="w-4 h-4" aria-hidden="true" />
          {type ? "Save type" : "Add ticket type"}
        </button>
        {type && (
          <button type="button" onClick={() => void handleDelete()} disabled={busy} className="linkr" aria-label={`Delete ${type.name}`}>
            <Trash2 className="w-4 h-4" aria-hidden="true" />
            Delete
          </button>
        )}
      </div>
    </div>
  );
}

/** Create or edit an event, and (once it is saved) its ticket types. Times are South African time. */
export function AdminEventForm({
  event,
  onSaved,
  onChanged,
  onClose,
  onApiError,
}: {
  /** null for a new event. */
  event: AdminEvent | null;
  /** Called with the saved event after the event itself is saved. */
  onSaved: (event: AdminEvent) => Promise<unknown>;
  /** Reload the events list after a ticket type changed. */
  onChanged: () => Promise<unknown>;
  onClose: () => void;
  onApiError: (err: unknown) => void;
}) {
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [startsAt, setStartsAt] = useState(isoToInput(event?.startsAt));
  const [endsAt, setEndsAt] = useState(isoToInput(event?.endsAt));
  const [venue, setVenue] = useState(event?.venue ?? "");
  const [city, setCity] = useState(event?.city ?? "");
  const [image, setImage] = useState(event?.image ?? "");
  const [status, setStatus] = useState<EventStatus>(event?.status ?? "draft");
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  // A new event keeps one id, so saving twice cannot create it twice.
  const newId = useRef<string | null>(null);

  const handleImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return void toast.error("Image must be a JPEG, PNG, WebP or GIF file");
    if (file.size > MAX_IMAGE_BYTES) return void toast.error("Image size should be less than 2MB");
    setUploading(true);
    try {
      setImage(await uploadImage(file));
      toast.success("Image uploaded");
    } catch (err) {
      onApiError(err);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy || uploading) return;
    const cleanTitle = title.trim();
    const startIso = inputToIso(startsAt);
    const endIso = endsAt ? inputToIso(endsAt) : null;
    if (!cleanTitle) return void toast.error("Event title is required");
    if (!startIso) return void toast.error("Choose when the event starts");
    if (endsAt && !endIso) return void toast.error("Check the end time");
    if (endIso && endIso < startIso) return void toast.error("The event cannot end before it starts");
    if (image.trim() && !isHttpUrl(image.trim())) return void toast.error("Image must be an http(s) link, or empty");
    setBusy(true);
    try {
      newId.current ??= crypto.randomUUID();
      const saved = await saveEvent(event?.id ?? newId.current, {
        title: cleanTitle,
        description: description.trim(),
        startsAt: startIso,
        endsAt: endIso,
        venue: venue.trim(),
        city: city.trim(),
        image: image.trim(),
        status,
      });
      toast.success(event ? `Saved ${saved.title}` : `Created ${saved.title}`);
      await onSaved(saved);
    } catch (err) {
      onApiError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit} className="border border-b10 r-card p-4 md:p-6 space-y-4" noValidate aria-label={event ? "Edit event" : "New event"}>
        <h3 className="display h-mid">{event ? "Edit event" : "New event"}</h3>
        <div className="space-y-1">
          <Label htmlFor="ev-title">Title</Label>
          <Input id="ev-title" value={title} maxLength={120} disabled={busy} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ev-description">Description</Label>
          <Textarea id="ev-description" rows={4} value={description} maxLength={4000} disabled={busy} onChange={(e) => setDescription(e.target.value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="ev-starts">Starts (South African time)</Label>
            <Input id="ev-starts" type="datetime-local" value={startsAt} disabled={busy} onChange={(e) => setStartsAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-ends">Ends (optional)</Label>
            <Input id="ev-ends" type="datetime-local" value={endsAt} disabled={busy} onChange={(e) => setEndsAt(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-venue">Venue</Label>
            <Input id="ev-venue" value={venue} maxLength={160} disabled={busy} onChange={(e) => setVenue(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ev-city">City</Label>
            <Input id="ev-city" value={city} maxLength={80} disabled={busy} onChange={(e) => setCity(e.target.value)} />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor="ev-image-file">Image (JPEG, PNG, WebP or GIF, up to 2MB)</Label>
          <Input id="ev-image-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif" disabled={uploading || busy} onChange={handleImage} className="text-xs" />
          <Input aria-label="Image URL" value={image} onChange={(e) => setImage(e.target.value)} placeholder="Or an image link" disabled={busy} className="text-xs" />
          {uploading && <p className="micro text-b60">Uploading…</p>}
          {image && !uploading && (
            <div className="relative aspect-[16/9] max-w-sm border border-b10 overflow-hidden bg-b5">
              <img src={image} alt="Event preview" className="w-full h-full object-cover" onError={(e) => (e.currentTarget.style.visibility = "hidden")} onLoad={(e) => (e.currentTarget.style.visibility = "visible")} />
              <button type="button" onClick={() => setImage("")} aria-label="Remove image" className="absolute top-1 right-1 bg-ink text-paper hover:bg-brand p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="ev-status">Status</Label>
          <select id="ev-status" className={selectClass} value={status} disabled={busy} onChange={(e) => setStatus(e.target.value as EventStatus)}>
            <option value="draft">Draft (hidden)</option>
            <option value="published">Published (on the website)</option>
            <option value="cancelled">Cancelled (hidden)</option>
          </select>
        </div>
        {event && <p className="text-xs text-b60 break-all">Link: /event/{event.slug}</p>}
        <div className="flex flex-wrap gap-4">
          <button type="submit" disabled={busy || uploading} className="cta">
            <Save className="w-4 h-4" aria-hidden="true" />
            {busy ? "Saving…" : "Save event"}
          </button>
          <button type="button" onClick={onClose} className="linkr">
            Close
          </button>
        </div>
      </form>

      <div className="space-y-4">
        <h3 className="display h-mid">Ticket types</h3>
        {!event ? (
          <p className="text-b60">Save the event first, then add ticket types here.</p>
        ) : (
          <>
            {event.ticketTypes.map((t) => (
              <TicketTypeRow key={t.id} eventId={event.id} type={t} nextSort={0} onChanged={onChanged} onApiError={onApiError} />
            ))}
            <TicketTypeRow
              key={`new-${event.ticketTypes.length}`}
              eventId={event.id}
              type={null}
              nextSort={event.ticketTypes.reduce((m, t) => Math.max(m, t.sort), 0) + 1}
              onChanged={onChanged}
              onApiError={onApiError}
            />
          </>
        )}
      </div>
    </div>
  );
}
