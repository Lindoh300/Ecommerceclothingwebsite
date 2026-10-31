// An in-memory PaymentProvider for tests and the local dev server. It talks to nobody. It has its
// own simple webhook format (it is not Paystack's), checked with the same HMAC code as the real
// provider. Paystack's own wire format is only in payments.ts, and tested there against a stubbed fetch.
import {
  hmacSha512Hex,
  type PaymentEvent,
  type PaymentProvider,
  type StartPaymentInput,
  type VerifiedPayment,
  verifyHmacSha512Hex,
} from './payments.ts';

export const FAKE_SIGNATURE_HEADER = 'x-fake-signature';

export interface FakeTransaction {
  reference: string;
  amountCents: number;
  currency: string;
  email: string;
  paid: boolean;
}

export interface FakePayOverrides {
  /** Sign this text instead of the body that is returned (a body altered after signing). */
  signAs?: string;
  /** The event name in the body. Default 'paid'. */
  event?: string;
}

export interface FakeProvider extends PaymentProvider {
  /** Every transaction started, by reference. */
  readonly transactions: Map<string, FakeTransaction>;
  /** Every start() call, in order. */
  readonly starts: StartPaymentInput[];
  /** The next start() calls throw this (until cleared with null). */
  failStart(error: Error | null): void;
  /** Make verify(reference) answer this, or throw (an Error), instead of reporting the stored transaction. */
  setVerify(reference: string, answer: Partial<VerifiedPayment> | Error | null): void;
  /** The customer pays: marks the transaction paid and returns the webhook request (body + signature). */
  pay(reference: string, overrides?: FakePayOverrides): Promise<{ body: string; signature: string; headers: Record<string, string> }>;
}

export function createFakeProvider(secret: string): FakeProvider {
  const transactions = new Map<string, FakeTransaction>();
  const starts: StartPaymentInput[] = [];
  const verifyOverrides = new Map<string, Partial<VerifiedPayment> | Error>();
  let startError: Error | null = null;

  return {
    transactions,
    starts,
    failStart: (e) => {
      startError = e;
    },
    setVerify: (reference, answer) => {
      if (answer === null) verifyOverrides.delete(reference);
      else verifyOverrides.set(reference, answer);
    },

    start(input) {
      starts.push(structuredClone(input));
      if (startError) return Promise.reject(startError);
      transactions.set(input.reference, {
        reference: input.reference,
        amountCents: input.amountCents,
        currency: input.currency,
        email: input.email,
        paid: false,
      });
      return Promise.resolve({ redirectUrl: `https://fake-pay.test/pay/${input.reference}` });
    },

    async parseWebhook(rawBody, headers): Promise<PaymentEvent | null> {
      if (!(await verifyHmacSha512Hex(secret, rawBody, headers.get(FAKE_SIGNATURE_HEADER)))) return null;
      try {
        const p = JSON.parse(rawBody);
        if (p?.event === 'paid' && typeof p.reference === 'string' && p.reference !== '') {
          return { type: 'payment_success', reference: p.reference };
        }
      } catch {
        // not JSON: not an event we know
      }
      return { type: 'other' };
    },

    verify(reference): Promise<VerifiedPayment> {
      const o = verifyOverrides.get(reference);
      if (o instanceof Error) return Promise.reject(o);
      const t = transactions.get(reference);
      if (!t && !o) return Promise.reject(new Error('Unknown transaction'));
      return Promise.resolve({
        status: t?.paid ? 'success' : 'not_paid',
        reference,
        amountCents: t?.amountCents ?? 0,
        currency: t?.currency ?? 'ZAR',
        ...o,
      });
    },

    async pay(reference, overrides = {}) {
      const t = transactions.get(reference);
      if (t) t.paid = true;
      const body = JSON.stringify({ event: overrides.event ?? 'paid', reference });
      const signature = await hmacSha512Hex(secret, overrides.signAs ?? body);
      return { body, signature, headers: { [FAKE_SIGNATURE_HEADER]: signature, 'Content-Type': 'application/json' } };
    },
  };
}
