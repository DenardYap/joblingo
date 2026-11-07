# Render deployment

Deploy `render.yaml` from the repository's `main` branch. It provisions a Docker web service, PostgreSQL, and a cron dispatcher in Oregon. The smallest paid database uses 1 GB of storage with autoscaling disabled. The web image includes the Python PDF runtime and LibreOffice. Provider credentials, passwords, Google tokens, resumes, and database snapshots must never enter Git or the Docker build context.

Supply the web service's `sync: false` values in Render. For a migration, use the existing local `SESSION_SECRET`; replacing it prevents decryption of saved Google refresh tokens. Do not copy macOS-specific executable/font paths. Add the deployed HTTPS `/api/google/callback` URL to the existing Google OAuth web client. Testing-mode users still need to be listed in Google's audience configuration.

## Migrating local records

Stop the local API and its watcher before copying/opening PGlite. Keep an untouched backup of `.local/postgres`. Export from the offline copy:

```sh
node scripts/workspace-snapshot.mjs export .local/deployment/workspace.json .local/deployment/postgres-snapshot
```

The snapshot contains private account records, jobs, tracking, settings, research, original files, drafts, and encrypted Google connections. It omits transient leases and OAuth challenges. Keep it in an ignored private directory. The CLI prints only row counts and SHA-256 digests.

Run `npm run db:migrate` against the new PostgreSQL database, then set `DATABASE_URL` privately for the import process. Permit only the migration computer's address if temporary external database access is necessary; remove that rule after importing. Do not use a world-accessible rule.

```sh
node scripts/workspace-snapshot.mjs import .local/deployment/workspace.json
node scripts/workspace-snapshot.mjs verify .local/deployment/workspace.json
```

Import refuses a nonempty target, uses one transaction, and verifies every account, domain, and metadata record before committing. Original PDF and draft file bytes are covered by those hashes. Keep the application and cron paused during import so background updates cannot invalidate the comparison. After import, use only the hosted workspace for new changes; restarting local against its old copy creates independent data.

## Verification

Check `/api/health`, the password gate, Google account sign-in, active resume names, job/tracking counts, and settings. Download both active originals and a saved tailored PDF and compare their SHA-256 values to the snapshot. Run one PDF edit in the production image: its pixel guard must preserve everything outside the original bullet/skills slots. Google Docs remains an editable conversion; the PDF is the exact-layout artifact. Verify that export opens a document in the connected account with the base resume name followed by the company name.

Keep database external access disabled after migration. Keep daily scheduling paused until deployment verification is complete, then preserve the user's saved schedule setting. No verification step should purchase another job-search or research run unnecessarily.
