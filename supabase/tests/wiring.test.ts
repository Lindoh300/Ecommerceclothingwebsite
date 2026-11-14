// Wiring test: every database function, parameter and table that supabase/functions/server/index.tsx uses must exist in
// the migrated schema. index.tsx is the production wiring and no other test runs it (Deno tests use in-memory stores,
// the SQL tests call functions directly), so a typo in an rpc('name', { p_x }) call would only show up on live.
//
// index.tsx is read as TEXT and scanned with a small bracket-matching scanner, not a parser. Every migration is applied
// to PGlite in filename order, except the pg_cron one (PGlite has no pg_cron), like the other SQL tests. Run with
// `deno task test:sql` from supabase/functions/server.
import { assert, assertEquals } from '@std/assert';
import { PGlite } from 'npm:@electric-sql/pglite@0.5.13';
import { pgcrypto } from 'npm:@electric-sql/pglite@0.5.13/contrib/pgcrypto';

// deno-lint-ignore no-explicit-any
type Json = any;

const MIGRATIONS = new URL('../migrations/', import.meta.url);
const INDEX = new URL('../functions/server/index.tsx', import.meta.url);

// rpc calls the scanner cannot read (name or argument object not a literal). Each needs a reason. The `rpc` helper itself
// is `client().rpc(fn, args)` with a variable name; it is skipped because it is not a call with a literal name.
const DYNAMIC_ALLOWLIST: string[] = [];

/** Minimum number of rpc calls the scanner must find. 51 were found when this was written; a margin of 3. */
const MIN_RPC_CALLS = 48;

// ---- scanning index.tsx ----------------------------------------------------------------------------------------------

interface RpcCall {
  fn: string;
  keys: string[];
  line: number;
}

/** Index of the bracket that closes the one at `open`, skipping strings, template literals and comments. */
function matchClose(src: string, open: number): number {
  const pairs: Record<string, string> = { '(': ')', '{': '}', '[': ']' };
  const stack: string[] = [];
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < src.length && src[i] !== c; i++) if (src[i] === '\\') i++;
    } else if (c === '/' && src[i + 1] === '/') {
      while (i < src.length && src[i] !== '\n') i++;
    } else if (c === '/' && src[i + 1] === '*') {
      i = src.indexOf('*/', i + 2) + 1;
    } else if (pairs[c]) {
      stack.push(pairs[c]);
    } else if (c === ')' || c === '}' || c === ']') {
      if (stack.pop() !== c) throw new Error(`unbalanced bracket at ${i}`);
      if (stack.length === 0) return i;
    }
  }
  throw new Error(`no closing bracket for the one at ${open}`);
}

/** Top-level keys of an object literal `{ a: 1, b, 'c': x }`; `body` is the text between the braces. */
function topLevelKeys(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i++; i < body.length && body[i] !== c; i++) if (body[i] === '\\') i++;
    } else if (c === '/' && body[i + 1] === '/') {
      while (i < body.length && body[i] !== '\n') i++;
    } else if ('({['.includes(c)) depth++;
    else if (')}]'.includes(c)) depth--;
    else if (c === ',' && depth === 0) {
      parts.push(body.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(body.slice(start));
  const keys: string[] = [];
  for (const part of parts) {
    const text = part.replace(/\/\/[^\n]*/g, '').trim();
    if (!text) continue;
    const m = text.match(/^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))/);
    if (!m) throw new Error(`cannot read an argument key from: ${text.slice(0, 60)}`);
    keys.push(m[1] ?? m[2] ?? m[3]);
  }
  return keys;
}

