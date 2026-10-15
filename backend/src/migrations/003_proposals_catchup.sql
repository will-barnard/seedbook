-- 003: bring databases that ran an EARLIER revision of 002 up to date.
--
-- 002 was edited in place after it had already been applied on Will's
-- machine, and the runner (correctly) never re-runs an applied file. This
-- migration converges both earlier revisions onto the current 002 shape.
-- Every statement is guarded, so on a database that ran the current 002 it
-- does nothing. Lesson recorded: once a migration has run anywhere, changes
-- go in a new file.

-- ── proposal_versions: approach → scope, + questions ───────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'proposal_versions' AND column_name = 'approach')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'proposal_versions' AND column_name = 'scope') THEN
    ALTER TABLE proposal_versions RENAME COLUMN approach TO scope;
  END IF;
END $$;
ALTER TABLE proposal_versions ADD COLUMN IF NOT EXISTS scope TEXT;
ALTER TABLE proposal_versions ADD COLUMN IF NOT EXISTS questions TEXT;

-- ── proposals ───────────────────────────────────────────────
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS show_yearly BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS layout TEXT;
ALTER TABLE proposals ADD COLUMN IF NOT EXISTS my_end TEXT;
ALTER TABLE proposals ALTER COLUMN tone SET DEFAULT 'casual';
-- The tier feature list moved into {{features}} in "my end of things".
ALTER TABLE proposals DROP COLUMN IF EXISTS show_features;

-- ── settings: add any keys the earlier revision didn't seed ─
INSERT INTO settings (key, value) VALUES
  ('email_layout',
'{{intro}}

**The Website**

{{scope}}

**Questions for you**

{{questions}}

**My end of things**

{{my_end}}

{{next_steps}}

{{closing}}

{{signature}}'),
  ('my_end_template',
'Feel free to check out my portfolio website: [will-barnard.com](https://will-barnard.com)!

The pricing I can offer for this project is {{build_fee}} build fee, and {{monthly}} per month (or {{yearly}}/year). This is on my website as the {{tier}}.

{{discount}}'),
  ('example_proposal', ''),
  ('style_guide', '')
ON CONFLICT (key) DO NOTHING;

-- The revision-2 layout had the portfolio line + {{pricing}} + {{pricing_note}}
-- where {{my_end}} now goes. Swap that block (settings and every proposal
-- that snapshotted it); a layout Will edited differently gets {{pricing}}
-- → {{my_end}} so his section still appears.
UPDATE settings SET value = replace(value,
  E'Feel free to check out my portfolio website: [will-barnard.com](https://will-barnard.com)!\n\n{{pricing}}\n\n{{pricing_note}}',
  '{{my_end}}')
WHERE key = 'email_layout' AND value LIKE '%{{pricing_note}}%';
UPDATE settings SET value = replace(replace(value, E'\n\n{{pricing_note}}', ''), '{{pricing}}', '{{my_end}}')
WHERE key = 'email_layout' AND value NOT LIKE '%{{my_end}}%';

UPDATE proposals SET layout = replace(layout,
  E'Feel free to check out my portfolio website: [will-barnard.com](https://will-barnard.com)!\n\n{{pricing}}\n\n{{pricing_note}}',
  '{{my_end}}')
WHERE layout LIKE '%{{pricing_note}}%';
UPDATE proposals SET layout = replace(replace(layout, E'\n\n{{pricing_note}}', ''), '{{pricing}}', '{{my_end}}')
WHERE layout IS NOT NULL AND layout NOT LIKE '%{{my_end}}%';
-- Revision 1 had no layout column at all.
UPDATE proposals SET layout = (SELECT value FROM settings WHERE key = 'email_layout')
WHERE layout IS NULL;

-- Existing proposals start "my end of things" from the template, with any
-- pricing note Will had written carried over underneath it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name = 'proposals' AND column_name = 'pricing_note') THEN
    EXECUTE $q$
      UPDATE proposals
         SET my_end = (SELECT value FROM settings WHERE key = 'my_end_template')
                      || CASE WHEN coalesce(trim(pricing_note), '') <> ''
                              THEN E'\n\n' || pricing_note ELSE '' END
       WHERE my_end IS NULL
    $q$;
    ALTER TABLE proposals DROP COLUMN pricing_note;
  END IF;
END $$;
UPDATE proposals SET my_end = (SELECT value FROM settings WHERE key = 'my_end_template')
WHERE my_end IS NULL;

-- ── Revision-1 defaults that changed (only where still untouched) ──
UPDATE settings
   SET value = replace(value, 'Create an account on my website as a client',
                       'Create an account on [my website](https://studio.will-barnard.com/register) as a client')
 WHERE key = 'next_steps_template' AND value NOT LIKE '%studio.will-barnard.com%';
UPDATE proposals
   SET next_steps = replace(next_steps, 'Create an account on my website as a client',
                            'Create an account on [my website](https://studio.will-barnard.com/register) as a client')
 WHERE status = 'draft' AND next_steps NOT LIKE '%studio.will-barnard.com%';
UPDATE settings
   SET value = 'I usually offer a {{percent}}% friends discount — your choice of either the build fee or the monthly fee:'
 WHERE key = 'discount_intro'
   AND value = 'I also offer {{percent}}% off for new clients — your choice of either the build fee or the monthly fee:';
UPDATE settings SET value = '' WHERE key = 'signature' AND value = E'Thanks,\nWill';
UPDATE settings SET value =
'- Casual and friendly, like writing to people I''ve already met. Contractions, short sentences; an exclamation point or two is fine.
- Open with a quick greeting ("Hey Sarah!", or "Hey guys!" for a group), mention the meeting or call, apologise briefly if I''m late following up, and say I''m excited to bring the project to life.
- Recap scope as "here is what we agreed upon, as I remember" — humble, and it invites corrections.
- Scope recaps what they asked for and what we agreed, in their terms, as a plain bullet list, one line each. Call out what is NOT in v1 but that we''re keeping the door open for.
- Ask practical questions directly, and take the pressure off ("a rough number is fine for now", "not mandatory at this stage, up to you").
- Never corporate: no "leverage", "solutions", "synergy", "I hope this email finds you well".
- End with something like "Let me know if you have any questions, and if I left anything out!"'
 WHERE key = 'style_guide' AND value = '';

-- Scope is about the client's project now (tiers live in "my end of things").
UPDATE settings SET value = replace(value,
  'Scope is a plain bullet list of concrete things the site will do, one line each, in plain words.',
  'Scope recaps what they asked for and what we agreed, in their terms, as a plain bullet list, one line each.')
 WHERE key = 'style_guide';
