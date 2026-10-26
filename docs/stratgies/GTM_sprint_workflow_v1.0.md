LaSyncro GTM Sprint Operating Workflow v1.0

Status: PROPOSED — awaiting GTM lead approval. Not a modification of the ratified strategy.
Prepared: 2026-10-26
Recommended repository path: docs/stratgies/GTM_sprint_workflow_v1.0.md
Governing strategy: docs/stratgies/GTM_strategy_v1.0.md (approved and ratified)
Program: GTM-01; applies as a reusable operating procedure to future approved GTM sprints
Owner: Designated LaSyncro GTM lead; VS Code agents are research/QA assistants, not autonomous campaign owners
Scope: Merchant intelligence (Asset A), partner prospecting (Asset B), research validation, review, and approved outreach handoff. No warehouse product code or production customer data.

Governing rule: Every GTM agent task must first read docs/stratgies/GTM_strategy_v1.0.md and this workflow (if approved). If the strategy is missing, unreadable, outdated, or conflicts with this workflow, stop and report BLOCKED or request an explicit decision. Do not silently replace the strategy, alter its approved principles, or infer approval for external actions.
⸻
1. What a sprint must produce

Every sprint must finish with a usable, evidence-backed decision queue, not a scraped list or a claim of market traction:

1. New candidate contact queue: unique accounts that meet the defined evidence, relevance, data-use, and contact-readiness requirements; each with a proposed next action.
2. Follow-up queue: previously contacted accounts with an authorized, dated, lawful next step; never invent follow-up obligations for unsent outreach.
3. Partner queue: new and existing potential partners with a credible ICP path, a concrete mutual-value proposition, approval state, and next action.
4. Research backlog / HOLD queue: high-potential accounts with missing evidence, disputed identity, insufficient permission, or product-fit concerns; name the missing fact and proposed verification step.
5. Disqualified / suppressed queue: explicit reasons, no silent dropping or recontacting opt-outs.
6. Sprint evidence pack and decision report: exact sources, dates, audit results, denominators, costs, conversion evidence, and a recommendation for the next sprint.

Do not fill quotas with weak leads. It is acceptable to deliver fewer than target and HOLD the shortfall with reasons. No outbound email, message, call, CRM write, purchase, data import, integration, or code change is authorized merely by following this workflow.

2. Cadence, experiment limits, and roles

2.1 Cadence (recommended, experimental)

- Sprint length: 10 working days (two weeks). A sprint is a bounded research-and-handoff cycle, not an outreach automation schedule.
- GTM-01: two initial sprints within the existing ratified 30-day controlled-validation program, with foundation and review time. Preserve GTM-01's full-program targets: 30 researched merchants, 10 credible self-fulfillment candidates, 5 genuine merchant conversations, 3 partner approaches, and one light Warehouse Health Check experiment. These are targets, not guaranteed results; conversations and approaches require specific outreach approval.
- Per-sprint planning example: research up to 15 new merchants, aim for 5 well-evidenced self-fulfillment candidates, prepare up to 5 contact-ready records, review 1–2 potential partners. The ready-list target is a capacity hypothesis, not a permission to dilute validation or a locked KPI.
- Sprint configuration may change after evidence-based review and lead approval; preserve program-level and strategy-level distinctions.

2.2 Accountable roles
Role	Responsibility	Authority limit
GTM lead	Approves scope, sources, communication and final queue; decides changes and purchases	Sole commercial decision owner unless formally delegated
Research agent	Discovers and enriches Asset A/Asset B candidates with source evidence	Research only in expressly permitted sources; no outreach or live CRM mutations
Verification/audit agent	Independently checks identities, warehouses, source use, and claim support	Can HOLD/reject records; cannot authorize marketing legality or outreach
Queue compiler	Deduplicates, prepares ranked queues, draft next actions, and sprint report	No messages sent, no CRM writes without approval
Compliance reviewer	Confirms source/marketing handling and suppression process	Human or designated authorized reviewer; agents flag, do not make binding legal determinations

The same person can coordinate roles on a small team, but the researcher and final evidence verifier must be separate review passes. Start with one bounded VS Code agent task at a time; do not create a swarm of unscoped agents.

3. Mandatory start-of-sprint contract (Gate G0)

Before research, the lead or operator records:

