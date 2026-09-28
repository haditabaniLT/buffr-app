# AGENTS.md

Guidance for coding agents working in this repo. Follow these conventions unless the user asks otherwise.

## What this is

Buffr is a parent financial-monitoring app. Parents link bank accounts (Plaid), invite a child, and get alerts when spending looks high-risk (gambling, crypto, payday loans, and similar categories). Roles are `admin`, `parent`, and `child`. The child UI lives under `/student`.

## Commands

Netlify builds with npm (`netlify.toml` → `npm run build`). `package-lock.json`, `yarn.lock`, and `bun.lockb` are all present. Use npm for installs and scripts so the lockfile matches deploy. Do not add another package manager.

```bash
npm install
npm run dev       # Vite dev server
npm run build     # production build
npm run preview   # preview the production build
npm run lint      # ESLint. eslint.config.js must stay a config module — do not append code after the export
npm run format    # Prettier
```

There is no test runner. After a change, run `npm run build` and exercise the affected route in the browser. There is no `.env.example`; secrets live in `.env` (gitignored) and in the host's environment. Never commit them or print them in logs.

## Stack

- TanStack Start + TanStack Router (file routes) on Vite 7 and React 19
- TypeScript, `strict`, path alias `@/*` → `src/*`
- Tailwind CSS v4 (`src/styles.css`, `@theme inline`) and shadcn/ui (New York, slate, CSS variables, Lucide)
- Supabase (Postgres, Auth, RLS, Edge Functions)
- React Query is installed; most pages load data with `useServerFn` inside `useEffect` instead
- Deploy target is Netlify (`@netlify/vite-plugin-tanstack-start`). `wrangler.jsonc` is leftover template config. Do not switch the deploy target unless asked.

## Layout

```
src/routes/                  file routes (the router)
src/components/              product components (AppShell, tables, KPIs)
src/components/ui/           shadcn primitives — treat as generated
src/lib/server/              server functions, one folder per role, then one file per service
  auth.ts                    session snapshot (the caller does not know the role yet)
  public/invitations.ts      invite acceptance (no session role)
  parent/                    parent services; every handler calls requireParent
  child/                     child services; every handler calls requireChild or requireAdultChild
  admin/                     admin services; every handler calls requireAdmin
src/lib/server-helpers.ts    retries and role guards
src/lib/auth.tsx             client auth context
src/integrations/supabase/   generated Supabase clients and types
supabase/migrations/         SQL migrations, applied in filename order
supabase/functions/          Deno edge functions (Plaid webhook)
```

## Routing

Routes are TanStack file routes. A dot in the filename is a path segment. `parent.tsx` is the `/parent` layout, `parent.index.tsx` is `/parent`, `parent.flagged.tsx` is `/parent/flagged`, `invite.$token.tsx` is `/invite/$token`.

Add a page by creating `src/routes/<name>.tsx` that exports `Route = createFileRoute(...)`. The dev server regenerates `src/routeTree.gen.ts`. Do not edit that file.

Layout routes (`parent.tsx`, `student.tsx`, `admin.tsx`) wrap children in `AppShell` and redirect on the client when the session role does not match. That redirect is not authorization. Every privileged server function must check the role itself.

Public routes: `/`, `/login`, `/signup`, `/forgot`, `/reset-password`, `/onboarding`, `/invite/$token`, `/privacy`, `/terms`. API routes: `/api/public/twilio-inbound` (live) and `/api/public/plaid-webhook` (deprecated; see below).

`/parent/simulate` is registered only when `import.meta.env.DEV` is true. Keep sandbox Plaid helpers off production UI.

## Auth and server functions

Client auth uses the publishable Supabase client (`@/integrations/supabase/client`) inside `AuthProvider`. The session, profile, and role are cached in `localStorage` under `buffr.profile`, `buffr.role`, and `buffr.uid`. Role comes from the `get_primary_role` RPC, not from a client-supplied field.

Privileged work goes through a role factory under `src/lib/server/<role>/<service>.ts`: `createParentServerFn`, `createAdminServerFn`, `createChildServerFn`, or `createAdultChildServerFn`. A function used by more than one role is reimplemented in each role's folder. Do not import a parent service from a child or admin module. The client passes the current access token:

```ts
const token = (await supabase.auth.getSession()).data.session?.access_token ?? null;
const result = await someServerFn({ data: { accessToken: token } });
```

The factory checks that token and calls `requireParent`, `requireAdmin`, `requireChild`, or `requireAdultChild` before the handler runs. The handler receives `context` with `supabaseAdmin` and that role's user id. Add `.inputValidator(...)` only for the rest of the payload. Those helpers verify the JWT with the service-role client, reject `suspended` and `blocked` accounts, and check `get_primary_role`. `createAdultChildServerFn` also rejects `users.is_minor` — minors cannot link or remove their own bank accounts. Do not let a client update `role`, `status`, `is_minor`, or `date_of_birth`; the `users_block_sensitive_updates` trigger rejects those writes from non-admins.

