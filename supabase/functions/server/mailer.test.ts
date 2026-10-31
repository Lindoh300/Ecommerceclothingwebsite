import { assert, assertEquals, assertRejects } from '@std/assert';
import {
  createResendMailer,
  loadMailer,
  orderReceivedEmail,
  orderShippedEmail,
  paymentReceivedEmail,
} from './mailer.ts';
import type { Order } from './types.ts';

const KEY = 're_secret_key_123';
const order: Order = {
  id: '11111111-1111-4111-8111-111111111111',
  ref: 'ABC123',
  createdAt: '2026-06-01T10:00:00.000Z',
  status: 'paid',
  lines: [
    { productId: '1', name: 'Tee', price: 100, size: 'M', color: 'Black', quantity: 2, subtotal: 200 },
    { productId: '2', name: 'Cap', price: 50, quantity: 1, subtotal: 50 },
  ],
  total: 335,
  deliveryFee: 85,
  customer: { name: 'Thandi', phone: '0821234567', email: 'thandi@example.com', note: 'gate code 99' },
  delivery: { method: 'door', address: { line1: '12 Main Rd', suburb: 'Sea Point', city: 'Cape Town', postalCode: '8005' }, fee: 85 },
  tracking: { courier: 'Courier X', number: 'TN42', url: 'https://t.example.com/TN42' },
};

Deno.test('resend: request shape', async () => {
  let url = '';
  let init: RequestInit | undefined;
  const m = createResendMailer(KEY, '4Nguru <orders@example.com>', (u, i) => {
    url = u;
    init = i;
    return Promise.resolve(new Response('{"id":"x"}', { status: 200 }));
  });
  await m.send({ to: 'a@example.com', subject: 'Hi', text: 'Body' });
  assertEquals(url, 'https://api.resend.com/emails');
  assertEquals(init?.method, 'POST');
  const h = init?.headers as Record<string, string>;
  assertEquals(h.Authorization, `Bearer ${KEY}`);
  assertEquals(JSON.parse(init?.body as string), {
    from: '4Nguru <orders@example.com>',
    to: ['a@example.com'],
    subject: 'Hi',
    text: 'Body',
  });
  assert(init?.signal instanceof AbortSignal);
});

Deno.test('resend: non-2xx throws without the key; a network error is redacted', async () => {
  const bad = createResendMailer(KEY, 'f@example.com', () => Promise.resolve(new Response(`bad ${KEY}`, { status: 403 })));
  const e1 = await assertRejects(() => bad.send({ to: 'a@example.com', subject: 's', text: 't' }));
  assert(e1 instanceof Error && e1.message.includes('403') && !e1.message.includes(KEY));
  const down = createResendMailer(KEY, 'f@example.com', () => Promise.reject(new Error(`connect failed with ${KEY}`)));
  const e2 = await assertRejects(() => down.send({ to: 'a@example.com', subject: 's', text: 't' }));
  assert(e2 instanceof Error && !e2.message.includes(KEY));
});

Deno.test('loadMailer: null unless both key and sender are set', () => {
  assertEquals(loadMailer(undefined, 'f@example.com'), null);
  assertEquals(loadMailer('  ', 'f@example.com'), null);
  assertEquals(loadMailer(KEY, undefined), null);
  assertEquals(loadMailer(KEY, ' '), null);
  assert(loadMailer(KEY, 'f@example.com') !== null);
});

Deno.test('messages: content, link and privacy', () => {
  const site = 'https://shop.example.com';
  for (const build of [orderReceivedEmail, paymentReceivedEmail, orderShippedEmail]) {
    const m = build(order, site)!;
    assertEquals(m.to, 'thandi@example.com');
    for (const part of ['4Nguru', 'ABC123', '2 x Tee (M, Black)', '1 x Cap', 'Delivery: R85.00', 'Total: R335.00', `${site}/order/${order.id}`]) {
      assert((m.subject + m.text).includes(part), part);
    }
    for (const secret of ['Main Rd', 'Sea Point', '8005', '0821234567', 'gate code']) assert(!m.text.includes(secret), secret);
    assert(!build(order, null)!.text.includes('/order/'));
  }
  const s = orderShippedEmail(order, null)!;
  for (const part of ['Courier X', 'TN42', 'https://t.example.com/TN42']) assert(s.text.includes(part), part);
  const bare = orderShippedEmail({ ...order, tracking: null }, null)!;
  assert(!bare.text.includes('Courier') && !bare.text.includes('Tracking'));
});

Deno.test('messages: no email on the order gives null', () => {
  const o = { ...order, customer: { name: 'T', phone: '1' } };
  assertEquals(orderReceivedEmail(o, null), null);
  assertEquals(paymentReceivedEmail(o, null), null);
  assertEquals(orderShippedEmail(o, null), null);
});