sprint_id: GTM-01-S01
strategy_path: docs/stratgies/GTM_strategy_v1.0.md
strategy_version: 1.0
workflow_version: 1.0-PROPOSED
geography: [Gothenburg, Boras, Helsingborg]
segment: Shopify-first, self-fulfilling SMB, 2-10 warehouse operators
research_target: 15
self_fulfillment_candidate_target: 5
contact_ready_target: 5   # experimental; zero permitted if gates fail
partner_review_target: 2
approved_sources: []     # populate with source IDs; no implicit license/ToS approval
approved_access_methods: []
workspace_location: "TO_BE_APPROVED_OUTSIDE_TRACKED_REPO"
outreach_authorized: false
live_crm_write_authorized: false
budget_cap: 0
reviewer: "ASSIGN"
lead: "ASSIGN"
start_date: "ASSIGN"
end_date: "ASSIGN"

Gate G0 PASS requires: strategy/workflow read, Git/repository scope known, source license/use review documented, approved research method, bounded cohort, approved storage location and owners. If missing, return BLOCKED with the missing inputs; do not invent approvals.

Source hierarchy: current lawful public/official sources and approved licensed vendors; never assume websites permit scraping or commercial reuse. Record how data was accessed, source restrictions, and whether any personal data is involved. Research agents must not use LaSyncro production Shopify, order, inventory, customer or operational data.

4. Repeatable Asset A research-and-audit pipeline

G1 — Source discovery (read-only)

- Use only approved sources/methods. Discover stores aligned with the current geography and ICP; preserve a URL or other resolvable reference and date for each observation.
- Collect the minimum needed to evaluate fit. A domain and a claimed brand name are not proof of a legal entity or warehouse.
- Maintain an immutable source observation/evidence log; avoid putting personal contact data in repository files.
- Output: raw candidate IDs and source observations; report source gaps and charges.

G2 — Canonical identity resolution

- Normalize website domain and Shopify storefront; match legal entity with registration-number evidence when possible.
- Keep brand, store, legal company, workplace/facility, contact and sales opportunity as separate logical entities.
- Identify duplicate domains, subsidiaries and multi-store merchants; never silently auto-merge ambiguous matches.
- Output: canonical company ID or IDENTITY_HOLD, identity evidence, merge decision and conflict notes.

G3 — Warehouse/self-fulfillment verification

Use the ratified strategy's classifications:

- confirmed: merchant or independently authoritative evidence explicitly establishes merchant-operated warehouse/stockroom fulfillment.
- probable: at least two independent credible signals; record the remaining gap and do not call it confirmed.
- unknown: only indirect or insufficient evidence, including a registered workplace alone.
- disconfirmed: reliable indication of dropshipping-only, outsourced 3PL-only, or other exclusion.

A shipping app, carrier pickup, registered company address, product count, or a generic warehouse image alone does not establish warehouse ownership. Avoid collecting undisclosed shipment/driver/route information.

G4 — Separate qualification dimensions

Record four fields, not one opaque score:

1. icp_fit: strong / partial / out_of_scope / unknown, with evidence and stated mismatches.
2. warehouse_status: confirmed / probable / unknown / disconfirmed, with exact source references.
3. buying_trigger: observed / inferred / none_known, with type, event date, confidence, and expiry/recheck date.
4. adoption_readiness: merchant_confirmed / possible / unknown / blocked; do not infer budget or urgency from public storefront signals alone.

Preserve revenue band, operator count, orders/day, SKU/variant complexity, technology stack, and pain points separately with unknown where unsupported. Core ICP remains ~$500K–$10M, 2–10 operators and ~20–200 orders/day; exceptions are flagged, not silently promoted.

G5 — Contact-route and allowed-use review

- Identify a public official company contact route or business role when legitimately available; avoid guessed, harvested or unverified individual emails.
- Check source terms, allowable data use, marketing/privacy review, existing CRM conflicts, suppression and no-contact records before calling an account contact-ready.
- Agents cannot decide that outreach is legally permitted merely because an address is public. Where checks are incomplete, mark COMPLIANCE_HOLD.
- Assign the most relevant, truthful problem hypothesis and a proposed first action. Actual messaging requires separately approved outreach scope/campaign and applicable legal checks.

G6 — Independent evidence QA

