// The email boundary. This is the ONLY file that knows Resend: its URL and request shape. app.ts talks to
// `Mailer` and builds the messages with the pure functions below. Plain text only.
//
// Contract used here (Resend): POST https://api.resend.com/emails
//   Authorization: Bearer <key>, JSON {from, to: [address], subject, text, headers?}; any non-2xx is a failure.
// Batch (the mailing list): POST https://api.resend.com/emails/batch, the same headers, a JSON array of at most 100
//   of those objects; any non-2xx is a failure.
// The key is only ever held inside the mailer object. It is never put in an error message.
import type { Order } from './types.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Extra email headers, such as List-Unsubscribe. Sent only when set. */
  headers?: Record<string, string>;
}

export interface Mailer {
  /** Throws when the email could not be sent; the message never contains the key. */
  send(msg: EmailMessage): Promise<void>;
  /** Sends 1 to MAX_BATCH emails in one request. Throws (without calling the provider) on an empty array or more than
   *  MAX_BATCH; throws when the request failed. The message never contains the key. */
  sendBatch(msgs: EmailMessage[]): Promise<void>;
}

/** The most emails in one sendBatch call (the provider's limit). */
export const MAX_BATCH = 100;

const RESEND_URL = 'https://api.resend.com/emails';
const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
const TIMEOUT_MS = 10_000;
const BATCH_TIMEOUT_MS = 15_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createResendMailer(
  apiKey: string,
  from: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Mailer {
  const redact = (text: string) => (apiKey === '' ? text : text.split(apiKey).join('[redacted]'));
  const payload = (msg: EmailMessage) => ({
    from,
    to: [msg.to],
    subject: msg.subject,
    text: msg.text,
    ...(msg.headers && Object.keys(msg.headers).length > 0 ? { headers: msg.headers } : {}),
  });
  const post = async (url: string, body: unknown, timeoutMs: number): Promise<void> => {
    let res: Response;
    try {
      res = await fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(redact(`Email request failed: ${e instanceof Error ? e.message : String(e)}`));
    }
    if (!res.ok) throw new Error(`Email provider error (HTTP ${res.status})`);
  };
  return {
    send: (msg) => post(RESEND_URL, payload(msg), TIMEOUT_MS),
    sendBatch(msgs) {
      if (msgs.length === 0) return Promise.reject(new Error('Email batch is empty'));
      if (msgs.length > MAX_BATCH) return Promise.reject(new Error(`Email batch is over ${MAX_BATCH}`));
      return post(RESEND_BATCH_URL, msgs.map(payload), BATCH_TIMEOUT_MS);
    },
  };
}

/** null when the key or the sender is unset or blank: order emails are then off. */
export function loadMailer(apiKey: string | undefined, from: string | undefined): Mailer | null {
  const key = apiKey?.trim();
  const sender = from?.trim();
  if (!key || !sender) return null;
  return createResendMailer(key, sender);
}

/** A mailer for tests and the local dev server. Sends nothing; remembers every message. */
export interface FakeMailer extends Mailer {
  /** Every email sent, from send and sendBatch alike, in order. */
  readonly sent: EmailMessage[];
  /** How many of the next send or sendBatch calls fail (and send nothing). Counts down; set it from a test. */
  failNext: number;
  /** The size of each sendBatch call that went through the checks, in order. */
  readonly batchSizes: number[];
}

export function createFakeMailer(): FakeMailer {
  const sent: EmailMessage[] = [];
  const batchSizes: number[] = [];
  const copy = (m: EmailMessage): EmailMessage => ({ ...m, ...(m.headers ? { headers: { ...m.headers } } : {}) });
  const mailer: FakeMailer = {
    sent,
    batchSizes,
    failNext: 0,
    send(msg) {
      if (mailer.failNext > 0) {
        mailer.failNext--;
        return Promise.reject(new Error('Email provider error (HTTP 500)'));
      }
      sent.push(copy(msg));
      return Promise.resolve();
    },
    sendBatch(msgs) {
      if (msgs.length === 0) return Promise.reject(new Error('Email batch is empty'));
      if (msgs.length > MAX_BATCH) return Promise.reject(new Error(`Email batch is over ${MAX_BATCH}`));
      batchSizes.push(msgs.length);
      if (mailer.failNext > 0) {
        mailer.failNext--;
        return Promise.reject(new Error('Email provider error (HTTP 500)'));
      }
      for (const m of msgs) sent.push(copy(m));
      return Promise.resolve();
    },
  };
  return mailer;
}

// ---------------------------------------------------------------------------
// The messages. Pure: an order and the site address in, a message out. null = the order has no email.
// None of them contains the street address, the phone number or the customer's note.
// ---------------------------------------------------------------------------
const SHOP = '4Nguru';
const rand = (n: number) => `R${n.toFixed(2)}`;

function orderBlock(o: Order, siteUrl: string | null): string[] {
  const out = [`Order ${o.ref}`, ''];
  for (const l of o.lines) {
    const opts = [l.size, l.color].filter((x) => x).join(', ');
    out.push(`${l.quantity} x ${l.name}${opts ? ` (${opts})` : ''}`);
  }
  out.push('', `Delivery: ${rand(o.deliveryFee ?? 0)}`, `Total: ${rand(o.total)}`);
  if (siteUrl) out.push('', `View your order: ${siteUrl}/order/${o.id}`);
  return out;
}

function build(o: Order, subject: string, intro: string[], siteUrl: string | null, extra: string[] = []): EmailMessage | null {
  const to = o.customer.email?.trim();
  if (!to) return null;
  const text = [`Hi ${o.customer.name},`, '', ...intro, '', ...extra, ...orderBlock(o, siteUrl), '', `${SHOP}`].join('\n');
  return { to, subject, text };
}

export function orderReceivedEmail(o: Order, siteUrl: string | null): EmailMessage | null {
  return build(o, `${SHOP}: we received your order ${o.ref}`, [`Thank you for your order. We have received it.`], siteUrl);
}

export function paymentReceivedEmail(o: Order, siteUrl: string | null): EmailMessage | null {
  return build(o, `${SHOP}: payment received for order ${o.ref}`, [`We have received your payment. Thank you.`], siteUrl);
}

export function orderShippedEmail(o: Order, siteUrl: string | null): EmailMessage | null {
  const t = o.tracking;
  const extra: string[] = [];
  if (t?.courier) extra.push(`Courier: ${t.courier}`);
  if (t?.number) extra.push(`Tracking number: ${t.number}`);
  if (t?.url) extra.push(`Track your parcel: ${t.url}`);
  if (extra.length) extra.push('');
  return build(o, `${SHOP}: your order ${o.ref} has shipped`, [`Your order has shipped.`], siteUrl, extra);
}

/**
 * An email for the mailing list: the body, then the opt-out lines. Every list email goes through here so none can go
 * without them. `siteUrl` is the live site address without a trailing slash; blank throws, so nothing is ever sent
 * without an unsubscribe link. The address is NOT put in the link: /unsubscribe asks for it.
 */
export function listEmail(to: string, subject: string, body: string, siteUrl: string): EmailMessage {
  const site = siteUrl.trim().replace(/\/+$/, '');
  if (!site) throw new Error('A list email needs the site address for its unsubscribe link');
  const link = `${site}/unsubscribe`;
  const text = [
    body,
    '',
    '--',
    `You are getting this because you joined the ${SHOP} list.`,
    `To stop, go to ${link}`,
  ].join('\n');
  return { to, subject, text, headers: { 'List-Unsubscribe': `<${link}>` } };
}
