-- 001: the original Seedbook schema (users, leads, followups).
--
-- Written with IF NOT EXISTS on purpose: databases created before the
-- numbered-migration runner already have these tables, and this file is what
-- the runner records as "applied" the first time it boots against them.

CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS leads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              VARCHAR(255) NOT NULL,
  company           VARCHAR(255),
  title             VARCHAR(255),
  email             VARCHAR(255),
  phone             VARCHAR(64),
  -- Relationship / how you know them, warmth, mutual contacts, etc.
  relationship      TEXT,
  -- Potential business needs they've expressed.
  business_needs    TEXT,
  -- What you plan to do next.
  next_steps        TEXT,
  status            VARCHAR(32) NOT NULL DEFAULT 'new',
  priority          VARCHAR(16) NOT NULL DEFAULT 'medium',
  source            VARCHAR(255),
  estimated_value   NUMERIC(12,2),
  last_contact_date DATE,
  next_action_date  DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS leads_next_action_idx ON leads (next_action_date);
CREATE INDEX IF NOT EXISTS leads_status_idx ON leads (status);

-- History of AI-generated follow-up drafts per lead.
CREATE TABLE IF NOT EXISTS followups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  content     TEXT NOT NULL,
  model       VARCHAR(128),
  worker      VARCHAR(255),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS followups_lead_idx ON followups (lead_id, created_at DESC);
