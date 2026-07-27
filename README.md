# AI Voice Trainer LMS

Production-ready learning-management web application with a **Gemini Live speech-to-speech AI trainer**, built for Netlify.

- **Admin Portal** — `/admin`: course management (up to 20 slide + knowledge pairs), knowledge processing & review, publishing with versioning, Gemini Live configuration, learner reports with filtering and CSV/Excel export.
- **Learner Portal** — `/learn`: access password gate, registration, voice-taught slides with synchronized transcript bites, interrupt-and-ask, compulsory 3-question assessments with corrective learning, module timer, autosave/resume, and course rating.

## Stack

| Layer | Technology |
|---|---|
| Frontend | React 18 + Vite + TypeScript (single SPA, two portal identities) |
| Backend | Netlify Functions (TypeScript, modern `Request`/`Response` API) |
| File storage | Netlify Blobs (slide visuals, original documents, processed knowledge) |
| Database | Supabase Postgres (service-role access from functions only; RLS locked) |
| Voice AI | Gemini Live API via **ephemeral tokens** — direct browser ⇄ Gemini WebSocket |
| Assessment scoring | Gemini text model, server-side, weighted 50/30/20 rubric |

## Security model (summary)

- The permanent `GEMINI_API_KEY` lives only in Netlify env vars. Learners receive **single-use, short-lived ephemeral tokens** whose system instruction (strict knowledge rule + the one slide's approved knowledge) is **locked server-side** — the browser cannot widen the scope.
- Admin and learner sessions are JWTs in **HTTP-only, Secure, SameSite=Lax cookies**; every state-changing request additionally requires the `X-Requested-With` header (CSRF defense).
- Passwords are stored as **bcrypt hashes** only. Login and token endpoints are **rate-limited** (DB-backed, works across function instances).
- Upload validation on both ends: MIME allow-list, size limits, and **server-side magic-byte sniffing**. Blob keys are always server-generated UUID segments — no path manipulation.
- Content-Security-Policy, HSTS, frame denial and nosniff headers are set in `netlify.toml`.
- Important admin actions are written to an **audit log**.
- Raw learner audio is **not stored** unless an admin explicitly enables it, and the consent screen always discloses the current setting.

See **DEPLOY.md** for step-by-step setup.

## Local development

```bash
npm install
cp .env.example .env       # fill in values
npx netlify dev            # runs Vite + functions together on :8888
```

## Project layout

```
├─ db/schema.sql               # run once in Supabase SQL editor
├─ netlify.toml                # build, headers, SPA redirect
├─ shared/types.ts             # types shared by frontend + functions
├─ netlify/functions/
│  ├─ _lib/                    # auth, db, blobs, gemini, knowledge, rate limit…
│  ├─ admin-*.ts               # protected admin APIs
│  ├─ learner-*.ts / gemini-token.ts / blob-serve.ts
└─ src/
   ├─ admin/                   # Admin Portal UI
   └─ learn/                   # Learner Portal UI + Gemini Live client
      └─ live/                 # audio worklets + Live session manager
```
