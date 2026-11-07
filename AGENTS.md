# Personal job workspace

This is a prompt-driven job-search app with private workspaces per Google account. Every domain read/write, worker task, lease and private cache must remain scoped to the server-resolved workspace; missing context must fail closed. Keep credentials server-side and out of committed files.

## UI direction

Apply the installed `ui-design-principles` and `ui-laws-of-ux` skills when working on UI. They are in `~/.codex/skills/`. The first includes the user's original Refactoring UI and Don Norman reference; the second captures the supplied Laws of UX.

Use the shared CSS tokens, blue accent, quiet neutral surfaces, and one clear primary action per task. Keep sample jobs labeled as fictional and draft schedules labeled as inactive until the backend actually executes them. Preserve keyboard navigation, visible focus, reduced-motion support, and narrow layouts.

The user's visual references are a restrained workspace with a centered prompt composer and a compact library table. Prefer a mostly borderless layout, shared neutral backgrounds, ordinary typography, and space between groups. Avoid promotional headings, decorative feature cards, gradients, sparkle motifs, and unnecessary explanatory copy. Use the original angular SVG set in `web/src/Icons.tsx`; do not add Lucide React.

## Structure

- `web/`: React client, no provider secrets or direct database access.
- `server/`: Express API, database, search-provider interface, worker entry point.
- `shared/`: runtime validation and public client/server contracts.
- `render.yaml`: future Render deployment configuration. Do not provision hosting as part of a local scaffold change.

Read `README.md` and `docs/architecture.md` before changing discovery, ranking, or scheduling. Use `.agents/skills/build-with-exa/SKILL.md` as the canonical Exa API reference. Do not deploy without user authorization.

No branding, logo, sidebar, or navbar. Jobs are the main screen; settings and resumes live behind the top-right settings button. Use Radix Themes controls for selects and tabs; do not build bespoke dropdowns or expose browser-native select menus. Preserve the mostly borderless design and the original non-Lucide icon set.

Resume PDFs must retain the uploaded base PDF's exact layout, embedded font, font sizes, margins, indents, baselines, spacing, section rules and protected content. Change only existing bullet/skills text and shorten wording to fit its original region. Do not substitute fonts or rebuild PDF downloads from Word/Google Docs. Preserve the runtime comparison that rejects changed pixels outside approved edit areas. Google Docs is a separate editable conversion.