- Review 100% of records proposed as contact-ready and 100% of newly identified contradictions. A separate audit pass reopens cited sources and checks that each claim follows from them.
- Confirm independence of warehouse evidence; duplicate syndicated postings or repeated vendor claims are not independent corroboration.
- Validate canonical identity, plausible geography, claims about own fulfillment, source freshness, contact-route provenance, suppression status, and current product capability alignment.
- Sample at least 20% of non-ready records for false negatives as an experimental QA target; record error types and correction rate.
- Fail the individual record rather than inventing missing fields. Systemic invalid licensing, widespread false claims or contact/privacy violations cause a batch HOLD.

G7 — Promotion to decision queue

A record is CONTACT_READY for human handoff only when all are true:

- Canonical merchant identity and Shopify-first evidence are supported.
- Strong/defensible ICP suitability is documented; warehouse is at least probable, not unknown, with the tier explicit.
- At least one credible problem/buying-trigger hypothesis or well-documented qualifying research reason exists (lack of a public trigger is not invented urgency).
- An appropriate business contact channel is recorded with provenance.
- Data-use review, suppression review, independent evidence QA and product-claims check are complete and marked PASS.
- There is a specific proposed next action, human owner, and review-by date.

CONTACT_READY does not mean outreach sent or authorized. If explicit outreach approval is absent, keep dispatch state NOT_AUTHORIZED.

Priority categories: P1 confirmed self-fulfillment + high fit + credible trigger; P2 confirmed/probable operations + strong fit + fewer timing signals; HOLD missing critical facts; EXCLUDE disconfirmed/out of scope. These are proposed operational labels, not immutable score thresholds.

5. Repeatable Asset B partner pipeline

B1. Discover agencies, Auto-ID/barcode and warehouse equipment vendors, packaging suppliers, logistics consultants, industry associations and complementary shipping platforms serving the ICP. Favor low competitive overlap.

B2. Validate actual merchant access, relevance, credibility, competitive risks, commercial incentives, decision-maker route, likely referral mechanism, and a realistic value exchange. A large customer count without ICP overlap has low priority.

B3. Define one partner-specific pilot offer, preferably warm, merchant-authorized referrals, a co-branded no-install Warehouse Health Check, or targeted merchant education. Do not ask for unrestricted client lists.

B4. Audit independently: verify company and claimed services, conflicts, source terms, reputational fit and plausible next meeting/contact route.

B5. Promote to PARTNER_CONTACT_READY only after legal/suppression and reviewer checks; PARTNER_CONTACT_READY is not approval to contact.

B6. Handle approved introductions with documented merchant authorization, canonical matching, suppression, attribution conflict checks, human acceptance, and a recorded next step. Referral payments and terms require separate explicit approval.

B7. Measure introductions, qualified conversations, pilots, paid accounts, partner time/cost and retained revenue. A signed partnership with no qualified opportunities is not a productive channel.

6. Contact/follow-up state machine
State	Exact meaning	Owner action
RESEARCHING	Research unfinished	Investigate specified gaps
EVIDENCE_HOLD	Conflicting/missing identity, warehouse or fit facts	Verify, never send
COMPLIANCE_HOLD	Purpose, licensing, contact rules or suppression unresolved	Review, never send
QA_HOLD	Independent audit not passed	Correct with sources
CONTACT_READY	Verified, reviewed, permitted for handoff	Seek approval of proposed outreach
OUTREACH_APPROVED	Authorized communication scope and recipient/channel	Human or approved tool may act
CONTACTED	Actual communication evidenced with date/channel	Track response and next step
FOLLOW_UP_DUE	Previously contacted, lawful, authorized next touch is due	Review and conduct approved follow-up
DISCOVERY	Genuine two-way merchant conversation	Confirm pain, scope and readiness
PILOT	Mutually agreed limited product trial	Measure activation and real value
PAID	Actually paying customer	Retention and outcome measurement
DISQUALIFIED / SUPPRESSED	Unsuitable or must not contact	Preserve reason and protection

No CONTACTED without evidence that a contact occurred. No FOLLOW_UP_DUE if no outreach occurred. No PAID without verified commercial records. A follow-up date is a planned action, not an automation.

7. Minimum records and controlled storage

Keep two environments:

1. Repository: ratified strategy, approved operating workflow, redacted sprint summaries, schemas, generic prompts, and change proposals only. No real individual contact addresses, private partner records, purchased datasets, raw source exports, access tokens or confidential merchant information.
2. Approved secure GTM workspace/CRM: source register, evidence, company/store/facility records, partner records, personal contacts when legitimately processed, suppression, outreach events, referral permission and actual follow-up queue. Access controlled, MFA, export restrictions and retention policy.

Recommended merchant record (fields may be stored in structured tables, not necessarily one file):

account_id, brand, storefront_domain, legal_entity_name, registration_number,
region, fulfillment_status, fulfillment_evidence_ids, fulfillment_confidence,
icp_fit_status, revenue_band, warehouse_operators, estimated_daily_orders,
sku_complexity, operational_pain_hypothesis, buying_trigger_type,
trigger_evidence_ids, trigger_date, adoption_readiness, key_unknowns,
source_ids, evidence_last_checked_at, source_license_status,
contact_route_type, contact_route_source, contact_permission_status,
suppression_check, dedupe_check, product_scope_check, qa_status,
queue_status, priority_tier, recommended_message_angle,
next_action, next_action_owner, next_action_date, last_contacted_at,
followup_due_at, originating_asset, assisted_asset, sprint_id

Required evidence observation:

evidence_id, account_id, claim_field, observed_value, observed_or_inferred,
source_id, exact_url_or_document_reference, accessed_at, event_date,
source_independence_group, reliability_note, license_permitted_use,
reviewer_id, verified_at, status, correction_history_reference

Required partner record:

partner_id, company_name, category, geography, icp_overlap_evidence,
competition_risk, offered_value, expected_referral_path,
public_contact_route, source_ids, permission_or_agreement_status,
partner_stage, qa_status, next_action, owner, next_action_date,
referrals_introduced, opportunities_generated, paid_merchants, sprint_id

Dates: ISO 8601; unknowns: explicit unknown/null, never zero as a proxy; IDs: canonical, stable, never based on mutable display names. No CSV field is permission to gather a particular kind of data.

8. Required sprint-end delivery package

A successful sprint produces these logical deliverables, kept in appropriate locations. Filenames are examples, not authorization for writing to any connected CRM:
Deliverable	Purpose	Handling
contact_ready.csv	Ranked new candidates; action owner/date, qualifying reasons, linked evidence IDs	Secure GTM workspace only
followups_due.csv	Previously contacted merchants with next authorized touch, prior interaction, next step/date	Secure GTM workspace only
partner_queue.csv	Audited partner opportunities and next actions	Secure GTM workspace only
holds_and_exclusions.csv	Missing facts, duplicates, out-of-scope and suppressed counts/reasons	Secure GTM workspace only
evidence_register.*	Source IDs, claims, exact references, accessed/reviewed dates	Secure GTM workspace only
source_approvals.*	Source purpose, method, license, privacy, validity and owner	Controlled-access workspace
sprint_review.md	Sanitized aggregate results, QA, costs, blockers, decisions and next sprint parameters	Can be saved in repository after review
change_proposals.md	Explicit modifications suggested for strategy/SOP/rubric	Proposal only until approved

A contact-ready list is not a sending list. The GTM lead checks compliance and separately approves any dispatch. If no permitted channel or compliance review is available, report candidates in HOLD rather than force CONTACT_READY.

Required sprint-end scorecard

