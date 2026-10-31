// The payment provider boundary. This is the ONLY file that knows Paystack: its URLs, request
// and response shapes, the webhook header and event names. app.ts talks to `PaymentProvider`.
//
// Contract used here (Paystack's OpenAPI spec, github.com/PaystackOSS/openapi dist/paystack.yaml):
//   POST /transaction/initialize  {email, amount (integer, smallest unit: cents for ZAR), currency,
//                                  reference, metadata (object), callback_url?}
//                                 -> {status, message, data:{authorization_url, access_code, reference}}
//   GET  /transaction/verify/{reference} -> {status, message, data:{status, reference, amount, currency, ...}}
//   Webhook: header x-paystack-signature = hex HMAC-SHA512 of the RAW body keyed with the secret;
//            event `charge.success`, payload {event, data:{status, reference, amount, currency, ...}}.
//   Every call sends `Authorization: Bearer <secret>`.
// The secret is only ever held inside the provider object. It is never put in an error message.

export interface StartPaymentInput {
  /** Our unique id for the payment. The route uses the order id. */
  reference: string;
  /** Integer, in cents. */
  amountCents: number;
  currency: 'ZAR';
  email: string;
  /** The short order reference (for the provider's dashboard). */
  orderRef: string;
  callbackUrl?: string;
}

export type PaymentEvent = { type: 'payment_success'; reference: string } | { type: 'other' };

export interface VerifiedPayment {
  status: 'success' | 'not_paid';
  reference: string;
  amountCents: number;
  currency: string;
}

export interface PaymentProvider {
  /** Starts a payment. Throws when the provider refuses; the message never contains the key. */
  start(input: StartPaymentInput): Promise<{ redirectUrl: string }>;
  /** `rawBody` is the exact text received. null = the signature is missing or wrong. A genuine event
   *  that is not a successful payment is {type:'other'}. Never trust any amount in the body: call `verify`. */
  parseWebhook(rawBody: string, headers: Headers): Promise<PaymentEvent | null>;
  /** Asks the provider for the truth about a payment. Throws when it cannot be answered. */
  verify(reference: string): Promise<VerifiedPayment>;
}

const enc = new TextEncoder();

const importKey = (secret: string, usages: KeyUsage[]) =>
  crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-512' }, false, usages);

const toHex = (bytes: ArrayBuffer): string =>
  [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Lower-case hex of HMAC-SHA512(secret, body). A string body is hashed as its UTF-8 bytes. */
export async function hmacSha512Hex(secret: string, body: string | Uint8Array<ArrayBuffer>): Promise<string> {
  const data = typeof body === 'string' ? enc.encode(body) : body;
  return toHex(await crypto.subtle.sign('HMAC', await importKey(secret, ['sign']), data));
}

/** 128 hex digits (a SHA-512 digest) to bytes; null for anything else. */
function hexToBytes(hex: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[0-9a-fA-F]{128}$/.test(hex)) return null;
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/** True when `signatureHex` is the HMAC-SHA512 of `body` under `secret`. The comparison is done by
 *  crypto.subtle.verify, which is constant time. Malformed hex is false, never an error. */
export async function verifyHmacSha512Hex(secret: string, body: string, signatureHex: string | null): Promise<boolean> {
  if (signatureHex === null) return false;
  const sig = hexToBytes(signatureHex);
  if (!sig) return false;
  return await crypto.subtle.verify('HMAC', await importKey(secret, ['verify']), sig, enc.encode(body));
}

const BASE_URL = 'https://api.paystack.co';
const TIMEOUT_MS = 15_000;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function createPaystackProvider(
  secret: string,
  fetchImpl: FetchLike = (input, init) => fetch(input, init),
  callbackUrl?: string,
): PaymentProvider {
  /** Whatever we say about a failure, the key is not in it. */
  const redact = (text: string) => (secret === '' ? text : text.split(secret).join('[redacted]'));

  /** One call to Paystack. Returns the `data` of a status:true answer; throws otherwise. */
  async function call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Record<string, unknown>> {
    let res: Response;
    try {
      res = await fetchImpl(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${secret}`,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      throw new Error(redact(`Payment provider request failed: ${e instanceof Error ? e.message : String(e)}`));
    }
    let json: unknown = null;
    try {
      json = await res.json();
    } catch {
      // not JSON: handled below
    }
    const message = isRecord(json) && typeof json.message === 'string' ? json.message : '';
    if (!res.ok || !isRecord(json) || json.status !== true || !isRecord(json.data)) {
      throw new Error(redact(`Payment provider error (HTTP ${res.status})${message ? `: ${message}` : ''}`));
    }
    return json.data;
  }

  return {
    async start(input) {
      if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
        throw new Error('Payment amount must be a positive whole number of cents');
      }
      const callback = input.callbackUrl ?? callbackUrl;
      const data = await call('POST', '/transaction/initialize', {
        email: input.email,
        amount: input.amountCents,
        currency: input.currency,
        reference: input.reference,
        metadata: { orderRef: input.orderRef },
        ...(callback ? { callback_url: callback } : {}),
      });
      const url = data.authorization_url;
      if (typeof url !== 'string' || url === '') throw new Error('Payment provider returned no payment page');
      return { redirectUrl: url };
    },

    async parseWebhook(rawBody, headers) {
      const ok = await verifyHmacSha512Hex(secret, rawBody, headers.get('x-paystack-signature'));
      if (!ok) return null;
      let payload: unknown;
      try {
        payload = JSON.parse(rawBody);
      } catch {
        return { type: 'other' };
      }
      if (isRecord(payload) && payload.event === 'charge.success' && isRecord(payload.data)) {
        const reference = payload.data.reference;
        if (typeof reference === 'string' && reference !== '') return { type: 'payment_success', reference };
      }
      return { type: 'other' };
    },

    async verify(reference) {
      const data = await call('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
      if (data.reference !== reference) throw new Error('Payment provider answered for a different reference');
      const { amount, currency, status } = data;
      if (typeof amount !== 'number' || !Number.isInteger(amount) || amount < 0 || typeof currency !== 'string') {
        throw new Error('Payment provider returned an unreadable amount');
      }
      return { status: status === 'success' ? 'success' : 'not_paid', reference, amountCents: amount, currency };
    },
  };
}

/** null when the secret is unset or blank: online payment is then off. */
export function loadPaymentProvider(secret: string | undefined, callbackUrl?: string): PaymentProvider | null {
  const key = secret?.trim();
  if (!key) return null;
  return createPaystackProvider(key, undefined, callbackUrl?.trim() || undefined);
}