`supabaseAdmin` (`client.server.ts`) bypasses RLS. Import it only inside server functions, server routes, or `*.server.ts` files, and only after a role check. Never import it from a client component.

`requireSupabaseAuth` in `auth-middleware.ts` is generated and unused. New privileged functions should use the role factory for that folder. `getAuthSnapshot` and invite acceptance stay on `createServerFn` because they run before a role is known.

Wrap Supabase calls that can fail transiently with `withRetry`. Return plain objects or throw `Error` with a message safe to show the user. Use `extractMessage` for PostgREST errors.

## Domain

Roles (`app_role`): `admin` | `parent` | `child`. The child role's URLs and nav say "student". When linking between areas, send `child` to `/student`, `parent` to `/parent`, `admin` to `/admin`.

Main tables: `users`, `bank_accounts`, `transactions`, `merchants`, `invitations`, `notifications`, `sms_logs`, `faqs`, `content_pages`, `plaid_webhook_events`.

Enums worth matching exactly: `user_status` (`active` | `suspended` | `blocked`), `invitation_status` (`pending` | `accepted` | `expired`), `risk_level` (`low` | `medium` | `high`), and `flag_category` (gambling, payday_loan, crypto, high_risk, adult_content, mlm, dark_web, tobacco_minor, gaming_lootbox, suspicious_marketplace, other_risk).

Plaid access tokens are stored on `bank_accounts.plaid_access_token`. The Data API grant for `authenticated` does not include that column or `transactions_sync_cursor`. Never select or return them to the client. New Plaid webhook traffic belongs on the `transaction-webhook` edge function, which verifies the Plaid ES256 JWT and syncs transactions. Do not log Plaid secrets, request headers, or raw webhook bodies. The TanStack route `src/routes/api/public/plaid-webhook.ts` is deprecated and must not write to the database.

Inbound SMS (STOP / HELP, A2P opt-out) is `src/routes/api/public/twilio-inbound.ts`. Validate `X-Twilio-Signature` before changing `users.sms_opted_out`. Honor that flag when sending alerts. `simulate-transaction` must refuse to run when `PLAID_ENV=production`.

`src/lib/store.tsx` and `src/lib/mock-data.ts` are a leftover demo layer. `AppShell` still reads `currentUser` from the store, and several pages map real rows through `dbTxToMock`. New features should read and write Supabase through server functions. Do not add new product state to the mock store.

## UI

Product UI uses the existing shadcn primitives (`Button`, `Card`, and the rest of `@/components/ui`). Merge classes with `cn()` from `@/lib/utils`. Icons come from `lucide-react`. Add product components under `src/components/`, not inside `ui/`.

Authenticated pages render inside `AppShell`. Put the page title in `PageHeader`. Nav items live in `navByRole` in `src/components/AppShell.tsx`. Toasts use Sonner (`@/components/ui/sonner`), which is mounted in the root shell.

## Database and edge functions

Schema changes are new files in `supabase/migrations/`. Name them `YYYYMMDDHHMMSS_short_description.sql`. Do not edit a migration that has already been applied.

After a schema change, regenerate `src/integrations/supabase/types.ts` (`supabase gen types`) rather than hand-writing table types. The same applies to `client.ts`, `client.server.ts`, and `auth-middleware.ts` — their headers say they are generated.

Edge functions are Deno (`npm:` specifiers) under `supabase/functions/`. Shared Plaid and Twilio helpers live in `supabase/functions/_shared/`. Deploy the webhook with JWT verification disabled at the gateway, because Plaid does not send a Supabase JWT:

```bash
supabase functions deploy transaction-webhook --no-verify-jwt
```

## Environment

Server code reads `process.env`. The browser client also accepts `VITE_` copies for the publishable Supabase values.

| Name | Used for |
| --- | --- |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY` | Supabase. `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are the client aliases |
| `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`, `PLAID_WEBHOOK_URL` | Plaid. `PLAID_ENV=production` selects production; anything else is sandbox |
| `OPENAI_API_KEY` | Transaction risk classification. Missing key fails open (no flag) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS alerts. `TWILIO_AUTH_TOKEN` also verifies inbound webhook signatures |
| `TWILIO_WEBHOOK_URL` | Exact public URL of `/api/public/twilio-inbound`, used when the host header does not match the URL Twilio signed |
| `RESEND_API_KEY` | Child invitation email |
| `SITE_URL` | Links in email. Netlify also injects `URL` |

## Generated and leftover files

Do not hand-edit:

- `src/routeTree.gen.ts`
- `src/integrations/supabase/client.ts`
- `src/integrations/supabase/client.server.ts`
- `src/integrations/supabase/auth-middleware.ts`
- `src/integrations/supabase/types.ts`
- `src/components/ui/*` (change these only to fix a real bug in a primitive)

`package.json` is still named `tanstack_start_ts`. That is the starter name, not a task to rename it.
