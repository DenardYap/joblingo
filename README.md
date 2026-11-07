# Personal job search

A private React + TypeScript job-search app with an isolated workspace for each Google account. Express serves the API and production frontend; PostgreSQL stores settings, search history, jobs, application tracking, resumes, and drafts. The interface uses a blue accent, a mostly borderless table, Radix Themes dropdowns/tabs, and original angular icons without Lucide. There is no branding or navigation bar: settings and resumes open from the top-right settings button.

## Run locally

Use Node 24 and npm:

```sh
npm ci
# On a fresh checkout only: copy .env.example to .env and fill the provider keys.
npm run dev
```

Open http://127.0.0.1:5173. Vite proxies `/api` to Express on port 3001. Without `DATABASE_URL`, embedded PostgreSQL persists to `.local/postgres`; no local database server is needed. Keep one API process open per local data directory. Configure `APP_PASSWORD` and a random `SESSION_SECRET` of at least 32 characters before startup; the password gate also applies locally. `.env` and `.local/` are ignored by Git. Provider credentials remain server-side.

With `EXA_API_KEY`, `OPENAI_API_KEY`, and `OPENAI_MODEL` configured, **Run search** makes a live search. Without keys, labeled fictional jobs allow UI preview. A completed search with no matches shows an empty result, rather than falling back to examples.

The local example and Render Blueprint select `gpt-6.1-sol` with `OPENAI_REASONING_EFFORT=high`. These settings apply to all OpenAI extraction, scoring and resume-tailoring requests. Exa search and company/contact research are billed separately.

## Features

- Daily and manual searches. Default target of 30 jobs per run (up to 50), hard requirements, preferences, minimum score, selected sources, local time, and time zone. The default posting window is seven days, with the last 24 hours prioritized before fit. Older and undated listings stay out of new shortlists; existing application history is retained. Exa Agent builds a distinct candidate list (up to a $2 research budget), then search continues across role/source queries toward the target; history shows matched/target counts and explains shortages or exclusions rather than implying every completed run filled the target.
- Searchable job history with date, score, source and application-status filters; sorting; bookmarks; notes; mobile layouts; reduced-motion support.
- Company logos, whole-row opening, fixed-height detail dialogs, source links, evidence-backed details, salary, location, sponsorship, experience, and office attendance. Posted age uses employer metadata; unknown posting dates remain unknown.
- Open, Closed, and Unverified availability are separate from fit score. Only recently checked open jobs appear by default; closed jobs retain application history. Each search rechecks up to 50 previous active records as well as new candidates.
- Citizenship, export-control/ITAR, and security-clearance conditions are separate from sponsorship. Roles with unconfirmed eligibility for those requirements are excluded from new shortlists and default recommendations, with the full condition quoted in job details. Eligibility filters expose them for review without losing tracking or drafts.
- Company employee headcount with reporting date and direct citations, public/private status, and exchange/ticker when verified. Public-company preference is enabled in Settings: 95% base fit plus 5 points for a verified public listing; private and unknown employers stay eligible.
- Company and public professional-contact research through Exa Agent. Research starts automatically for every shortlisted job, continues with the browser closed, and is cached per job with a $1 Exa budget per run. Two jobs are researched at a time; failed runs offer a retry. Grounding citations appear with the results.
- Cross-site duplicates collapse into one job, with source links, bookmarks, application progress, notes and resume drafts preserved. The search target counts distinct roles.
- Resume-aware discovery and scoring: choose a matching resume in Settings, or automatically use the latest upload. New manual and scheduled searches use its evidenced experience and skills. Each new score has a component breakdown and records the resume version used. Additional candidate accomplishments in Settings supplement either resume for discovery, scoring, and tailoring.
- PDF/DOCX/TXT uploads for matching (5 MB maximum), editable working copies with preserved originals and revision checks. Tailoring supports one-page PDF templates and DOCX templates. PDF edits retain the uploaded page and replace only the original bullet/skills text areas; text that exceeds its original line budget is rejected. A DOCX companion is generated for editable Google Docs export. For DOCX templates: only experience bullets and skills are rewritten, with original typography, paragraph properties, contact details, job headers and education retained. The embedded PDF appears before change notes; bullet edits re-render and reject overflow. Download the PDF or original-format Word draft.
- Individual Google sign-in, private jobs/resumes/settings/schedules, and Google Docs export into each user’s own connected account. Document titles use the base resume name followed by the company name.

The initial profile targets accounting and revenue-accounting roles, prefers 3–5 years of experience and San Francisco/Bay Area tech companies, and excludes explicit no-visa-sponsorship postings. Unknown sponsorship is flagged for follow-up. Match scores are model estimates, not a probability of getting hired.

Opening an application first forces a live availability check. Only a confirmed-open link marks a previously unstarted job Applied; it does not submit an application. The status can be corrected manually, and more advanced statuses are preserved. Public search coverage varies, and live job availability can change after discovery.

## Schedule

