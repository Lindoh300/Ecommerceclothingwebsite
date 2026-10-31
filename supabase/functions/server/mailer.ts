// The email boundary. This is the ONLY file that knows Resend: its URL and request shape. app.ts talks to
// `Mailer` and builds the messages with the pure functions below. Plain text only.
//
// Contract used here (Resend): POST https://api.resend.com/emails
//   Authorization: Bearer <key>, JSON {from, to: [address], subject, text}; any non-2xx is a failure.
// The key is only ever held inside the mailer object. It is never put in an error message.
import type { Order } from './types.ts';

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
}

export interface Mailer {
  /** Throws when the email could not be sent; the message never contains the key. */
  send(msg: EmailMessage): Promise<void>;
}

const RESEND_URL = 'https://api.resend.com/emails';
const TIMEOUT_MS = 10_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export function createResendMailer(
  apiKey: string,
  from: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
): Mailer {
  const redact = (text: string) => (apiKey === '' ? text : text.split(apiKey).join('[redacted]'));
  return {
    async send(msg) {
      let res: Response;
      try {
        res = await fetchImpl(RESEND_URL, {
          method: 'POST',
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ from, to: [msg.to], subject: msg.subject, text: msg.text }),
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (e) {
        throw new Error(redact(`Email request failed: ${e instanceof Error ? e.message : String(e)}`));
      }
      if (!res.ok) throw new Error(`Email provider error (HTTP ${res.status})`);
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
  readonly sent: EmailMessage[];
}

export function createFakeMailer(): FakeMailer {
  const sent: EmailMessage[] = [];
  return {
    sent,
    send(msg) {
      sent.push({ ...msg });
      return Promise.resolve();
    },
  };
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