SPRINT_ID:
STRATEGY_PATH / VERSION / HASH:
WORKFLOW_PATH / VERSION:
DATE_RANGE:
SCOPE_AND_ALLOWED_SOURCES:
RESEARCHED_NEW_UNIQUE:
DUPLICATES_REMOVED:
WAREHOUSE_CONFIRMED:
WAREHOUSE_PROBABLE:
WAREHOUSE_UNKNOWN:
WAREHOUSE_DISCONFIRMED:
NEW_CONTACT_READY:             # QA-passed and contact-use-reviewed
NEW_OUTREACH_APPROVED:         # separate explicit approval
ACTUALLY_CONTACTED:
FOLLOW_UP_DUE:
COMPLIANCE_HOLD / EVIDENCE_HOLD / QA_HOLD:
PARTNERS_RESEARCHED / CONTACT_READY / ACTUALLY_CONTACTED:
PARTNER_INTRODUCTIONS_AUTHORIZED:
REAL_QUALIFIED_CONVERSATIONS:
HEALTH_CHECK_COMPLETIONS:
PILOTS / PAID / RETAINED:       # only observed verified counts
RESEARCH_HOURS / PAID_SOURCE_COST / OTHER_COSTS:
SOURCE_YIELD_BY_SOURCE:
AUDIT_SAMPLE / AUDIT_FAILURES / CORRECTIONS:
TOP_FALSE_POSITIVE_REASONS:
NEXT_ACTION_QUEUE_LOCATION:    # approved secure location only
STATUS: PASS | HOLD | BLOCKED
BLOCKERS:
RECOMMENDATION_FOR_NEXT_SPRINT:
LEAD_DECISIONS_REQUIRED:
EXTERNAL_ACTIONS_TAKEN_AND_AUTHORIZATION:
REPO_FILES_CHANGED / COMMITS / PUSHES / DEPLOYS:

Sprint QA PASS means the process and records satisfy quality gates, not that a quota or commercial conversion was achieved. Report numerical underperformance independently and never label target misses as wins.

9. Day-by-day execution and gates
Day	Focus	Outputs / gates
0 (setup)	Read strategy, approve source access, designate secure storage and lead/reviewer	G0 PASS or BLOCKED
1–3	Asset A + B discovery from allowed sources	G1 raw evidence and dedup queue
4–6	Identity and fulfillment verification; separate fit/trigger/readiness	G2–G4 classifications
6–7	Contact-route checks and independent audit	G5–G6 PASS/HOLD per record
8	Build ranked queues, review active follow-ups and partner offers	G7 handoff pack
9	GTM lead evaluates audit, targets, legal gates and outreach proposal	Human signoff or HOLD
10	Finalize secure lists, redacted sprint report, carryover and change proposals	Sprint close + next decision

If the sprint is research-only, the outreach, response and conversation numbers remain zero/unattempted rather than being treated as failures. Commercial-action targets only activate after separate approval.

Work in progress and stop rules

- Do not repeatedly research the same company once a canonical account and current valid evidence exist; instead refresh fields due for review.
- Suspend sources with invalid/unclear permitted use, systemic inaccurate warehouse signals, or unjustified cost.
- If source accuracy is weak, modify hypothesis and source selection through approval, not quota or classification rigor.
- If demand requires unsupported product features, park the opportunity and report the gap rather than promising unbuilt functionality.
- Carry unresolved accounts forward with owner, missing fact, revisit condition/date; never silently drop them or automatically recycle an opt-out.

10. Change control and continuity

Authority order: platform/security/legal constraints → current engineering/agent workflow for repo work → docs/stratgies/GTM_strategy_v1.0.md for GTM principles → approved sprint workflow for execution → current sprint charter for bounded targets and permissions.

- At every sprint start: read the strategy and workflow; record strategy version + Git blob hash or SHA-256 in the sprint charter and report.
- At every sprint end: propose narrowly scoped workflow or qualification improvements with observed evidence and impact. Do not modify strategy, score weights, external-action permissions, outreach rules or this workflow without explicit GTM-lead authorization.
- On approval: update the appropriate document in a versioned change, append a decision-log entry, identify effective sprint, keep prior reports interpretable. Bump strategy version if a ratified strategic principle changes; bump workflow version if procedure or schema materially changes; smaller typo fixes can be tracked in revision notes.
- Unresolved disagreements: HOLD; report the exact document clause and proposed decision. Never reinterpret a higher-priority rule silently.
- No git add/commit/push, PR, deployment, paid account writes, purchases, bulk import or outreach without separately approved action and repository policy compliance.

11. Standard bounded agent prompts

11.1 Research agent — read-only batch

RUN_ID: GTM-01-S01-ASSET-A-RESEARCH
ROLE: Evidence-based merchant researcher (READ ONLY)
AUTHORITIES:
  1. docs/stratgies/GTM_strategy_v1.0.md
  2. docs/stratgies/GTM_sprint_workflow_v1.0.md (only after approval)
  3. separately provided engineering/agent directives for repo access

FIRST: Verify both GTM documents exist; read them completely. Report strategy
version and exact hash, current git branch/status, work scope and source approvals.
If either is inaccessible or source access is unapproved, STOP as BLOCKED.