Daily search starts paused. Enable it in Settings after reviewing the prompt, count, and time. Locally the API checks every minute while it is running. On Render a separate cron dispatcher checks every 15 minutes, without needing the browser open. A timezone-aware local-date key prevents a second successful scheduled run that day; failures can retry up to three attempts. Manual searches are independent of the daily schedule. A renewing database lease prevents overlapping runs, and a stale lease lets an interrupted search recover.

“Found today” refers to discovery date in the configured time zone, not the employer's posting date. Search history retains the day each job was rediscovered. A run may return fewer than the requested number when fewer qualified postings are available.

## Google Docs

Enable Google Drive API and create an OAuth web client in your Google Cloud project. Add `http://127.0.0.1:5173/api/google/callback` locally, or `https://YOUR_HOST/api/google/callback` when hosted. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` server-side and restart. Add your account as a test user while the Google app is in Testing mode. Open Settings → Google Docs → Connect. Sign-in requests `openid`, email, profile, and the limited `drive.file` scope and stores its refresh token encrypted using `SESSION_SECRET`; state, PKCE and a short-lived HttpOnly binding cookie protect the callback. Testing-mode Google connections can expire after seven days and may need reconnection. A legacy `GOOGLE_REFRESH_TOKEN` is restricted to the original owner’s workspace. Other users never inherit it. Existing records are linked only to the verified email of the previously connected Drive account. New Google subjects receive empty, separate workspaces.

Resume previews require headless LibreOffice (`LIBREOFFICE_BIN`, default `soffice`). The Render Docker image includes Writer and compatible open-source fonts. For exact font fidelity, install the template fonts under an appropriate license; `RESUME_FONTCONFIG` can point to a local fontconfig file. No automatic font shrinking or margin changes are used to fit a page. Word-to-PDF and Google Docs rendering can differ; review the displayed PDF and Google Docs pagination.

## Database and Render

The Drizzle schema in `server/db/schema.ts` matches the runtime store: validated JSONB workspace records plus a search lease. The initial migration is idempotent so it also works for a database initialized by the app. Future schema changes need reviewed migrations.

```sh
npm run typecheck
npm run build
# For a configured external PostgreSQL database:
npm run db:migrate
```

`render.yaml` defines a Docker web service, a PostgreSQL database with 1 GB storage, and a 15-minute cron worker. These use paid Render plans; storage autoscaling is disabled. Supply Exa/OpenAI keys, Google OAuth credentials, your private `APP_PASSWORD`, and a random `SESSION_SECRET` through Render's environment settings. When migrating an existing workspace, retain its `SESSION_SECRET` so encrypted Google connections remain readable. The cron service references the web service's provider configuration. `APP_ORIGIN` is only needed for a custom domain; otherwise the server uses `RENDER_EXTERNAL_URL`. See `docs/deployment.md` for data migration and parity checks.

Production requires PostgreSQL. Local and hosted workspaces require password authentication. Sessions last 30 days with an HttpOnly, SameSite=Strict cookie (Secure on HTTPS in production). Sign out clears the cookie; changing the password or session secret invalidates existing sessions. The shared password is an invitation gate. Google sign-in identifies each user using a verified ID token and a separate signed 30-day account session. It is never sufficient to know the site password to read someone else’s workspace. Keep the Google credentials on the web service only. Do not commit `.env`, resumes, local database files, or generated application data.

## Skills and implementation notes

The two UI skills were created before scaffolding:

- `~/.codex/skills/ui-design-principles/SKILL.md`
- `~/.codex/skills/ui-laws-of-ux/SKILL.md`

The canonical Exa skill is installed in `.agents/skills/build-with-exa/`. See `docs/architecture.md` for endpoint choices and reliability behavior. Automated tests are deferred until an authorized push or PR unless explicitly requested (resume checks: `node --import tsx --test tests/resumes.test.ts`); type checks, builds, and manual UI checks are available during implementation.

## Private workspaces

The idempotent `0001_private_workspaces` migration adds workspace IDs to all domain records and leases, plus account, OAuth state, and bootstrap metadata tables. Shared-password cookies from the old app can pass only the invitation gate; they cannot read workspace data until Google sign-in. Account sessions map to a server-side workspace ID. Every domain query, revision update, background task, and in-memory job/draft operation is scoped to that ID; absent context fails closed. Deleting a base resume removes it from active choices and privately archives its source to keep historical drafts reviewable.

Google’s OAuth app must allow the intended users: while in Testing, add each as a test user; make the app available to the intended audience before broader use. No website deployment is performed by this change.

PDF tailoring requires Python with `server/pdf/requirements.txt` installed, selected by `RESUME_PDF_PYTHON`. The Docker image installs this runtime. Replacements reuse the font embedded in the original PDF, its size, baselines, indents and line budget. Fonts are never silently substituted. If the embedded subset lacks a new character, the AI must reword the bullet using supported characters. A render comparison at 144 DPI rejects any change outside the approved text regions. PDF text is actually removed and replaced, with Unicode mappings for extraction; it is not hidden under a white rectangle. Google Docs remains an editable conversion and may reflow after import; date columns use explicit right-aligned tabs instead of PDF spacing strings.
