# Seedbook

A sales-lead tracker for an independent dev business. Enter leads, capture the
relationship, their potential business needs, and next steps; get AI-drafted
follow-up messages from your own dry-dock worker node; and get reminder emails
via Resend when a lead is due for a nudge.

- **Frontend** — Vue 3 + Vite, served by nginx.
- **Backend** — Express (Node 20) + Postgres.
- **Follow-ups** — calls the dry-dock generate API (`POST /api/v1/generate`).
- **Reminders** — Resend, with a daily digest (node-cron) plus a manual
  per-lead "email me a reminder" button.
- **Deploy** — Beachhead-compatible (`beachhead.json`, blue/green, stateful
  postgres).

## Lead fields

Name, company, title, email, phone, relationship / how you know them, potential
business needs, next steps, status (new → contacted → qualified → proposal →
won/lost), priority, source, estimated value, last-contact date, next-action
date, and notes.

## Local development

```bash
# Postgres (or use your own)
docker run -d --name seedbook-pg -e POSTGRES_USER=seedbook \
  -e POSTGRES_PASSWORD=seedbook -e POSTGRES_DB=seedbook -p 5432:5432 postgres:16

# Backend
cd backend
cp ../.env.example .env   # edit values; set DATABASE_URL for local pg
npm install
DATABASE_URL=postgresql://seedbook:seedbook@localhost:5432/seedbook \
  SESSION_HTTPS_ONLY=false npm run dev

# Frontend (separate terminal) — proxies /api to localhost:3001
cd frontend
npm install
npm run dev
```

Open the Vite URL. First visit prompts you to create the admin account.

## Deploy on Beachhead

1. Push this repo to GitHub and point Beachhead at it.
2. In the Beachhead dashboard, set the env vars from `.env.example` (no Target
   Service, so they land in `.env`): `DB_PASSWORD`, `SESSION_SECRET`,
   `DRYDOCK_BASE_URL`, `DRYDOCK_API_KEY`, `RESEND_API_KEY`,
   `REMINDER_EMAIL_FROM`, `REMINDER_EMAIL_TO`, and optionally `DRYDOCK_POOL`,
   `REMINDER_CRON`, `REMINDER_TZ`.
3. Deploy. First visit → create the admin account.

`postgres` is declared `stateful` in `beachhead.json`, so its data survives
blue/green swaps.

## dry-dock integration

Set `DRYDOCK_API_KEY` on the dry-dock orchestrator (the same value you put
here) and the follow-up button will dispatch to your `researcher` pool. See
`DRYDOCK-API.md` in the dry-dock repo for the full API contract.

## API summary

| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/auth/status` / `setup` / `login` / `logout` | Auth (first user = admin). |
| GET | `/api/config` | Which integrations are configured. |
| GET/POST | `/api/leads` | List / create leads. |
| GET/PUT/DELETE | `/api/leads/:id` | Read / update / delete a lead. |
| POST | `/api/leads/:id/generate-followup` | Draft a follow-up via dry-dock. |
| POST | `/api/leads/:id/remind` | Email yourself a reminder for this lead. |
| POST | `/api/reminders/run` | Send the due-leads digest now. |
