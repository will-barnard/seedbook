-- 002: proposal writer — rate card, settings, proposals, and their versions.

-- The rate card. Editable at any time; proposals copy what they quote into
-- proposals.line_items, so changing a price here never rewrites a proposal
-- that has already gone out.
CREATE TABLE offerings (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(120) NOT NULL,
  tagline           TEXT,
  -- Array of strings, one bullet each.
  features          JSONB NOT NULL DEFAULT '[]'::jsonb,
  build_fee         NUMERIC(10,2) NOT NULL DEFAULT 0,
  monthly_fee       NUMERIC(10,2) NOT NULL DEFAULT 0,
  -- Whether the "50% off build or monthly, client's choice" offer may apply.
  discount_eligible BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order        INT NOT NULL DEFAULT 0,
  active            BOOLEAN NOT NULL DEFAULT TRUE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Small key/value store for proposal text that is written once and reused:
-- the next-steps template, the discount wording, signature, style guide.
CREATE TABLE settings (
  key         VARCHAR(64) PRIMARY KEY,
  value       TEXT NOT NULL DEFAULT '',
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE proposals (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Cascades like followups do. If the proposal log should outlive a deleted
  -- lead (it is the raw material for the style guide later), switch this to
  -- SET NULL and snapshot the lead's name/company onto the row.
  lead_id          UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tone             VARCHAR(32) NOT NULL DEFAULT 'casual',
  approach_notes   TEXT,
  extra_details    TEXT,
  -- Snapshot of what is being quoted:
  -- [{offering_id, name, tagline, features[], build_fee, monthly_fee, discount_eligible}]
  line_items       JSONB NOT NULL DEFAULT '[]'::jsonb,
  offer_discount   BOOLEAN NOT NULL DEFAULT FALSE,
  -- Copied from settings at creation so a later change to the standard
  -- discount doesn't alter this proposal.
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 50,
  discount_intro   TEXT,
  -- Off by default: Will's proposals quote the tier by name and price, not
  -- the feature list (that's on his site).
  show_features    BOOLEAN NOT NULL DEFAULT FALSE,
  -- "(or $100/year)" after each monthly price. Yearly is always 10× the
  -- monthly being quoted, so a 50%-off monthly gets a 50%-off yearly too.
  show_yearly      BOOLEAN NOT NULL DEFAULT TRUE,
  -- Will's own words, inserted verbatim after the prices — e.g. a one-off
  -- deal like "the shop work would normally push this to Commerce".
  pricing_note     TEXT,
  -- Email layout, next-steps template and signature are copied from
  -- settings at creation. Templates keep their {{variables}} and are
  -- rendered whenever the proposal is displayed.
  layout           TEXT,
  next_steps       TEXT,
  signature        TEXT,
  status           VARCHAR(16) NOT NULL DEFAULT 'draft',  -- draft|sent|won|lost
  sent_at          TIMESTAMPTZ,
  -- Exactly what was copied out when marked sent.
  sent_subject     TEXT,
  sent_content     TEXT,
  sent_version_id  UUID,
  outcome_note     TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX proposals_lead_idx ON proposals (lead_id, created_at DESC);
CREATE INDEX proposals_status_idx ON proposals (status);

-- Every draft, revision and hand edit. Only the prose sections live here:
-- pricing and next steps are rendered from the proposal row, never written
-- by the model.
CREATE TABLE proposal_versions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  proposal_id  UUID NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  version      INT NOT NULL,
  subject      TEXT,
  intro        TEXT,
  -- Recap of what's being built / what was agreed, as a bullet list.
  scope        TEXT,
  -- Open questions for the client. Empty = section and heading dropped.
  questions    TEXT,
  closing      TEXT,
  -- generate | revise | revise:<section> | manual
  source       VARCHAR(32) NOT NULL,
  feedback     TEXT,
  worker       VARCHAR(255),
  pool         VARCHAR(64),
  elapsed_ms   INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (proposal_id, version)
);

-- ── Seeds ───────────────────────────────────────────────────

INSERT INTO offerings (name, tagline, features, build_fee, monthly_fee, sort_order) VALUES
  ('Professional',
   'Full-featured web application with editing suite',
   '["Mobile responsive design","Contact form integration","SEO basics","Admin dashboard for easy editing","3 rounds of revisions"]',
   300, 10, 1),
  ('Commerce',
   'Professional business website with eCommerce integrations',
   '["Mobile responsive design","Contact form integration","SEO basics","Basic eShop and eCommerce integrations","Admin dashboard for easy editing","3 rounds of revisions"]',
   500, 20, 2),
  ('Enterprise',
   'Powerful suite of tools for online business',
   '["Mobile responsive design","Contact form integration","SEO basics","Advanced eShop and eCommerce tools","Product management dashboard","Admin dashboard for easy editing","Custom business tools and software","5 rounds of revisions"]',
   1000, 30, 3);

INSERT INTO settings (key, value) VALUES
  -- Context for the model about what Will does. Not quoted to clients.
  ('business_summary',
   'I''m an independent web developer. I build custom websites with an admin dashboard so clients can edit their own content, and I host and maintain them for a monthly fee. Many clients come to me from Squarespace, Wix and similar site builders.'),
  -- The shape of every proposal email. {{placeholders}} are filled in; a
  -- **Heading** whose section comes back empty is dropped with it (e.g. no
  -- open questions → no "Questions for you" heading).
  ('email_layout',
'{{intro}}

**The Website**

{{scope}}

**Questions for you**

{{questions}}

**My end of things**

Feel free to check out my portfolio website: [will-barnard.com](https://will-barnard.com)!

{{pricing}}

{{pricing_note}}

{{next_steps}}

{{closing}}

{{signature}}'),
  ('next_steps_template',
'**Next steps, when you are ready**

1. Set up a domain, and add me as a member on Cloudflare. [I have instructions on my site here](https://will-barnard.com/domain-setup). If you already have another domain provider, I also have instructions for how to switch control to Cloudflare.
2. Create an account on [my website](https://studio.will-barnard.com/register) as a client, and purchase the {{tier}} build fee. Monthly billing will not begin until the completed v1 website is delivered after revisions.
3. Deliver to me all your creative assets, and any final requests for the site. We can do a few rounds of revisions, so no sweat to try to have everything perfect.'),
  ('discount_percent', '50'),
  ('discount_intro',
   'I usually offer a {{percent}}% friends discount — your choice of either the build fee or the monthly fee:'),
  -- Will's proposals end on the closing line; Gmail carries his name.
  ('signature', ''),
  -- Distilled from Will's guitar-course proposal (Oct 2026). Edit freely.
  ('style_guide',
'- Casual and friendly, like writing to people I''ve already met. Contractions, short sentences; an exclamation point or two is fine.
- Open with a quick greeting ("Hey Sarah!", or "Hey guys!" for a group), mention the meeting or call, apologise briefly if I''m late following up, and say I''m excited to bring the project to life.
- Recap scope as "here is what we agreed upon, as I remember" — humble, and it invites corrections.
- Scope is a plain bullet list of concrete things the site will do, one line each, in plain words. Call out what is NOT in v1 but that we''re keeping the door open for.
- Ask practical questions directly, and take the pressure off ("a rough number is fine for now", "not mandatory at this stage, up to you").
- Never corporate: no "leverage", "solutions", "synergy", "I hope this email finds you well".
- End with something like "Let me know if you have any questions, and if I left anything out!"'),
  -- A past proposal in Will's own words, shown to the model for voice only.
  -- Pasted on the settings page rather than seeded, to keep client details
  -- out of the repo.
  ('example_proposal', ''),
  -- '' = use DRYDOCK_POOL from env; 'auto' = let dry-dock pick any pool.
  ('proposal_pool', '');
