# 4Nguru The Brand

South African clothing store with events and a community page. React Router 7 (server rendered) on Vercel, with a Supabase backend.

## Run it locally

1. Run `npm i`.
2. Copy `.env.example` to `.env` and fill in the Supabase URL and anon key.
3. Run `npm run dev`.

`VITE_*` values are read at build time, so rebuild or redeploy after changing them.

## Check it

```bash
npm test
npm run typecheck
npm run build
```

The server tests need Deno. Run these from `supabase/functions/server`:

```bash
deno task test
deno task test:sql
deno check index.tsx
```

## Deploy

Always in this order:

1. Apply the database migrations: `supabase db push`.
2. Deploy the edge function: `supabase functions deploy make-server-fbb8f0e1 --use-api`.
3. Deploy the site on Vercel, with `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` set. Set the framework preset to React Router and leave the output directory empty.

Never put a service role key or any other secret in `.env` or in a `VITE_` value. Server secrets go in Supabase edge function secrets.
