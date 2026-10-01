@AGENTS.md

# Cassian 3

One-page Expo app (SDK 57, opened in Expo Go) over the `cass_*` tables in the `calendar` Supabase project. Run with `npx expo start`.

- **Scheduling rules live in `src/schedule.ts`**, as pure functions (fractional hours, `now` passed in). `App.tsx` only loads, saves and draws what they return. Don't put timing logic back in the screen code.
- **Every rule change gets a test in `src/schedule.test.ts`.** Run `npm test` (Node's built-in runner, no extra packages) plus `npx tsc --noEmit` before committing.
- **When a new request conflicts with an existing rule, say so before building it** and name both rules, so Andrew can decide which wins.
- Migrations go in `supabase/migrations/` with a timestamped name. Every `cass_*` table has `user_id` (default `auth.uid()`) and one owner-only policy; anon has no access.
