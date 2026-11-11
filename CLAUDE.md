# Working on Moolah (public app)

This is the public, multi-user version of Moolah, built to be published on
the App Store and Google Play. It is a separate project from the personal
Moolah (`aviarya05-coder/moolah`), which a household uses every day: nothing
here may change, deploy to or read from that project's production.

## Shipping changes

1. Work on a feature branch, never directly on `main`.
2. Push the branch and open a pull request into `main` with a short summary
   of what changed and how it was checked.
3. **Ask the owner before merging, every time.** Share the PR link and wait
   for an explicit yes for that specific PR. A new push after a yes needs a
   fresh confirmation.

## Rules for the code

- The budget maths lives in `engine/`: pure functions, no I/O, the same code
  in the app, on a server and in tests. Every rule change comes with a test.
- `npm test` must pass before any push.
- Real household data (sheet exports in `test/fixtures/`) is only for local
  checks and is never committed.
- Secrets (Supabase service keys, signing keys) never go in the repo.
