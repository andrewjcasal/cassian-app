# Cassian

A day planner I built for myself and use every day. It lays out the day as blocks and todos, keeps habits and routines on their set times, and moves the rest of the day around as things start, finish, run long or get skipped.

- Expo SDK 57 and React Native 0.86, run in Expo Go, with an iOS home screen widget (`widgets/CassianDay.tsx`)
- Supabase for auth, Postgres and one edge function (`supabase/functions/transcribe-theme-photo`), which reads a photo of a handwritten list into todos
- Themes group todos under a goal, habits repeat on a schedule, a sleep log feeds a Reflect tab, and a global habit timer stays on screen across pages

## Run it

```bash
npm install
cp .env.example .env.local   # fill in your Supabase URL and anon key
npx expo start
```

The schema is in `supabase/migrations/`. Apply it to your own Supabase project before running the app.

## Test it

```bash
npm test            # the scheduling rules, Node's built-in test runner
npm run typecheck   # tsc --noEmit
```

Both run in CI on every push and pull request (`.github/workflows/ci.yml`).

## How I work with agents on this repo

Nearly every commit here was written with Claude Code; the co-author line on each commit says so. I own the plan, the tests and the review. The rules the agent works under live in `CLAUDE.md`:

- **The scheduling rules are pure functions in `src/schedule.ts`.** Times are fractional hours and "now" is passed in, so every rule can be tested without the database or the screen. `App.tsx` only loads, saves and draws what those functions return.
- **Every rule change gets a test** in `src/schedule.test.ts`, and `npm test` plus the typecheck pass before a commit.
- **A new request that conflicts with an existing rule gets flagged before it's built**, naming both rules, so I decide which one wins instead of the agent overwriting one.
- **Migrations are timestamped files**, and every table has a `user_id` and one owner-only row level security policy. The anon role has no access.
- **Secrets stay out of the repo and out of prompts.** The app reads its Supabase URL and anon key from `EXPO_PUBLIC_*` env vars (`.env.local` is gitignored), and the edge function reads its API key from Supabase function secrets.

`AGENTS.md` holds the Expo guidance: check the installed SDK version and read the matching docs before touching an Expo API, because Expo changes between releases.

## License

See `LICENSE`.
