# Eve

**Plans your celebration. Runs it too.**

Eve helps people turn an event idea into a practical plan. Answer a short set of questions about the event, guests, location, budget, accessibility, and age mix; review a generated plan; then use its timeline, budget, vendor-search links, and checklist to organize the day.

It is for people planning weddings, birthdays, community gatherings, corporate events, festivals, and other celebrations—especially organizers who want a structured starting point without needing event-planning expertise.

## What it does

- Guides visitors through the ASK flow before asking them to sign in.
- Generates a tailored PLAN with a timeline, budget, checklist, and vendor categories.
- Uses the city and selected category to open external vendor-search links. Eve does not scrape, verify, or claim availability for those listings.
- Provides a RUN Command Center for approved schedule changes, owner task links, and event wrap-up.
- Lets signed-in users save and reopen plans. Visitors can try the planner without an account; account-linked saved events require Neon Auth configuration.
- Uses Diya as an optional mascot. Its images load on demand, and reduced-motion preferences are respected.

## Architecture

```text
Browser (Next.js App Router)
  ├─ Landing → ASK flow → PLAN reveal → RUN Command Center
  ├─ Neon Auth client (optional account sign-in)
  └─ Same-origin /api routes
       ├─ Zod-validated, size-limited requests
       ├─ Database-backed request limits for LLM routes
       ├─ OpenRouter primary model → configured fallback model
       └─ Neon Postgres
            ├─ events, plans, tasks, risks, owner links
            └─ append-only plan event history
```

The Next.js app and API routes deploy to Vercel. PostgreSQL and optional Managed Auth are provided by Neon. OpenRouter requests stay server-side; model responses are validated with Zod before they are used.

## AI versus plain code

| Area | AI or plain code? | What it does |
|---|---|---|
| ASK question flow | Plain code | Enforces required fields and selects the next question. |
| PLAN generation | AI, Zod validated | Drafts the timeline, budget notes, vendor categories, checklist, and guest-aware suggestions. |
| Budget normalization | Plain code | Applies the chosen total budget to the generated allocations. |
| RUN change intake | AI, Zod validated | Converts an organizer's free-text update into typed changes. |
| RUN impact analysis | Plain TypeScript | Calculates task effects, schedule constraints, critical path, and budget deltas. |
| RUN options | AI proposals + plain-code verification | Proposals are checked against the plan before an organizer can approve them. |
| Persistence and audit | Plain code + Postgres | Saves plan versions, owner links, task changes, and audit events. |
| Vendor search | Plain code | Creates category-and-city search links; it does not fetch or verify business listings. |

## Setup

### Prerequisites

- Node.js compatible with the project's Next.js version
- An OpenRouter API key and model IDs
- A Neon Postgres database

### Local development

1. Install dependencies:

   ```powershell
   npm install
   ```

2. Copy `.env.example` to `.env.local` and add the four required values listed below. Keep `.env.local` private; it is git-ignored.

3. Apply the database schema:

   ```powershell
   npm run db:migrate
   ```

   `DATABASE_URL_UNPOOLED` is optional for migrations; when omitted, the script uses `DATABASE_URL`.

4. Start the app:

   ```powershell
   npm run dev
   ```

5. Open `http://localhost:3000`. The landing page can start ASK without an account. Sign in is only needed to associate plans with an account and use **My saved events**.

### Environment variables

Set these **four required variables** in the Vercel project to deploy the guest planning flow:

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Server-side key for model requests. |
| `OPENROUTER_MODEL` | Primary OpenRouter model ID. |
| `OPENROUTER_FALLBACK_MODEL` | Model ID used if the primary fails or is rate-limited. |
| `DATABASE_URL` | Neon Postgres connection string. |

The code has model defaults, but setting both model IDs explicitly makes the deployment reproducible. Do not prefix server-only secrets with `NEXT_PUBLIC_`.

**Account sign-in and account-linked saved events need three additional Neon Auth variables** in Vercel: `NEON_AUTH_BASE_URL`, `NEON_AUTH_JWKS_URL`, and `NEON_AUTH_COOKIE_SECRET` (at least 32 random characters). These are not part of the four-variable guest-planner deployment. The auth proxy returns a clear unavailable response when Auth is not configured; it does not expose a server stack trace.

Optional local/integration variables:

| Variable | Purpose |
|---|---|
| `DATABASE_URL_UNPOOLED` | Direct Neon connection for schema migrations. |
| `NEON_FUNCTION_HELLO_BASE_URL` | Optional URL for the Neon hello Function client. |

`.env.example` lists the application's environment variables with **no values**. `.env.local` is covered by `.gitignore`.

### Brand assets

The logo at `public/eve-logo.svg` is used in the navigation, landing hero, and social previews. `public/brand/eve-icon.svg` is the browser favicon and Apple touch icon.

### Vercel deployment

Import the repository into Vercel and use the standard Next.js build settings. No custom `vercel.json` is required. Add the four required variables above to the appropriate Vercel environments, then deploy. Add the three Neon Auth variables only if account sign-in and account-linked saved events are required for that deployment.

Run `npm run db:migrate` against the production database before the first live plan is created. The migration is repeatable and adds the current schema, including the organizer-token expiry column.

## Tests and checks

```powershell
npm run test
npm run lint -- --max-warnings=0
npx tsc --noEmit
npm run build
```

## Demo script

1. Open the landing page in a signed-out browser and start an event plan.
2. Choose a wedding, birthday, community event, corporate event, festival, or other gathering.
3. Answer the date, guest-count, city, and budget questions.
4. Answer the event-specific questions.
5. Enter access and dietary needs—for example, step-free access, wheelchair access, seating for elderly guests, or dietary restrictions.
6. Select the age mix of the guests.
7. Generate the plan; review the visible guest-needs summary and confirm that the timeline, seating/venue tasks, menu, and activities reflect those answers.
8. Open the Vendors tab, choose a category, and verify that the search links use the selected city.
9. Open the Command Center and try a scenario such as “The caterer is 40 minutes late,” “It may rain,” “30 more guests are coming,” or “The venue closes one hour earlier.” Review the proposed change before approving it.
10. If Auth is configured, sign in, create another plan, and verify it appears in **My saved events** after reloading.

## Submission smoke test (live Vercel URL)

1. Open the live URL in a private window; confirm the first screen offers **Build my event plan** without a sign-in gate.
2. Start a plan and verify the ASK flow reaches both required guest-needs questions.
3. Enter wheelchair/step-free access, elderly seating, and dietary needs; confirm the answer is retained in the sidebar and the finished plan.
4. Choose an age mix and confirm it is visible in the plan.
5. Generate a plan; confirm timeline/seating and menu/activity suggestions reflect both answers.
6. Open `/api/health`; confirm the response reports the database and OpenRouter configuration without exposing credentials or stack traces.
7. Open Vendors; switch categories and confirm each search URL includes the selected city.
8. Test a RUN change; verify options are shown for review and the plan changes only after approval.
9. If Auth is configured, sign in, save a plan, reload, and reopen it from **My saved events**.
10. Simulate an unavailable or rate-limited model; confirm the backup-model retry state appears and the failure message offers a clear retry without losing ASK answers.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start local development. |
| `npm run build` | Create the production build. |
| `npm run start` | Serve the production build locally. |
| `npm run lint -- --max-warnings=0` | Run ESLint with warnings treated as failures. |
| `npx tsc --noEmit` | Type-check without emitting files. |
| `npm run test` | Run the Vitest suite. |
| `npm run db:migrate` | Apply `db/schema.sql` to the configured Neon database. |
