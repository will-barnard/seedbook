-- 004: drafts follow your templates instead of keeping a copy.
--
-- Until now a proposal copied the email layout, "my end of things", next
-- steps, signature and discount wording from settings when it was created,
-- so editing a template never reached drafts already in progress. That copy
-- isn't needed to protect what was sent — /send freezes the exact email in
-- sent_content. Now NULL on the proposal means "use the current default",
-- and a value is stored only when Will customises that proposal.

ALTER TABLE proposals ALTER COLUMN discount_percent DROP NOT NULL;
ALTER TABLE proposals ALTER COLUMN discount_percent DROP DEFAULT;

-- Drafts holding a plain copy of the CURRENT default → inherit.
UPDATE proposals p SET layout = NULL FROM settings s
 WHERE p.status = 'draft' AND s.key = 'email_layout' AND p.layout = s.value;
UPDATE proposals p SET my_end = NULL FROM settings s
 WHERE p.status = 'draft' AND s.key = 'my_end_template' AND p.my_end = s.value;
UPDATE proposals p SET next_steps = NULL FROM settings s
 WHERE p.status = 'draft' AND s.key = 'next_steps_template' AND p.next_steps = s.value;
UPDATE proposals p SET signature = NULL FROM settings s
 WHERE p.status = 'draft' AND s.key = 'signature' AND p.signature = s.value;
UPDATE proposals p SET discount_intro = NULL FROM settings s
 WHERE p.status = 'draft' AND s.key = 'discount_intro' AND p.discount_intro = s.value;
UPDATE proposals p SET discount_percent = NULL FROM settings s
 WHERE p.status = 'draft' AND s.key = 'discount_percent' AND p.discount_percent = s.value::numeric;

-- Drafts holding a copy of a SHIPPED default that Will has since edited in
-- settings (the case that prompted this) → inherit, so they pick up his edit.
UPDATE proposals SET layout = NULL WHERE status = 'draft' AND layout = '{{intro}}

**The Website**

{{scope}}

**Questions for you**

{{questions}}

**My end of things**

{{my_end}}

{{next_steps}}

{{closing}}

{{signature}}';
UPDATE proposals SET my_end = NULL WHERE status = 'draft' AND my_end = 'Feel free to check out my portfolio website: [will-barnard.com](https://will-barnard.com)!

The pricing I can offer for this project is {{build_fee}} build fee, and {{monthly}} per month (or {{yearly}}/year). This is on my website as the {{tier}}.

{{discount}}';
UPDATE proposals SET next_steps = NULL WHERE status = 'draft' AND next_steps = '**Next steps, when you are ready**

1. Set up a domain, and add me as a member on Cloudflare. [I have instructions on my site here](https://will-barnard.com/domain-setup). If you already have another domain provider, I also have instructions for how to switch control to Cloudflare.
2. Create an account on [my website](https://studio.will-barnard.com/register) as a client, and purchase the {{tier}} build fee. Monthly billing will not begin until the completed v1 website is delivered after revisions.
3. Deliver to me all your creative assets, and any final requests for the site. We can do a few rounds of revisions, so no sweat to try to have everything perfect.';
UPDATE proposals SET signature = NULL WHERE status = 'draft' AND signature IN ('', E'Thanks,\nWill');
UPDATE proposals SET discount_intro = NULL WHERE status = 'draft' AND discount_intro IN (
  'I usually offer a {{percent}}% friends discount — your choice of either the build fee or the monthly fee:',
  'I also offer {{percent}}% off for new clients — your choice of either the build fee or the monthly fee:');
UPDATE proposals SET discount_percent = NULL WHERE status = 'draft' AND discount_percent = 50;
