# AGENTS.md — Temple Shalom Member Survey

Guidance for AI agents (Devin, Claude, etc.) working in this repo.

## Project overview

A static survey site for the Temple Shalom (Colorado Springs) member survey, deployed on Cloudflare Pages, with responses collected by a Cloudflare Worker writing to a Cloudflare D1 (SQLite) database.

- **Frontend**: vanilla HTML/CSS/JS using [SurveyJS](https://surveyjs.io/) (loaded from `unpkg.com`, pinned to `survey-core@1.12.13` / `survey-js-ui@1.12.13`). No build step, no bundler, no npm dependencies in the repo.
- **Backend**: single Cloudflare Worker (`worker.js`) with six routes — `POST /submit`, `POST /draft`, `GET /draft?id=`, `GET /export?key=`, `GET /results?key=`, `GET /health`.
- **Database**: Cloudflare D1, binding `DB`, database `temple-shalom-responses`. Schema in `schema.sql`; additive migrations in `migrate.sql`.
- **Survey definition**: `survey.json` (SurveyJS JSON schema). This is the source of truth for all questions; `index.html` and `print.html` both render it.
- **Source PDF**: `Temple Shalom - Member Survey 2025 (DRAFT).pdf` is the original paper survey — reference it when questions need to be reconciled with the printed version.

## File map

| File | Purpose |
| --- | --- |
| `index.html` | Main interactive survey page (SurveyJS, Israeli-flag palette). |
| `print.html` | Print/PDF-friendly rendering of the same survey. |
| `admin.html` | Auth-gated admin dashboard that reads `/results` and renders charts. |
| `survey.json` | SurveyJS question definitions — edit questions here, not in HTML. |
| `worker.js` | Cloudflare Worker: submit, export (CSV), results (JSON), health. |
| `wrangler.toml` | Worker config + D1 binding. `account_id` and `database_id` are committed (not secrets). |
| `schema.sql` | Canonical D1 schema for the `responses` table. Applied by CI when changed. |
| `migrate.sql` | Additive `ALTER TABLE` migration for older deployments. |
| `submit.gs` | Google Apps Script web app — receives dual-write POSTs from the Worker and appends rows (with metadata) to a Google Sheet. Deploy via Apps Script; URL stored as `GS_WEBHOOK_URL` Worker secret. |
| `build.sh` | CF Pages build script; stamps `version.json` with commit SHA/branch/date. |
| `Makefile` | `make deploy` (Pages) and `make open`. Reads `CF_API_TOKEN` from `.env`. |
| `test_submit.sh` | End-to-end smoke test: hits `/health`, POSTs a `_test:true` response, checks for `success:true`. Sources `.env` for `WORKER_URL`. |
| `.github/workflows/deploy.yml` | CI: path-filtered deploy of site, worker, and D1 schema, then health checks. |
| `.env` | Gitignored. Holds `CF_API_TOKEN`, `CF_WORKER_TOKEN`, `CF_ACCOUNT_ID`, `EXPORT_KEY`, `WORKER_URL`. |

## Architecture notes

- **No build system.** HTML/JS/CSS ship as-is. Don't introduce bundlers, transpilers, or npm packages without explicit ask.
- **SurveyJS is loaded from `unpkg.com` at a pinned version.** Bump the version in all three HTML files together (`index.html`, `print.html`, `admin.html`) if upgrading.
- **Responses are stored as a JSON blob** in `responses.payload`, plus denormalized metadata columns (`response_id`, `session_id`, `submission_number`, `previous_response_id`, `survey_version`, `ip_country`, `cf_ray`, `completion_seconds`, `sections_answered`, `user_agent`, `referrer`). Server-stamped fields (`response_id`, `timestamp`, `ip_country`, `cf_ray`) must never be trusted from the client body.
- **Re-submission linking**: `session_id` (browser localStorage UUID) links submissions from the same browser. The Worker computes `submission_number` (1, 2, 3...) and `previous_response_id` server-side by looking up prior submissions with the same `session_id`. The frontend allows re-submission via a "Submit again" button.
- **Drafts (save-and-continue-later)**: the `drafts` table stores in-progress surveys for cross-device resume. `POST /draft` saves (upserts by `session_id`), `GET /draft?id=XXXX` loads. Drafts expire after 30 days. The frontend auto-saves to both localStorage and D1, and shows a resume link. Opening `?draft=XXXX` in the URL triggers the resume prompt.
- **Dedup**: `response_id` is `crypto.randomUUID()` and `UNIQUE`. The worker returns `409 duplicate` on `UNIQUE` constraint violations.
- **Rate limiting**: in-memory per-IP, max 5 submits/min. Note this resets on worker restart and is per-isolate — it's a guard, not a guarantee.
- **Auth for `/export` and `/results`**: a single shared `EXPORT_KEY` Worker secret (query param `?key=`). Don't commit it; it lives as a Cloudflare secret.
- **Google Sheets dual-write**: the Worker POSTs each submission to an Apps Script web app (`GS_WEBHOOK_URL` secret) which appends a row to a Google Sheet. This is best-effort — if Sheets is down, D1 still has the data and the submission succeeds. Metadata columns (`response_id`, `timestamp`, `session_id`, `survey_version`, `ip_country`, `cf_ray`, `completion_seconds`, `sections_answered`, `user_agent`) are sent by the Worker and appear as the first columns in the sheet.
- **CORS is wide open** (`*`) — the survey is meant to be embedded/linked from anywhere. Don't tighten this without checking embed points.

## Common tasks

### Edit a survey question
Edit `survey.json`. The HTML files render from it at runtime, so no other change is needed for the live survey. If the change should also appear in the print version, verify `print.html` still renders correctly (it uses the same JSON). Bump any related `_survey_version` expectation if you track versions.

### Add a new worker route
Add the handler in `worker.js` following the existing pattern (a `handleX(request, env)` function dispatched from `fetch`). Keep CORS headers on all JSON responses via the `json()` helper. If the route is sensitive, gate it on `env.EXPORT_KEY` like `/export` and `/results`.

### Change the D1 schema
Edit `schema.sql` (canonical) and, if additive, also add the `ALTER TABLE`/`CREATE INDEX` statements to `migrate.sql`. CI auto-applies `schema.sql` when it changes via the `migrate` job — but `schema.sql` uses `IF NOT EXISTS`, so it's safe to re-run. For non-additive changes, coordinate a manual `wrangler d1 execute` against `--remote`.

### Run the smoke test
```bash
./test_submit.sh
```
Requires `.env` with `WORKER_URL` (defaults to `https://temple-shalom-survey.jeffstein.workers.dev`). Submits a `_test: true` row — safe to delete from D1 afterward.

### Deploy locally
```bash
make deploy          # CF Pages (static site)
npx wrangler deploy  # Worker
```
Both need `CF_API_TOKEN` (and `CF_ACCOUNT_ID` for the worker) in the environment. Normal flow is via CI on push to `main`/`master` — only deploy manually when debugging.

### Inspect responses
```bash
# CSV download
curl 'https://temple-shalom-survey.jeffstein.workers.dev/export?key=$EXPORT_KEY' -o responses.csv

# JSON
curl 'https://temple-shalom-survey.jeffstein.workers.dev/results?key=$EXPORT_KEY'

# Direct D1 query
CLOUDFLARE_API_TOKEN=$CF_WORKER_TOKEN npx wrangler d1 execute temple-shalom-responses --remote \
  --command 'SELECT id, timestamp, session_id FROM responses ORDER BY id DESC LIMIT 10'
```

## CI / deploy

`.github/workflows/deploy.yml` runs on push to `main`/`master` and uses `dorny/paths-filter` to deploy only what changed:

- `schema.sql` changed → `wrangler d1 execute ... --file=schema.sql --remote`
- `worker.js` / `wrangler.toml` changed → `wrangler deploy`
- `index.html` / `print.html` / `admin.html` / `survey.json` changed → `wrangler pages deploy . --project-name=temple-shalom-survey --branch=master`

A `health-check` job then curls the worker `/health` and the Pages site. Required GitHub secrets: `CF_API_TOKEN`, `CF_WORKER_TOKEN`, `CF_ACCOUNT_ID`.

## Secrets

All secrets live in Cloudflare (Worker secrets + GitHub Actions secrets), never in the repo. The `.env` file is gitignored. If you need a new secret:

- **Worker runtime**: `npx wrangler secret put NAME` (then read via `env.NAME` in `worker.js`).
- **CI**: add via GitHub repo settings.

## Conventions

- Keep the Israeli-flag color palette (`--blue: #0038b8` etc.) consistent across `index.html`, `print.html`, `admin.html`.
- No emojis in code or UI unless explicitly requested.
- No comments added/removed beyond what's already there unless asked.
- Vanilla JS only in the HTML files — no frameworks, no TypeScript.
- Worker code is ES modules (`export default { fetch }`), `compatibility_date = "2024-01-01"`. Don't switch to the service-worker format.
- When editing `survey.json`, preserve SurveyJS schema shape — validate at https://surveyjs.io/survey-creator if unsure.

## Verification checklist before considering work done

1. `./test_submit.sh` passes (if worker/schema touched).
2. Open `index.html` locally (or via a quick static server) and confirm the survey renders and submits to a staging endpoint.
3. `print.html` still renders the full survey without JS errors.
4. If `survey.json` changed, confirm both `index.html` and `print.html` consume it correctly.
5. If `worker.js` changed, confirm `/health` returns `{"status":"ok",...}` after deploy.
6. No secrets in the diff.
