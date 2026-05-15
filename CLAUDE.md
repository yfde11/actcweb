# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ACTC 國際資訊安全人才培育與推廣協會 official website + member/admin portal + online exam & certification system. Node.js 18+ / Express / MongoDB. UI is server-rendered static HTML in `public/` using Tailwind CDN + Alpine.js + Swiper (no build step).

## Common commands

```bash
npm install                # install deps
npm start                  # node server.js (production-like)
npm run dev                # nodemon server.js
```

Migration / seed scripts (run with Mongo reachable via `MONGO_URI`):

```bash
npm run migrate:fix-registration-indexes
npm run migrate:backfill-registration-user-links
npm run migrate:clear-corporate-contacts
npm run seed:partner-corporate-members
node scripts/populate-question-bank.js     # seed CISSP questions
node scripts/create-admin.js               # ad-hoc admin creation
node scripts/test-question-bank-chrome.js  # Puppeteer smoke test against http://localhost:5001
```

There is **no test runner, no linter, and no build step** configured in `package.json`. Verification is manual or via the ad-hoc Puppeteer scripts under `scripts/`.

Docker / production:

```bash
cp env.docker.example .env.docker          # set JWT_SECRET, SITE_URL, SMTP_*
docker compose --env-file .env.docker up --build
```

Render is also a supported target (`render.yaml`).

## Architecture

### Entry & request lifecycle (`server.js`)

1. Loads `.env`. In `NODE_ENV=production` the process **exits** if `JWT_SECRET` is missing — never paper over this with a dev fallback in prod code.
2. Helmet is configured with **CSP disabled** (`contentSecurityPolicy: false`) because the static front-end uses Tailwind CDN and inline scripts. Don't re-enable CSP without rewriting the front-end.
3. `app.set('trust proxy', 1)` in production — the deployment terminates TLS at Caddy/Nginx in front of Node.
4. **All `/api` routes are gated by `middleware/mongoReady.js`**: if `mongoose.connection.readyState !== 1`, requests get HTTP 503 immediately. This is why DB outages return a clean error instead of opaque 500s — preserve this contract when adding routes.
5. Mongo connect → `lib/bootstrapDb.js` runs once → HTTP listener starts. The order matters: bootstrap creates the default `admin/admin` user, normalises legacy user fields (`emailVerified`, `membershipStatus`, `canManageContent`), and seeds sample news/events/working groups when collections are empty.
6. SPA-ish routes: `/`, `/admin`, `/member`, `/news`, `/news/:id`, `/about`, `/workgroups`, `/corporate-members`, `/admin/news`, `/admin/corporate-members` each `sendFile` a static HTML page from `public/`. Client-side JS then calls the JSON APIs.

### Auth model (three layers, three middlewares)

The codebase has **three distinct auth middlewares** and they are not interchangeable — pick the one that matches the resource:

- `middleware/adminAuth.js` → `auth` (any valid JWT) and `adminAuth` (JWT + DB lookup + `role==='admin'` + `emailVerified` + `isActive`). Used by `/api/news`, `/api/events`, `/api/admin/*`, `/api/users`, etc.
- `middleware/memberAuth.js` → `verifiedAuth` (logged in + email verified — for `/api/profile`, `/api/membership`, member-side reads) and `contributorAuth` (admin-only content writes from the member portal).
- `routes/cron.js` → its own `validateCronRequest` using `X-Cron-Secret` header **and** an IP allowlist (`CRON_ALLOWED_IPS`). Both must pass.

JWT payload uses `decoded.userId`. Tokens are read from `Authorization: Bearer …`. `db unavailable` errors (`MongoServerSelectionError` / `MongooseServerSelectionError`) are mapped to 503 with the `DB_UNAVAILABLE` message.

### Routes ↔ Models ↔ Services

```
routes/                 thin HTTP layer, validates input, calls services or models
  auth.js, profile.js, users.js, membership.js
  news.js, member-news.js
  events.js, member-events.js
  corporate-members.js, working-groups.js, admin-working-groups.js
  exams.js (admin), member-exams.js (taker), question-bank.js
  cron.js (X-Cron-Secret + IP allowlist)

services/               cross-cutting business logic, reused by routes
  email.js              nodemailer wrapper; isConfigured() gates verification/reset emails
  examGeneration.js     random pick from question bank by domainRatio
  examGrading.js        grades submissions, applies passingScore
  examCertificates.js   PDFKit cert generation, certificate numbering
  examNotifications.js, eventNotifications.js, contentNotifications.js
  registrationLinking.js, eventRegistrations.js
  googleAnalytics.js    optional GA4 Data API integration

models/                 Mongoose schemas (single source of truth for shape)
  User, CorporateMember, WorkingGroup, WorkingGroupMembership
  News, Event, EventMaterial, EventRegistration, EventSurveyResponse
  Exam, ExamAttempt, Question, Certificate
  NotificationLog, Counter
```

