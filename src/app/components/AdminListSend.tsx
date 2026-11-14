import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "../lib/toast";
import { continueListSend, createListSend, getListSends, listSubscribers, sendListTest } from "../api/communityAdmin";
import { ApiError } from "../api/client";
import type { ListSendSummary } from "../api/types";
import { formatEventDate } from "../utils/eventTime";
import type { AdminSectionProps } from "./adminSections";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Textarea } from "./ui/textarea";

// The provider allows 2 requests a second, so batches are spaced out.
const BATCH_GAP_MS = 600;
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Email the mailing list: write it, send a test to yourself, then send it in batches. */
export function AdminListSend({ onApiError }: AdminSectionProps) {
  const [emailOn, setEmailOn] = useState(false);
  const [sends, setSends] = useState<ListSendSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [withEmail, setWithEmail] = useState(0);
  const [phoneOnly, setPhoneOnly] = useState(0);

  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);
  const [stalledId, setStalledId] = useState<string | null>(null);

  const runningRef = useRef(false);
  const testingRef = useRef(false);
  // One id per attempt, so a retry after a network failure on the save reuses it. Made in the handler.
  const attemptId = useRef<string | null>(null);
  const mounted = useRef(true);
  const onApiErrorRef = useRef(onApiError);
  useEffect(() => {
    onApiErrorRef.current = onApiError;
  });
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [res, subs] = await Promise.all([getListSends(), listSubscribers()]);
      if (!mounted.current) return;
      setEmailOn(res.emailOn);
      setSends(res.sends);
      const active = subs.filter((s) => !s.unsubscribedAt);
      setWithEmail(active.filter((s) => s.email).length);
      setPhoneOnly(active.filter((s) => !s.email && s.phone).length);
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "Something went wrong");
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) onApiErrorRef.current(err);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  /** Sends batch after batch. The caller holds runningRef. Returns true when nothing is left to send. */
  const sendLoop = async (id: string): Promise<boolean> => {
    setStalledId(null);
    let first = true;
    while (mounted.current) {
      if (!first) await wait(BATCH_GAP_MS);
      first = false;
      try {
        const { send, batchFailed } = await continueListSend(id);
        if (mounted.current) setProgress({ sent: send.sent, total: send.total });
        if (batchFailed) {
          if (mounted.current) setStalledId(id);
          return false;
        }
        if (send.pending === 0) return true;
      } catch (err) {
        onApiErrorRef.current(err);
        if (mounted.current) setStalledId(id);
        return false;
      }
    }
    return false;
  };

  const finish = async (done: boolean, fromForm: boolean) => {
    if (!done || !mounted.current) return;
    toast.success("Sent to the list");
    if (fromForm) {
      setSubject("");
      setBody("");
    }
    setProgress(null);
    await reload();
  };

  // Continue or Try again on a send that already exists.
  const resume = async (id: string) => {
    if (runningRef.current) return;
    runningRef.current = true;
    setRunning(true);
    try {
      await finish(await sendLoop(id), false);
    } finally {
      runningRef.current = false;
      if (mounted.current) setRunning(false);
    }
  };

  const send = async () => {
    if (runningRef.current) return;
    const s = subject.trim();
    const b = body.trim();
    if (!s || !b || withEmail === 0) return;
    if (!window.confirm(`Send this email to ${withEmail} ${withEmail === 1 ? "person" : "people"}? This cannot be undone.`)) return;
    runningRef.current = true;
    setRunning(true);
    setProgress(null);
    try {
      if (!attemptId.current) attemptId.current = crypto.randomUUID();
      let created: ListSendSummary;
      try {
        created = await createListSend(attemptId.current, { subject: s, body: b });
      } catch (err) {
        onApiErrorRef.current(err);
        return;
      }
      attemptId.current = null;
      setProgress({ sent: created.sent, total: created.total });
      await finish(await sendLoop(created.id), true);
    } finally {
      runningRef.current = false;
      if (mounted.current) setRunning(false);
    }
  };

  const test = async () => {
    if (testingRef.current) return;
    if (!subject.trim() || !body.trim() || !testTo.trim()) return void toast.error("Add a subject, a message and an address first");
    testingRef.current = true;
    setTesting(true);
    try {
      await sendListTest({ subject: subject.trim(), body: body.trim(), to: testTo.trim() });
      toast.success(`Test sent to ${testTo.trim()}`);
    } catch (err) {
      if (err instanceof ApiError && err.status !== 401 && err.status !== 403) toast.error(err.message);
      else onApiErrorRef.current(err);
    } finally {
      testingRef.current = false;
      if (mounted.current) setTesting(false);
    }
  };

  const blank = !subject.trim() || !body.trim();

  return (
    <section aria-labelledby="admin-list-send" className="space-y-6">
      <h3 id="admin-list-send" className="display h-mid">Send to the list</h3>

      {loading && sends.length === 0 && <p className="micro text-b60">Loading…</p>}
      {error && <p className="text-b60">Couldn't load the mailing list emails: {error}</p>}

      {!loading && !error && !emailOn && (
        <p className="text-b60 border border-b10 p-6">Email is off. It switches on once the email account is set up.</p>
      )}

      {emailOn && (
        <div className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="ls-subject">Subject</Label>
            <Input id="ls-subject" value={subject} maxLength={150} disabled={running} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ls-body">Message</Label>
            <Textarea id="ls-body" rows={8} value={body} maxLength={10000} disabled={running} onChange={(e) => setBody(e.target.value)} />
          </div>
          <p className="text-sm">
            {`Goes to ${withEmail} ${withEmail === 1 ? "person" : "people"} with an email address.`}
            {phoneOnly > 0 &&
              (phoneOnly === 1
                ? " 1 person on the list has only a phone number and won't get it."
                : ` ${phoneOnly} on the list have only a phone number and won't get it.`)}
          </p>
          <p className="micro text-b60">An unsubscribe line is added to the end of every email.</p>

          <div className="space-y-1">
            <Label htmlFor="ls-test">Send a test to</Label>
            <Input id="ls-test" type="email" inputMode="email" autoComplete="email" value={testTo} disabled={testing} onChange={(e) => setTestTo(e.target.value)} />
          </div>
          <button type="button" className="linkr min-h-11" disabled={testing || running || blank || !testTo.trim()} onClick={() => void test()}>
            Send test
          </button>

          <div>
            <button type="button" className="cta" disabled={blank || withEmail === 0 || running} onClick={() => void send()}>
              Send to the list
            </button>
          </div>

          <div role="status" className="text-sm">
            {progress && `Sent ${progress.sent} of ${progress.total}`}
          </div>
          {stalledId && !running && (
            <div className="space-y-1">
              <p className="text-sm">A batch failed. Try again.</p>
              <button type="button" className="linkr min-h-11" onClick={() => void resume(stalledId)}>
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {!loading && !error && sends.length === 0 && <p className="text-b60 border border-b10 p-6">No emails sent yet.</p>}

      <ul className="space-y-3">
        {sends.map((s) => (
          <li key={s.id} className="border border-b10 r-card p-4">
            <p className="break-words">{s.subject}</p>
            <p className="text-sm text-b60">{`Sent ${formatEventDate(s.createdAt)}`}</p>
            <p className="text-sm">{`${s.sent} sent, ${s.skipped} skipped, ${s.failed} failed`}</p>
            {s.pending > 0 && !running && (
              <>
                <p className="text-sm text-b60">{`${s.pending} still to send.`}</p>
                <button type="button" className="linkr min-h-11" onClick={() => void resume(s.id)}>
                  Continue
                </button>
              </>
            )}
            {s.sending > 0 && s.pending === 0 && !running && (
              <p className="text-sm text-b60">{`${s.sending} may not have gone out. The send stopped partway, and they won't be retried.`}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
