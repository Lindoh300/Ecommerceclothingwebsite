import { useMemo, useRef, useState } from "react";
import { Download, Plus } from "lucide-react";
import { toast } from "../lib/toast";
import {
  deleteGalleryItem,
  listAdminGallery,
  listSubscribers,
  saveGalleryItem,
  unsubscribeSubscriber,
} from "../api/communityAdmin";
import { uploadImage } from "../api/products";
import type { AdminGalleryItem, Subscriber, SubscriberSource } from "../api/types";
import { useAdminList } from "../hooks/useAdminList";
import { toCsv } from "../utils/csv";
import { formatEventDate } from "../utils/eventTime";
import type { AdminSectionProps } from "./adminSections";
import { Input } from "./ui/input";
import { Label } from "./ui/label";

const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

const selectClass =
  "h-9 w-full rounded-md border border-input bg-input-background px-3 text-base md:text-sm outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:opacity-50";

const SOURCE_LABEL: Record<SubscriberSource, string> = {
  community: "Community page",
  footer: "Footer",
  event: "Event",
};

/** One gallery photo: caption and order are edited here, plus hide and delete. */
function GalleryRow({
  item,
  onChanged,
  onApiError,
}: {
  item: AdminGalleryItem;
  onChanged: () => Promise<unknown>;
  onApiError: (err: unknown) => void;
}) {
  const [caption, setCaption] = useState(item.caption);
  const [sort, setSort] = useState(String(item.sort));
  const [busy, setBusy] = useState(false);
  const sortNum = Number(sort);
  const sortOk = sort.trim() !== "" && Number.isInteger(sortNum);
  const dirty = caption.trim() !== item.caption || (sortOk && sortNum !== item.sort);

  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
    } catch (err) {
      onApiError(err);
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      if (!sortOk) return void toast.error("Order must be a whole number");
      await saveGalleryItem(item.id, { caption: caption.trim(), sort: sortNum });
      toast.success("Saved");
      await onChanged();
    });

  const toggle = () =>
    run(async () => {
      await saveGalleryItem(item.id, { active: !item.active });
      toast.success(item.active ? "Photo hidden" : "Photo shown");
      await onChanged();
    });

  const remove = () => {
    if (!window.confirm("Delete this photo? This cannot be undone.")) return;
    void run(async () => {
      await deleteGalleryItem(item.id);
      toast.success("Photo deleted");
      await onChanged();
    });
  };

  return (
    <li className="border border-b10 r-card p-4 flex flex-col gap-4 sm:flex-row">
      <div className="w-32 shrink-0 aspect-square bg-b5 overflow-hidden">
        <img src={item.image} alt={item.caption || "Gallery photo"} className="h-full w-full object-cover" />
      </div>
      <div className="min-w-0 flex-1 space-y-3">
        <p className={`micro ${item.active ? "text-ink" : "text-b60"}`}>{item.active ? "Shown" : "Hidden"}</p>
        <div className="space-y-1">
          <Label htmlFor={`gal-cap-${item.id}`}>Caption</Label>
          <Input id={`gal-cap-${item.id}`} value={caption} maxLength={300} disabled={busy} onChange={(e) => setCaption(e.target.value)} />
        </div>
        <div className="space-y-1 max-w-[8rem]">
          <Label htmlFor={`gal-sort-${item.id}`}>Order (lowest first)</Label>
          <Input id={`gal-sort-${item.id}`} type="number" inputMode="numeric" step={1} value={sort} disabled={busy} onChange={(e) => setSort(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <button type="button" className="linkr min-h-11" disabled={busy || !dirty} onClick={() => void save()}>
            Save
          </button>
          <button type="button" className="linkr min-h-11" disabled={busy} onClick={() => void toggle()}>
            {item.active ? "Hide" : "Show"}
          </button>
          <button type="button" className="linkr min-h-11" disabled={busy} onClick={remove}>
            Delete
          </button>
        </div>
      </div>
    </li>
  );
}

function AdminGallery({ onApiError }: AdminSectionProps) {
  const gallery = useAdminList(listAdminGallery, onApiError);
  const [caption, setCaption] = useState("");
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file || uploading) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) return void toast.error("Image must be a JPEG, PNG, WebP or GIF file");
    if (file.size > MAX_IMAGE_BYTES) return void toast.error("Image size should be less than 2MB");
    setUploading(true);
    try {
      const image = await uploadImage(file);
      // Goes to the end of the list: one more than the highest order in use.
      const sort = gallery.data.reduce((n, g) => Math.max(n, g.sort), 0) + 1;
      await saveGalleryItem(crypto.randomUUID(), { image, caption: caption.trim(), sort });
      toast.success("Photo added");
      setCaption("");
      await gallery.reload();
    } catch (err) {
      onApiError(err);
    } finally {
      setUploading(false);
    }
  };

  return (
    <section aria-labelledby="admin-gallery" className="space-y-6">
      <h3 id="admin-gallery" className="display h-mid">Gallery</h3>
      <div className="border border-b10 r-card p-4 md:p-6 space-y-3">
        <div className="space-y-1">
          <Label htmlFor="gal-new-caption">Caption for the new photo (optional)</Label>
          <Input id="gal-new-caption" value={caption} maxLength={300} disabled={uploading} onChange={(e) => setCaption(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="gal-new-file">Add a photo (JPEG, PNG, WebP or GIF, up to 2MB)</Label>
          <Input
            id="gal-new-file"
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            disabled={uploading}
            onChange={handleFile}
            className="text-xs"
          />
        </div>
        {uploading ? (
          <p className="micro text-b60">Uploading…</p>
        ) : (
          <p className="micro text-b60 flex items-center gap-2">
            <Plus className="w-3 h-3" aria-hidden="true" />
            The photo is added as soon as you choose the file.
          </p>
        )}
      </div>

      {gallery.loading && gallery.data.length === 0 && <p className="micro text-b60">Loading photos…</p>}
      {gallery.error && <p className="text-b60">Couldn't load the gallery: {gallery.error}</p>}
      {!gallery.loading && !gallery.error && gallery.data.length === 0 && (
        <p className="text-b60 border border-b10 p-6">No photos yet.</p>
      )}
      <ul className="space-y-4">
        {gallery.data.map((item) => (
          <GalleryRow key={item.id} item={item} onChanged={gallery.reload} onApiError={onApiError} />
        ))}
      </ul>
    </section>
  );
}

const contactOf = (s: Subscriber) => [s.phone, s.email].filter(Boolean).join(" · ");

function AdminSubscribers({ onApiError }: AdminSectionProps) {
  const subs = useAdminList(listSubscribers, onApiError);
  const [search, setSearch] = useState("");
  const [source, setSource] = useState<"all" | SubscriberSource>("all");
  const [busyId, setBusyId] = useState<string | null>(null);

  const active = useMemo(() => subs.data.filter((s) => !s.unsubscribedAt), [subs.data]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return subs.data.filter(
      (s) =>
        (source === "all" || s.source === source) &&
        (q === "" || [s.name, s.phone, s.email].some((v) => v?.toLowerCase().includes(q))),
    );
  }, [subs.data, search, source]);

  const unsubscribe = async (s: Subscriber) => {
    if (busyId) return;
    if (!window.confirm(`Opt ${s.name || contactOf(s)} out of the mailing list?`)) return;
    setBusyId(s.id);
    try {
      await unsubscribeSubscriber(s.id);
      toast.success("Opted out");
      await subs.reload();
    } catch (err) {
      onApiError(err);
    } finally {
      setBusyId(null);
    }
  };

  // Built in the browser, from the people who are still opted in. Cells that start with =, +, - or @ are escaped
  // in toCsv, so a spreadsheet cannot run them.
  const exportCsv = () => {
    const rows = [
      ["Name", "Phone", "Email", "Source", "Consent given", "Signed up"],
      ...active.map((s) => [s.name, s.phone, s.email, s.source, s.consentAt, s.createdAt]),
    ];
    const url = URL.createObjectURL(new Blob([toCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `4nguru-subscribers-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section aria-labelledby="admin-subscribers" className="space-y-6">
      <div className="flex flex-wrap justify-between items-center gap-4">
        <h3 id="admin-subscribers" className="display h-mid">Subscribers</h3>
        <button type="button" className="cta" onClick={exportCsv} disabled={active.length === 0}>
          <Download className="w-4 h-4" aria-hidden="true" />
          Export CSV
        </button>
      </div>
      <p className="font-mono text-sm">
        {active.length} active of {subs.data.length}
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="sub-search">Search</Label>
          <Input id="sub-search" value={search} placeholder="Name, phone or email" onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="sub-source">Source</Label>
          <select id="sub-source" className={selectClass} value={source} onChange={(e) => setSource(e.target.value as "all" | SubscriberSource)}>
            <option value="all">All sources</option>
            {(Object.keys(SOURCE_LABEL) as SubscriberSource[]).map((k) => (
              <option key={k} value={k}>{SOURCE_LABEL[k]}</option>
            ))}
          </select>
        </div>
      </div>

      {subs.loading && subs.data.length === 0 && <p className="micro text-b60">Loading subscribers…</p>}
      {subs.error && <p className="text-b60">Couldn't load subscribers: {subs.error}</p>}
      {!subs.loading && !subs.error && subs.data.length === 0 && <p className="text-b60 border border-b10 p-6">No subscribers yet.</p>}
      {subs.data.length > 0 && shown.length === 0 && <p className="text-b60 border border-b10 p-6">No subscribers match.</p>}

      <ul className="space-y-3">
        {shown.map((s) => (
          <li key={s.id} className="border border-b10 r-card p-4">
            <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 mb-1">
              <p className="micro text-b60">{SOURCE_LABEL[s.source]}</p>
              <p className={`micro ${s.unsubscribedAt ? "text-b60" : "text-ink"}`}>
                {s.unsubscribedAt ? `Opted out ${formatEventDate(s.unsubscribedAt)}` : "Active"}
              </p>
            </div>
            <p className="break-words">{s.name || "No name"}</p>
            <p className="font-mono text-sm break-all">{contactOf(s)}</p>
            <p className="text-sm text-b60">Signed up {formatEventDate(s.createdAt)}. Consent {formatEventDate(s.consentAt)}.</p>
            {!s.unsubscribedAt && (
              <button type="button" className="linkr min-h-11" disabled={busyId === s.id} onClick={() => void unsubscribe(s)}>
                Unsubscribe
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The Community section: the event photo gallery and the mailing list. */
export function AdminCommunity(props: AdminSectionProps) {
  return (
    <div className="space-y-12">
      <h2 className="display h-mid">Community</h2>
      <AdminGallery {...props} />
      <AdminSubscribers {...props} />
    </div>
  );
}
