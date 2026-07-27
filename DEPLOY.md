# Deployment guide (Netlify + Supabase + Gemini)

Follow these steps in order — about 15 minutes total.

## 1 · Supabase (database)

1. Open [supabase.com](https://supabase.com) → your project (or create one).
2. Go to **SQL Editor** → paste the entire contents of `db/schema.sql` → **Run**.
   You should see "Success. No rows returned".
3. Go to **Project Settings → API** and copy:
   - **Project URL** → this is `SUPABASE_URL`
   - **service_role key** (under "Project API keys" — the secret one, NOT `anon`) → this is `SUPABASE_SERVICE_ROLE_KEY`

> The service-role key is only ever used inside Netlify Functions. The browser never receives it, and Row Level Security blocks the public `anon` key from reading any table.

## 2 · Gemini API key

1. Open [Google AI Studio](https://aistudio.google.com/apikey) → create / copy an API key.
2. Make sure the key has access to the **Live API** (native audio models). This is `GEMINI_API_KEY`.

## 3 · Push the code to GitHub

```bash
cd ai-voice-trainer-lms
git init && git add -A && git commit -m "Initial deploy"
# create an empty repo on github.com, then:
git remote add origin https://github.com/YOUR-USER/YOUR-REPO.git
git push -u origin main
```

## 4 · Create the Netlify site

1. Netlify dashboard → **Add new site → Import an existing project** → pick the repo.
2. Build settings are read automatically from `netlify.toml`
   (build command `npm run build`, publish `dist`, functions `netlify/functions`).
3. **Before the first deploy**, open **Site configuration → Environment variables** and add:

| Variable | Value |
|---|---|
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 1 (mark as secret) |
| `SESSION_SECRET` | any random 64+ character string — e.g. run `openssl rand -hex 48` |
| `GEMINI_API_KEY` | from step 2 (mark as secret) |
| `ADMIN_EMAIL` | your admin login email |
| `ADMIN_PASSWORD` | strong password, **min 10 characters** |
| `LEARNER_ACCESS_PASSWORD` | initial learner gate password |

4. Deploy the site.

> **Netlify Blobs** needs no setup — it is enabled automatically for the site and stores slide visuals, original documents and processed knowledge packages.

## 5 · First run

1. Open `https://YOUR-SITE.netlify.app/admin` → sign in with `ADMIN_EMAIL` / `ADMIN_PASSWORD`.
   (The first login automatically creates the admin account from the env vars; afterwards the env password is ignored — the DB hash is what counts.)
2. **Gemini Live** tab → press **Test connection** → should pass ✓. Pick the Live model and trainer voice.
3. **Course** tab → add slides, upload visuals (PNG/JPG/WEBP) and knowledge documents (PDF/DOCX/TXT), review the extracted knowledge, fill in objectives/teaching points/questions, then **Publish new version**.
4. **Settings** tab → optionally rotate the learner access password.
5. Open `https://YOUR-SITE.netlify.app/learn` in another browser → enter the learner password → register → **Explain This Slide**.

## Key rotation & operations

- **Replace the Gemini key**: Site configuration → Environment variables → edit `GEMINI_API_KEY` → redeploy. The Admin → Gemini Live page shows the masked key and last successful test.
- **Rotate the learner password**: Admin → Settings (stored as bcrypt hash in the DB; the env var is only the bootstrap fallback).
- **Change admin password**: currently by updating the `admins` row (bcrypt hash) in Supabase, or delete the row and re-bootstrap via env vars.
- **Course versioning**: every publish freezes a full snapshot (including knowledge packages). Learners always finish on the version they started; new learners get the latest published version.

## Browser support

Chrome and Edge (desktop, tablet, mobile) are the priority targets. The learner portal needs microphone permission for voice answering; listening-only and typed answers work without a mic.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Admin login says "Set ADMIN_EMAIL…" | Env vars missing → add them, redeploy, retry |
| Gemini test fails | Key invalid or Live API not enabled for the key |
| "Could not start the AI trainer session" | Check function logs; usually the Live model name isn't available to your key — pick another model in Admin → Gemini Live |
| Knowledge stuck "Processing failed" | The PDF is scanned/image-only (no text layer). Use a text PDF, DOCX or TXT, or edit the knowledge manually |
| CSV opens garbled in Excel | It shouldn't (BOM included) — open via Excel → File → Open if double-click misbehaves |
