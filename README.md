# Moolah

Envelope budgeting for households: give every shekel a job, log what you
spend in seconds, and reconcile with your bank and card statements.

This repository is the public app for iOS, Android and the web.

## Layout

- `engine/` — the budget rules as pure functions. `budget.js` works out every
  figure for a month, `ops.js` builds the changes the screens make,
  `state.js` shapes it all for the screens, `backend.js` answers the
  screens' actions over a store, and `setup.js` makes a new, empty household.
  `supabase-store.js` is the store over Supabase.
- `web/` — the app: `index.html` holds the screens (ported from the personal
  Moolah by `tools/port_screens.py`), `app.js` sign-in, start-up and the
  first-run set-up, `config.js` which Supabase project it uses.
- `supabase/migrations/` — the database, with row-level security.
  `supabase/functions/delete-account/` deletes an account from inside the app.
- `test/` — `npm test` (engine and store), `npm run test:db` (database rules,
  on a local Postgres), and two runs in a phone-sized browser: the first run
  on the device (`build:e2e-local`, `test:e2e:local`) and signing in against
  a stand-in for Supabase (`build:e2e-signin`, `test:e2e:sign-in`).

## Running it

    npm install
    npm run dev          # http://localhost:5173
    npm run build        # the site, in dist/

## Supabase

1. SQL Editor: run each file in `supabase/migrations/`, in order.
2. Authentication → Emails: put `{{ .Token }}` (the sign-in code) in the
   Magic Link and Confirm signup templates. The app signs in by emailed code.
3. Edge Functions: deploy `supabase/functions/delete-account/index.ts` as
   `delete-account`, with Verify JWT off (it checks the sign-in itself).
4. Put the project's publishable key in `web/config.js` (it is public by
   design; never the secret key).

## Status

Sign-in by emailed code, budgets kept in Supabase, and account deletion.
Next: generic statement import, categories editable in the app, then the iOS
and Android builds with Google and Apple sign-in.
