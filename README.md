# Moolah

Envelope budgeting for households: give every shekel a job, log what you
spend in seconds, and reconcile with your bank and card statements.

This repository is the public app for iOS, Android and the web.

## Layout

- `engine/` — the budget rules as pure functions. `budget.js` works out every
  figure for a month, `ops.js` builds the changes the screens make,
  `state.js` shapes it all for the screens, `backend.js` answers the
  screens' actions over a store, and `setup.js` makes a new, empty household.
- `web/` — the app: `index.html` holds the screens (ported from the personal
  Moolah by `tools/port_screens.py`), `app.js` the start-up and first-run set-up.
- `supabase/migrations/` — the database, with row-level security.
- `test/` — `npm test` (engine), `npm run test:db` (database rules, on a
  local Postgres), `npm run test:e2e` (the app in a phone-sized browser).

## Running it

    npm install
    npm run dev          # http://localhost:5173
    npm run build        # the site, in dist/

## Status

The screens run on the engine with a first-run set-up; budgets are kept on
the device for now. Next: sign-in and Supabase, then the iOS and Android builds.
