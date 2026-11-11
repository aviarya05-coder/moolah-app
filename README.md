# Moolah

Envelope budgeting for households: give every shekel a job, log what you
spend in seconds, and reconcile with your bank and card statements.

This repository is the public app for iOS, Android and the web.

## Layout

- `engine/` — the budget rules as pure functions (`budget.js` works out every
  figure for a month; `ops.js` builds the changes the screens make).
- `test/` — `npm test`. With a sheet export in `test/fixtures/` (not
  committed), it also checks the engine against the personal Moolah's
  spreadsheet, figure for figure.

## Status

Foundation: the budget engine. Next: accounts and per-household data
(Supabase), then the screens, then the iOS and Android builds.
