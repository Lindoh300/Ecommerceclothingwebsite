import { assert, assertEquals, assertRejects, assertThrows } from '@std/assert';
import {
  createFakeMailer,
  createResendMailer,
  listEmail,
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

Deno.test('resend: headers are sent only when set', async () => {
  const bodies: unknown[] = [];
  const m = createResendMailer(KEY, 'f@example.com', (_u, i) => {
    bodies.push(JSON.parse(i?.body as string));
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  await m.send({ to: 'a@example.com', subject: 's', text: 't' });
  await m.send({ to: 'a@example.com', subject: 's', text: 't', headers: {} });
  await m.send({ to: 'a@example.com', subject: 's', text: 't', headers: { 'List-Unsubscribe': '<https://x.example/unsubscribe>' } });
  assertEquals(bodies[0], { from: 'f@example.com', to: ['a@example.com'], subject: 's', text: 't' });
  assertEquals(bodies[1], bodies[0]);
  assertEquals((bodies[2] as { headers: unknown }).headers, { 'List-Unsubscribe': '<https://x.example/unsubscribe>' });
});

Deno.test('resend sendBatch: request shape', async () => {
  let url = '';
  let init: RequestInit | undefined;
  const m = createResendMailer(KEY, '4Nguru <news@example.com>', (u, i) => {
    url = u;
    init = i;
    return Promise.resolve(new Response('{"data":[]}', { status: 200 }));
  });
  await m.sendBatch([
    { to: 'a@example.com', subject: 'Hi', text: 'One', headers: { 'List-Unsubscribe': '<https://x.example/unsubscribe>' } },
    { to: 'b@example.com', subject: 'Hi', text: 'Two' },
  ]);
  assertEquals(url, 'https://api.resend.com/emails/batch');
  assertEquals(init?.method, 'POST');
  const h = init?.headers as Record<string, string>;
  assertEquals(h.Authorization, `Bearer ${KEY}`);
  assertEquals(JSON.parse(init?.body as string), [
    {
      from: '4Nguru <news@example.com>',
      to: ['a@example.com'],
      subject: 'Hi',
      text: 'One',
      headers: { 'List-Unsubscribe': '<https://x.example/unsubscribe>' },
    },
    { from: '4Nguru <news@example.com>', to: ['b@example.com'], subject: 'Hi', text: 'Two' },
  ]);
  assert(init?.signal instanceof AbortSignal);
});

Deno.test('resend sendBatch: 100 is fine; empty or over 100 throws without calling the provider', async () => {
  let calls = 0;
  const m = createResendMailer(KEY, 'f@example.com', () => {
    calls++;
    return Promise.resolve(new Response('{}', { status: 200 }));
  });
  const msg = (i: number) => ({ to: `p${i}@example.com`, subject: 's', text: 't' });
  await m.sendBatch(Array.from({ length: 100 }, (_, i) => msg(i)));
  assertEquals(calls, 1);
  await assertRejects(() => m.sendBatch([]));
  const e = await assertRejects(() => m.sendBatch(Array.from({ length: 101 }, (_, i) => msg(i))));
  assert(e instanceof Error && !e.message.includes(KEY));
  assertEquals(calls, 1);
});

Deno.test('resend sendBatch: non-2xx throws; the key never appears in an error', async () => {
  const one = [{ to: 'a@example.com', subject: 's', text: 't' }];
  const bad = createResendMailer(KEY, 'f@example.com', () => Promise.resolve(new Response(`bad ${KEY}`, { status: 422 })));
  const e1 = await assertRejects(() => bad.sendBatch(one));
  assert(e1 instanceof Error && e1.message.includes('422') && !e1.message.includes(KEY) && !e1.message.includes('a@example.com'));
  const down = createResendMailer(KEY, 'f@example.com', () => Promise.reject(new Error(`connect failed with ${KEY}`)));
  const e2 = await assertRejects(() => down.sendBatch(one));
  assert(e2 instanceof Error && !e2.message.includes(KEY));
});

Deno.test('fake mailer: sendBatch records in sent, enforces the limits and can be made to fail', async () => {
  const f = createFakeMailer();
  const msg = (i: number) => ({ to: `p${i}@example.com`, subject: 's', text: 't' });
  await f.send(msg(0));
  await f.sendBatch([msg(1), msg(2)]);
  assertEquals(f.sent.map((m) => m.to), ['p0@example.com', 'p1@example.com', 'p2@example.com']);
  assertEquals(f.batchSizes, [2]);
  await assertRejects(() => f.sendBatch([]));
  await assertRejects(() => f.sendBatch(Array.from({ length: 101 }, (_, i) => msg(i))));
  f.failNext = 2;
  await assertRejects(() => f.sendBatch([msg(3)]));
  await assertRejects(() => f.send(msg(4)));
  assertEquals(f.sent.length, 3);
  await f.sendBatch([msg(5)]);
  assertEquals(f.sent.length, 4);
});

Deno.test('listEmail: body, opt-out lines and header; no address in the link; refuses without a site address', () => {
  const site = 'https://shop.example.com';
  const m = listEmail('thandi@example.com', 'New drop', 'Hello!\nSee you Friday.', site);
  assertEquals(m.to, 'thandi@example.com');
  assertEquals(m.subject, 'New drop');
  assertEquals(
    m.text,
    'Hello!\nSee you Friday.\n\n--\nYou are getting this because you joined the 4Nguru list.\nTo stop, go to https://shop.example.com/unsubscribe',
  );
  assertEquals(m.headers, { 'List-Unsubscribe': '<https://shop.example.com/unsubscribe>' });
  assert(!m.text.includes('thandi') && !JSON.stringify(m.headers).includes('thandi'));
  // A trailing slash on the address does not double up.
  assertEquals(listEmail('a@example.com', 's', 'b', `${site}/`).headers, m.headers);
  for (const blank of ['', '  ', '/']) {
    assertThrows(() => listEmail('a@example.com', 's', 'b', blank));
  }
});
