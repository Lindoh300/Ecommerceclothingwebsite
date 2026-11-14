import { useEffect, useState } from "react";
import { toast } from "../lib/toast";
import { getFitWall, hideFit, showFit, syncFitWall } from "../api/communityAdmin";
import type { AdminFitPhoto, AdminFitWall as FitWall } from "../api/types";
import { formatEventDate } from "../utils/eventTime";
import type { AdminSectionProps } from "./adminSections";

// What the owner reads for each reason the last Instagram check failed. Anything not listed gets the fallback.
const LAST_ERROR_TEXT: Record<string, string> = {
  fetch_failed:
    "Instagram didn't answer on the last check. The wall hasn't changed. If this stays, the access token may have expired.",
  image_failed: "A photo couldn't be copied on the last check. The next post took its place.",
};
const LAST_ERROR_FALLBACK = "The last check failed.";

/** A photo's Instagram handle, or "Instagram" when the post has no username. */
const handleOf = (username: string) => (username ? `@${username}` : "Instagram");

function FitRow({
  photo,
  busy,
  thumb,
  actionLabel,
  onAction,
}: {
  photo: AdminFitPhoto;
  busy: boolean;
  thumb: boolean;
  actionLabel: string;
  onAction: () => void;
}) {
  return (
    <li className="border border-b10 r-card p-4 flex flex-wrap items-center gap-4">
      {thumb && <img src={photo.image} alt="" className="h-16 w-16 shrink-0 object-cover r-card bg-b5" />}
      <div className="min-w-0 flex-1 flex flex-wrap items-center gap-x-5 gap-y-2">
        <p className="break-all">{handleOf(photo.username)}</p>
        <a href={photo.permalink} target="_blank" rel="noopener noreferrer" className="linkr min-h-11">
          View post
        </a>
      </div>
      <button type="button" className="linkr min-h-11" disabled={busy} onClick={onAction}>
        {actionLabel}
      </button>
    </li>
  );
}

/** The fit wall in the Community section: the tagged photos, what is hidden, and the Instagram check. */
export function AdminFitWall({ onApiError }: AdminSectionProps) {
  const [wall, setWall] = useState<FitWall | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      setWall(await getFitWall());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      onApiError(err);
    } finally {
      setLoading(false);
    }
  };

  // Loaded after mount, never during render (SSR).
  useEffect(() => {
    void load();
  }, []);

  // Runs one change, then reloads the wall. A failure goes to the session check and a toast.
  const run = async (action: () => Promise<unknown>, failedText: string, doneText?: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await action();
      if (doneText) toast.success(doneText);
      await load();
    } catch (err) {
      onApiError(err);
      toast.error(failedText);
    } finally {
      setBusy(false);
    }
  };

  const hide = (photo: AdminFitPhoto) => {
    if (!window.confirm("Hide this photo from the site?")) return;
    void run(() => hideFit(photo.id), "Couldn't hide the photo.", "Photo hidden");
  };

  const show = (photo: AdminFitPhoto) => {
    void run(() => showFit(photo.id), "Couldn't show the photo.", "Photo shown");
  };

  const check = () => {
    void run(() => syncFitWall(), "Couldn't check Instagram.");
  };

  const onWall = wall?.photos.filter((p) => !p.hidden) ?? [];
  const hidden = wall?.photos.filter((p) => p.hidden) ?? [];
  const lastError = wall?.status.lastError ?? "";
  const lastOkAt = wall?.status.lastOkAt ?? null;

  return (
    <section aria-labelledby="admin-fit-wall" className="space-y-6">
      <h3 id="admin-fit-wall" className="display h-mid">Your fit wall</h3>

      {loading && !wall && <p className="micro text-b60">Loading the fit wall…</p>}
      {error && !wall && <p className="text-b60">Couldn't load the fit wall: {error}</p>}

      {wall && !wall.enabled && (
        <p className="text-b60 border border-b10 p-6">
          Instagram isn't connected yet. The wall shows placeholder tiles until it is. Setup steps are in the owner handover.
        </p>
      )}

      {wall?.enabled && (
        <>
          <div className="border border-b10 r-card p-4 md:p-6 space-y-3">
            <p className="text-sm">
              {lastOkAt ? `Last checked: ${formatEventDate(lastOkAt)}` : "Not checked yet"}
            </p>
            {lastError && (
              <p role="alert" className="text-b60">
                {LAST_ERROR_TEXT[lastError] ?? LAST_ERROR_FALLBACK}
              </p>
            )}
            <button type="button" className="cta cta-quiet" disabled={busy} onClick={check}>
              Check Instagram now
            </button>
          </div>

          <div className="space-y-3">
            <h4 className="micro text-b60">On the wall</h4>
            {onWall.length === 0 && <p className="text-b60 border border-b10 p-6">No tagged photos yet.</p>}
            <ul className="space-y-3">
              {onWall.map((photo) => (
                <FitRow key={photo.id} photo={photo} busy={busy} thumb actionLabel="Hide" onAction={() => hide(photo)} />
              ))}
            </ul>
          </div>

          {hidden.length > 0 && (
            <div className="space-y-3">
              <h4 className="micro text-b60">Hidden</h4>
              <ul className="space-y-3">
                {hidden.map((photo) => (
                  <FitRow
                    key={photo.id}
                    photo={photo}
                    busy={busy}
                    thumb={false}
                    actionLabel="Show again"
                    onAction={() => show(photo)}
                  />
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </section>
  );
}