SCOPE: Research at most 15 new unique Shopify-first merchant accounts in
approved Swedish geography via approved sources and methods only. Reuse
canonical records, identify warehouse evidence, separate ICP fit / triggers /
readiness / confidence, and preserve source links and observation timestamps.

DO NOT: scrape prohibited sources, use production Shopify/warehouse data,
request or store private carrier manifests, invent revenue/order volume,
collect nonessential personal data, contact anyone, write live CRM records,
change product code, modify ratified docs, commit/push/deploy or purchase tools.

OUTPUT: unique candidate count, dedupe list, structured evidence IDs,
confirmed/probable/unknown/disconfirmed counts, each account's missing facts,
source/usage issues, proposed QA handoff; no exposed personal data in git.
Status PASS/HOLD/BLOCKED, with precise reasons.

11.2 Auditor — independent evidence gate

RUN_ID: GTM-01-S01-EVIDENCE-QA
ROLE: Independent auditor (READ ONLY)
FIRST: Read the ratified strategy and approved sprint SOP; verify hashes
and review authority, source license statuses, and scope.
INPUT: approved secure-workspace batch reference supplied by lead.
CHECK: source supports each key claim, legal-company identity, 3PL vs own
fulfillment, signal independence and recency, trigger/readiness uncertainty,
identity duplicates, source terms, contact-use/suppression status,
product-claims accuracy, and completeness of next action.
SAMPLE: 100% of contact-ready submissions; at least 20% of other candidate
records (experimental); review every contradiction.
DO NOT: promote weak evidence, infer legal permission, contact anyone,
read production data, or modify strategy or product code.
OUTPUT: PASS/HOLD per record, exact corrections, systemic batch HOLD issues,
audit counts and source links; no automatic outreach approval.

11.3 Queue compiler — research sprint close

RUN_ID: GTM-01-S01-QUEUE-CLOSE
ROLE: Sprint queue compiler (NO EXTERNAL ACTION)
FIRST: Read ratified strategy, approved sprint SOP, current charter and
independent audit result. Do not treat a previous agent's claims as verified.
INPUT: only QA-passed records and existing authorized-contact activity.
PRODUCE: contact-ready queue, lawful authorized follow-ups, partner queue,
HOLD/exclusion queue, sanitized sprint review and next-sprint change proposals.
ENFORCE: stable company identities, one primary attribution, no duplicate
active opportunities, required source IDs, suppression, action owner/date,
explicit dispatch approval state. Keep contact/partner personal data out of git.
REPORT: complete scorecard with actual denominators and audited evidence;
separate process PASS from commercial results. Never contact prospects or
modify live CRM without specific authorization.

11.4 Sprint lead review (human)

REVIEW: Sprint ID, source approvals, evidence QA, legal/suppression, contact
queue quality, follow-up authenticity, partner offer feasibility, product
readiness, time/cost and experiment results.
DECIDE: Accept / HOLD / Rework batch; approve or reject any specific contact
campaign, CRM write, spending, automation or partnership action separately.
DOCUMENT: Decision ID, owner, scope, approved channels, expiration/date,
limits, and strategy/workflow change requests.

12. Initial launch checklist

- [ ] Confirm this proposed SOP is approved and saved at its chosen repository path.
- [ ] Confirm the actual strategy path spelling (stratgies) and read exact repository files.
- [ ] Approve the first GTM-01 sprint charter (targets/region/source access/owner).
- [ ] Select a secure storage/CRM method and permitted source register; no default live CRM access.
- [ ] Approve any real-company data import/research method as applicable.
- [ ] Run bounded read-only research, then a separate evidence-audit pass.
- [ ] Compile reviewed candidate and follow-up queues; obtain human outbound authorization if applicable.
- [ ] Close sprint with counts, source economics, evidence errors and change proposals.
- [ ] Use sprint learnings to calibrate the next sprint under explicit approval.
⸻
Revision and decision log
Date	Version	Change	Approval status
2026-10-26	1.0 draft	Proposed reusable two-week GTM sprint SOP anchored to ratified strategy; separated evidence QA, contact readiness, outreach authorization and sprint-end queues	PROPOSED — NOT YET RATIFIED
