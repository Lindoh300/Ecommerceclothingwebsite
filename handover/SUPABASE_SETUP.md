# Supabase setup

This guide sets up the Supabase project behind the storefront. The storefront's API runs as the edge function `make-server-fbb8f0e1` (`supabase/functions/server/`). Products are stored in the table `kv_store_fbb8f0e1`, and product images are stored in the public bucket `product-images`. Admins are Supabase Auth users.

The config and schema are in the repo:

- `supabase/config.toml`: project ID, function settings, and sign-up disabled.
- `supabase/migrations/20261021000000_init.sql`: the table, its locked-down RLS, and the image bucket.
- `.env.example`: the frontend environment variables.

Run every command from the repository root.

## 1. Create a project

1. Sign in at [supabase.com](https://supabase.com) and create a new project. Pick a region close to your customers and a strong database password.
2. Wait for the project to finish provisioning.
3. Note these three values. You need them in step 7.
   - **Project URL**: Project Settings → API → Project URL, for example `https://abcd1234.supabase.co`.
   - **Anon (public) key**: Project Settings → API → Project API keys → `anon` `public`.
   - **Project ref**: the part of the Project URL before `.supabase.co`, for example `abcd1234`.

Never put the `service_role` key in `.env` or anywhere in the frontend. The edge function receives it automatically.

## 2. Log in and link the CLI

```bash
supabase login
supabase link --project-ref <project-ref>
```

`supabase link` asks for the database password from step 1.

## 3. Apply the database migration

```bash
supabase db push
```

This creates the `kv_store_fbb8f0e1` table, turns on row level security with no policies, and creates the public `product-images` bucket. The migration is safe to run again.

## 4. Deploy the edge function

```bash
supabase functions deploy make-server-fbb8f0e1
```

The name must be `make-server-fbb8f0e1`. Every route is prefixed with it, and the frontend calls `${VITE_SUPABASE_URL}/functions/v1/make-server-fbb8f0e1/...`. Supabase provides `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions automatically, so you do not set them yourself.

## 5. Create the admin user

1. In the dashboard, go to **Authentication → Users → Add user → Create new user**.
2. Enter your admin email and a strong password, and tick **Auto Confirm User**.
3. Open **SQL Editor** and run this, using the same email:

   ```sql
   update auth.users
   set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"role":"admin"}'::jsonb
   where email = 'you@example.com';
   ```

The function checks `app_metadata.role` on the user's token. Set the role in SQL as shown, not in `user_metadata`, because users can edit `user_metadata` themselves. Sign out and back in after you change the role, so that the new token carries it.

## 6. Turn off public sign-up

Go to **Authentication → Sign In / Providers** (or **Authentication → Settings**, depending on the dashboard version) and make sure **Allow new users to sign up** is off. `supabase/config.toml` sets the same thing for the CLI. Only the admins you create should have accounts.

## 7. Configure the frontend and run it

```bash
cp .env.example .env
```

Open `.env` and fill in:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

Leave `VITE_API_BASE` empty for a hosted project. Then start the app:

```bash
npm install
npm run dev
```

Do not commit `.env`. It is gitignored. `.env.example` is the template that is committed.

## 8. Smoke test

Check that the deployed function responds. Replace `<url>` with your Project URL and `<anon key>` with your anon key:

```bash
curl -H "Authorization: Bearer <anon key>" <url>/functions/v1/make-server-fbb8f0e1/health
```

A healthy function returns `{"status":"ok"}`. A `401` usually means the anon key is wrong. A `404` usually means the function was not deployed under the name `make-server-fbb8f0e1`.

## Local development without a project

You can run the API on your machine, with no Supabase project. This needs [Deno](https://deno.com).

1. Start the function server:

   ```bash
   cd supabase/functions/server
   deno task dev
   ```

   It listens at `http://localhost:8787/make-server-fbb8f0e1`.

2. In the repo root `.env`, point the frontend at it:

   ```
   VITE_API_BASE=http://localhost:8787/make-server-fbb8f0e1
   ```

3. Run `npm run dev` in another terminal.

In this mode, admin writes accept only the token `dev-admin`. Anything else is rejected. Do not deploy with that behaviour, and do not use local mode with real customer data.

The old project in `utils/supabase/info.tsx` (`qahqqxugrtzkufkvjugq`) no longer resolves and is not used. Do not point the app at it. Follow the steps above to use a new project. Do not edit `utils/supabase/info.tsx`, because it is generated.
