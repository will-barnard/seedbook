# Seedbook

A sales-lead tracker for an independent dev business. Enter leads, capture the
relationship, their potential business needs, and next steps; get AI-drafted
follow-up messages from your own dry-dock worker node; and get reminder emails
via Resend when a lead is due for a nudge.

- **Frontend** — Vue 3 + Vite, served by nginx.
- **Backend** — Express (Node 20) + Postgres.
- **Follow-ups** — calls the dry-dock generate API (`POST /api/v1/generate`).
- **Proposals** — rate card + dry-dock-written proposal emails with a
  feedback/revision loop, copied into your own email and logged when sent.
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

## Proposals

From a lead, **New proposal** opens the editor:

1. **Setup** — tick offerings from the rate card (prices are copied onto the
   proposal and can be changed for this one deal), optionally offer the
   new-client discount (client picks: % off the build fee *or* the monthly
   fee), pick a tone, and write your directions.
2. **Write** — dry-dock writes the subject, intro, scope recap, open
   questions and closing, and Seedbook pours them into the email layout
   along with your parts. "My end of things" is yours: an editable box per
   proposal where you write the pricing paragraph in your own words and drop
   in `{{build_fee}}`, `{{monthly}}`, `{{yearly}}`, `{{tier}}`, `{{features}}`, `{{discount}}`
   or `{{pricing}}` — the figures (yearly at 10× monthly, discount math) come
   from the offerings. The model never sees or writes a price.
3. **Hone** — give feedback on the whole draft or rewrite one section. Every
   draft, revision and hand edit is kept as a version.
4. **Send** — *Copy email* puts rich text (bold, lists, links) on the
   clipboard for pasting into an email; *Plain text* is the fallback. *Mark
   as sent* logs exactly what went out and moves the lead to `proposal`.
5. **Outcome** — won/lost with a note; the lead follows.

**Rate card** (top nav) holds the offerings and the reusable text: the email
layout, next-steps template (`{{tier}}`, `{{first_name}}`, `{{company}}`),
discount wording and percent, signature, a short "about your business" for
the writer, a style guide and an example proposal (prices stripped, used for
voice only) included in every prompt, and which dry-dock pool writes
proposals. Changes
apply to proposals created afterwards; existing ones keep their snapshot.

Schema lives in `backend/src/migrations/NNN_*.sql`, applied on boot and
tracked in `schema_migrations`.

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
| GET/POST, PUT/DELETE | `/api/offerings`, `/api/offerings/:id` | Rate card. |
| GET/PUT | `/api/settings` | Proposal text settings + writing pool. |
| GET/POST | `/api/proposals` | Proposal log (`?status=`, `?lead_id=`) / create from `{lead_id}`. |
| GET/PUT/DELETE | `/api/proposals/:id` | Proposal + versions + rendered pricing / update setup / delete. |
| POST | `/api/proposals/:id/generate` | Fresh draft via dry-dock. |
| POST | `/api/proposals/:id/revise` | `{feedback, section?, base}` → new version. |
| POST | `/api/proposals/:id/versions` | Save hand edits as a version. |
| POST | `/api/proposals/:id/send` | `{version_id}` → log as sent. |
| POST | `/api/proposals/:id/outcome` | `{status: won\|lost\|sent, note}`. |
| POST | `/api/proposals/import`, `/api/settings/style-guide/distill` | Phase 2 — 501 for now. |