### Exam system (newest subsystem — read `docs/exam-system/SPEC.md` before changing)

- **Question bank** is independent of exams. An `Exam` defines a `domainRatio` and `questionsPerAttempt`; `services/examGeneration.js` randomly picks questions per domain at attempt creation time.
- **Attempt lifecycle**: `in_progress` → `submitted` → graded; expired in-progress attempts are reaped by `POST /api/cron/expired-attempts` (cron-only auth). When extending exam logic, follow this state machine — don't introduce parallel status fields.
- **Certificates** are issued by `services/examCertificates.js` with a unique `certificateNumber`. Public verification endpoint lives directly in `server.js`: `GET /api/certificates/verify/:certificateNumber` — it intentionally bypasses the auth middlewares and checks `isRevoked` + `expiresAt`.
- Exam admin UI: `public/admin/question-bank.html` + `public/components/QuestionBankManagement.js`. Member-facing exam UI lives in `public/member/`.

### Front-end conventions

- Static HTML in `public/` is the deliverable — there is no bundler. Pages load Tailwind/Alpine/Swiper from CDN and call the JSON APIs directly.
- `public/components/*.js` are plain ES scripts that mount onto Alpine.js `x-data` blocks, not modules. They expect to find their root elements already in the page.
- `public/member/exam-optimization-patch.js` is a runtime patch loaded after `index.html` to fix exam UI behaviour — keep this in mind when tracing member-portal exam bugs; the apparent source isn't always the only file in play.
- Brand colour token is `actc-orange`.

### Uploads

- Multer writes to `uploads/images/` and `uploads/files/`, served from `/uploads/*` static. In Docker these are mounted as the `actc_uploads_data` volume — paths must remain stable across deployments.
- Per-file limit 5 MB, max 3 images + 1 attachment per news item. The error mapping in `server.js` (`LIMIT_FILE_SIZE`, `LIMIT_FILE_COUNT`, `LIMIT_UNEXPECTED_FILE`) returns user-facing zh-TW messages — keep that pattern when adding new upload endpoints.

### Bootstrap behaviour to know about

`lib/bootstrapDb.js` runs on every successful Mongo connection and is idempotent. It:

- Creates `admin/admin` if no admin exists (change immediately in any non-dev environment).
- Backfills `emailVerified=true` on legacy users and forces admin accounts into `membershipStatus=approved`, `canManageContent=true`.
- Seeds sample news/events/working-groups **only when those collections are empty** — safe for prod, but if you wipe a collection in dev expect seed data to reappear on next boot.

## Environment variables

Required:

- `JWT_SECRET` — production refuses to start without it.
- `MONGO_URI` — defaults to `mongodb://localhost:27017/actc_website`.

Cron endpoints additionally require `CRON_SECRET` and `CRON_ALLOWED_IPS` (comma-separated).

Email features (verification, reset password, member/event/exam notifications) are gated by `services/email.js#isConfigured()`. If `SMTP_HOST`/`SMTP_USERNAME`/`SMTP_PASSWORD` aren't all set, those features silently no-op and the server logs a warning at boot — don't assume "no email sent" means a code bug.

`SITE_URL` is used to build links in outgoing emails (verification, reset, certificate verification). It must match the user-facing origin, **without** the internal `:5001` port when behind Caddy.

## Repo conventions

- Language: codebase, comments, and user-facing copy are zh-TW. Keep new error messages and UI strings in zh-TW unless explicitly told otherwise.
- API response shape is **inconsistent** by design legacy: older endpoints use `{ message }`, exam/certificate endpoints use `{ data, error: { code, message } }`. Match the surrounding endpoints' shape rather than unifying opportunistically — clients depend on the existing shapes.
- `lib/agency-agents` is a git submodule (unrelated agent prompt library). Don't edit it as part of normal feature work.
- `.gitignore` excludes a wide set of deploy/test/debug filename patterns (`test-*.html`, `deploy-*.sh`, `fix-*.sh`, etc.). If you create utility scripts with those prefixes they will silently not be tracked — choose names accordingly.
- Reference docs worth reading before non-trivial work: `docs/exam-system/SPEC.md`, `docs/exam-system/API.md`, `docs/exam-system-brd/`, `NEWS_SYSTEM_README.md`, `EVENTS_CRUD_SUMMARY.md`, `DEPLOYMENT.md`.