/** Every `rpc<...>('fn', { ... })` and `.rpc('fn', { ... })` call with a literal function name and an object literal. */
function extractRpcCalls(src: string): { calls: RpcCall[]; occurrences: number } {
  const calls: RpcCall[] = [];
  let occurrences = 0;
  // `rpc` followed by `<` or `(`, as a call or generic call (not the word inside a comment or a longer identifier).
  for (const m of src.matchAll(/(?<![\w$])rpc\s*(?=[<(])/g)) {
    occurrences++;
    let i = m.index! + m[0].length;
    if (src[i] === '<') {
      // Skip the generic argument list, counting <> (an `=>` is not a closing bracket).
      let depth = 0;
      for (; i < src.length; i++) {
        if (src[i] === '<') depth++;
        else if (src[i] === '>' && src[i - 1] !== '=' && --depth === 0) break;
      }
      i++;
      while (/\s/.test(src[i])) i++;
    }
    if (src[i] !== '(') continue;
    const rest = src.slice(i + 1);
    const head = rest.match(/^\s*'([a-z_0-9]+)'\s*,\s*\{/);
    if (!head) continue; // dynamic: the helper's own `client().rpc(fn, args)`
    const braceAt = i + 1 + head[0].length - 1;
    const close = matchClose(src, braceAt);
    calls.push({
      fn: head[1],
      keys: topLevelKeys(src.slice(braceAt + 1, close)),
      line: src.slice(0, m.index).split('\n').length,
    });
  }
  return { calls, occurrences };
}

const indexText = Deno.readTextFileSync(INDEX);
// To prove the test fails, temporarily rename a function or key in this text, for example:
// const text = indexText.replace("'cancel_order_v2'", "'cancel_order_v9'");
const text = indexText;
const { calls, occurrences } = extractRpcCalls(text);
const tables = [...text.matchAll(/\.from\(\s*'([a-z_0-9]+)'\s*\)/g)].map((m) => m[1]);

// Columns read from `r.*` in orders.list.
const listStart = text.indexOf('async list() {');
const listBlock = text.slice(listStart, matchClose(text, text.indexOf('{', listStart)) + 1);
const orderColumns = [...new Set([...listBlock.matchAll(/(?<![\w$.])r\.([a-z_0-9]+)/g)].map((m) => m[1]))];

// ---- the migrated database -------------------------------------------------------------------------------------------

const SUPABASE_ROLES_SQL = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin;
  create schema if not exists storage;
  create table storage.buckets (
    id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]
  );
  -- Supabase hands every new table and function in public to these roles by default. Mirror that, so the migrations'
  -- revokes are really tested.
  grant usage on schema public to anon, authenticated, service_role;
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;

let dbPromise: Promise<PGlite> | undefined;
function migrated(): Promise<PGlite> {
  dbPromise ??= (async () => {
    const db = new PGlite({ extensions: { pgcrypto } });
    await db.exec(SUPABASE_ROLES_SQL);
    const files = [...Deno.readDirSync(MIGRATIONS)].map((e) => e.name).filter((n) => n.endsWith('.sql')).sort();
    // The pg_cron migration is never loaded: PGlite has no pg_cron.
    for (const f of files.filter((n) => !n.includes('cron'))) {
      await db.exec(await Deno.readTextFile(new URL(f, MIGRATIONS)));
    }
    return db;
  })();
  return dbPromise;
}

async function rows(sql: string, params: unknown[] = []): Promise<Json[]> {
  return ((await (await migrated()).query(sql, params)).rows) as Json[];
}

// ---- tests -----------------------------------------------------------------------------------------------------------

Deno.test('guard: the scanner finds every rpc call in index.tsx', () => {
  assert(calls.length >= MIN_RPC_CALLS, `found only ${calls.length} rpc calls, expected at least ${MIN_RPC_CALLS}`);
  // Occurrences of `rpc<` or `rpc(` in index.tsx = calls read + the helper definition's own call + allowlisted ones.
  // The helper is `const rpc = async <T,>(...)`, which does not match `rpc` followed by `<` or `(`; its body has one
  // dynamic `client().rpc(fn, args)`.
  assertEquals(
    occurrences,
    calls.length + 1 + DYNAMIC_ALLOWLIST.length,
    'an rpc call in index.tsx was not read (dynamic name or arguments?): fix the scanner or add it to DYNAMIC_ALLOWLIST',
  );
  for (const c of calls) assert(/^[a-z_0-9]+$/.test(c.fn), c.fn);
});

Deno.test('guard: tables and orders.list columns were found', () => {
  assert(tables.includes('orders'), `.from('...') calls found: ${tables.join(', ')}`);
  assert(orderColumns.length >= 15, `only ${orderColumns.length} r.* columns found in orders.list`);
});

for (const c of calls) {
  Deno.test(`rpc ${c.fn} (index.tsx line ${c.line}): exists, takes ${c.keys.join(', ') || 'no arguments'}, callable by service_role`, async () => {
    const found = await rows(
      `select p.oid, p.proargnames, p.pronargs, p.pronargdefaults, p.proargmodes,
              has_function_privilege('service_role', p.oid, 'execute') as can_execute
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = $1`,
      [c.fn],
    );
    assert(found.length > 0, `function public.${c.fn} does not exist (index.tsx line ${c.line})`);
    const problems: string[] = [];
    let ok = false;
    for (const f of found) {
      const names: string[] = f.proargnames ?? [];
      const modes: string[] | null = f.proargmodes;
      // Input parameters only (modes i, b, v); with no modes array all arguments are inputs.
      const inputs = names.filter((_, k) => !modes || ['i', 'b', 'v'].includes(modes[k]));
      const unknown = c.keys.filter((k) => !inputs.includes(k));
      const required = inputs.slice(0, f.pronargs - f.pronargdefaults);
      const missing = required.filter((k) => !c.keys.includes(k));
      if (unknown.length === 0 && missing.length === 0) {
        ok = true;
        assert(f.can_execute, `service_role cannot execute public.${c.fn}`);
      } else {
        problems.push(
          `public.${c.fn}(${inputs.join(', ')}): ` +
            `${unknown.length ? `unknown parameter ${unknown.join(', ')}` : ''}` +
            `${unknown.length && missing.length ? '; ' : ''}` +
            `${missing.length ? `missing required parameter ${missing.join(', ')}` : ''}`,
        );
      }
    }
    assert(ok, `index.tsx line ${c.line} calls ${c.fn} with (${c.keys.join(', ')}) which matches no overload: ${problems.join(' | ')}`);
  });
}

for (const t of [...new Set(tables)]) {
  Deno.test(`table ${t} (.from in index.tsx) exists in public`, async () => {
    const r = await rows(`select 1 from information_schema.tables where table_schema = 'public' and table_name = $1`, [t]);
    assert(r.length === 1, `table public.${t} does not exist`);
  });
}

Deno.test('orders.list reads only columns that exist on public.orders', async () => {
  const r = await rows(`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'orders'`);
  const have = new Set(r.map((x: Json) => x.column_name));
  const missing = orderColumns.filter((col) => !have.has(col));
  assertEquals(missing, [], `orders.list reads r.${missing.join(', r.')} which is not a column of public.orders`);
});
