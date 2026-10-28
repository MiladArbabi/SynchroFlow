LaSyncro GTM Sprint Operating Workflow v1.4

Status: APPROVED AND RATIFIED — GTM-CHG-006 (2026-10-28), effective for GTM-01-S02 only after publication and charter/index pinning. Supersedes v1.3, retained for history. The prior fast triage, approved-source conditions, G5 contact/compliance, independent CONTACT_READY QA and separate per-recipient dispatch authorization remain mandatory.
Prepared: 2026-10-26 (v1.0); revised and ratified 2026-10-26 (v1.1, GTM-CHG-001); revised 2026-10-26 (v1.2, GTM-CHG-003)
Repository path: docs/stratgies/GTM_sprint_workflow_v1.4.md (v1.3, v1.2, v1.1 and v1.0 remain unchanged historical versions)
Entry point: docs/stratgies/GTM_INDEX.md lists which versions are approved
Governing strategy: docs/stratgies/GTM_strategy_v1.0.md (approved and ratified)
Program: GTM-01; applies as a reusable operating procedure to future approved GTM sprints
Owner: Designated LaSyncro GTM lead; VS Code agents are research/QA assistants, not autonomous campaign owners
Scope: Merchant intelligence (Asset A), partner prospecting (Asset B), research validation, review, and approved outreach handoff. No warehouse product code or production customer data.

Governing rule: Every GTM agent task must first read docs/stratgies/GTM_strategy_v1.0.md and the workflow version marked approved in docs/stratgies/GTM_INDEX.md. If the strategy is missing, unreadable, outdated, or conflicts with this workflow, stop and report BLOCKED or request an explicit decision. Do not silently replace the strategy, alter its approved principles, or infer approval for external actions.
⸻
1. What a sprint must produce

Every sprint must finish with a usable, evidence-backed decision queue, not a scraped list or a claim of market traction:

1. Merchant preparation shortlist: initial GOOD_CANDIDATE, HUMAN_REVIEW and DROP decisions with minimum evidence and next actions. This is not CONTACT_READY or permission to send. Formal contact-ready and outreach queues retain G5–G7 gates.
2. Follow-up queue: previously contacted accounts with an authorized, dated, lawful next step; never invent follow-up obligations for unsent outreach. N/A in research-only sprints.
3. Partner queue: new and existing potential partners with a credible ICP path, a concrete mutual-value proposition, approval state, and next action.
4. Research backlog / HOLD queue: high-potential accounts with missing evidence, disputed identity, insufficient permission, or product-fit concerns; name the missing fact and proposed verification step.
5. Disqualified / suppressed queue: explicit reasons, no silent dropping or recontacting opt-outs.
6. Sprint evidence pack and decision report: exact sources, dates, audit results, denominators, costs, conversion evidence, and a recommendation for the next sprint.

Do not fill quotas with weak leads. It is acceptable to deliver fewer than target and HOLD the shortfall with reasons. No outbound email, message, call, CRM write, purchase, data import, integration, or code change is authorized merely by following this workflow.

2. Cadence, experiment limits, and roles

2.1 Cadence (recommended, experimental)

- Sprint length: 10 working days (two weeks). A sprint is a bounded research-and-handoff cycle, not an outreach automation schedule.
- GTM-01: exactly two sprints within the existing ratified 30-day controlled-validation program; no additional sprint is added. S01 Day 0 (G0-A and G0-B) = strategy §14.1 Days 1–7 Foundation. S01 Days 1–8 = strategy Days 8–15 Merchant evidence (research-only). S02 = strategy Days 16–30: Commercial validation (only if separately authorized under G5) and the Days 24–30 Decision review. Preserve GTM-01's full-program targets: 30 researched merchants, 10 credible self-fulfillment candidates, 5 genuine merchant conversations, 3 partner approaches, and one light Warehouse Health Check experiment. These are targets, not guaranteed results; conversations and approaches require specific outreach approval.
- Per-sprint planning example: research up to 15 new merchants, aim for 5 well-evidenced self-fulfillment candidates, prepare up to 5 contact-ready records (only with G5 PASS; otherwise 0), review 1–2 potential partners. The ready-list target is a capacity hypothesis, not a permission to dilute validation or a locked KPI.
- Research-only sprint: contact_ready_target is 0 until the G5 contact/compliance gate has passed; the follow-up queue is N/A while no authorized outreach exists; partner_review_target is at most 2 and is review only; partner approach counts belong to a sprint with G5 authorization.
- Sprint configuration may change after evidence-based review and lead approval; preserve program-level and strategy-level distinctions.

2.2 Accountable roles
Role	Responsibility	Authority limit
GTM lead	Approves scope, sources, communication and final queue; decides changes and purchases	Sole commercial decision owner unless formally delegated
Research agent	Discovers and enriches Asset A/Asset B candidates with source evidence	Research only in expressly permitted sources; no outreach or live CRM mutations
Verification/audit agent	Independently checks claims for CONTACT_READY promotions and material contradictions	No mandatory repeat browser audit merely for a preliminary GOOD candidate; can HOLD formal promotions; cannot authorize outreach
Queue compiler	Deduplicates, prepares ranked queues, draft next actions, and sprint report	No messages sent, no CRM writes without approval
Compliance reviewer	Confirms source/marketing handling and suppression process	Human or designated authorized reviewer; agents flag, do not make binding legal determinations

The same person can coordinate roles on a small team, but the researcher and final evidence verifier must be separate review passes. Start with one bounded VS Code agent task at a time; do not create a swarm of unscoped agents.

3. Mandatory start-of-sprint contract (Gate G0)

Before research, the lead or operator records the sprint charter. Values marked "ASSIGN" or "REQUIRES LEAD DECISION" are not approvals; an agent must never fill them.

sprint_id: GTM-01-S01
mode: RESEARCH_ONLY          # RESEARCH_ONLY | RESEARCH_AND_CONTACT (requires G5 PASS)
strategy_path: docs/stratgies/GTM_strategy_v1.0.md
strategy_version: 1.0
strategy_commit_and_sha256: "ASSIGN"   # see §10 pinning
workflow_version: "ASSIGN"             # approved version only
workflow_commit_and_sha256: "ASSIGN"
g0a_decision_id: "ASSIGN"
g0b_decision_id: "ASSIGN"
g5_decision_id: null         # null = no contact authorization
previous_blocker_review: "ASSIGN"      # §13.2 kickoff review reference
research_hours_cap: "ASSIGN"
evidence_reviewer: "ASSIGN"  # must differ from researcher
compliance_reviewer: null    # required before any G5 decision
geography: [Gothenburg, Boras, Helsingborg]
segment: Shopify-first, self-fulfilling SMB, 2-10 warehouse operators
research_target: 15
self_fulfillment_candidate_target: 5
contact_ready_target: 0   # research-only sprint; >0 only with G5 PASS
partner_review_target: 2
approved_sources: []     # populate with source IDs; no implicit license/ToS approval
approved_access_methods: []
workspace_location: "TO_BE_APPROVED_OUTSIDE_TRACKED_REPO"
outreach_authorized: false
live_crm_write_authorized: false
budget_cap: 0
lead: "ASSIGN"
start_date: "ASSIGN"
end_date: "ASSIGN"

Gate G0 has two parts. Neither part authorizes contact.

- G0-A Foundation PASS requires: strategy and approved workflow read and pinned (§10); named GTM lead and evidence reviewer; approved non-repository workspace (§7); at least two source-register rows with status APPROVED_FOR_RESEARCH, each recording access method, terms reference, terms status, personal-data restriction, cost and review-by date; mode recorded; previous-sprint blocker review completed (§13.2).
- G0-B Research Authorization PASS requires: G0-A PASS and a lead decision ID that names the specific RUN_ID, cohort cap, research-hours cap, dates and approved sources/methods. G0-B never authorizes contact, CRM writes, purchases, account registration or imports.
- G5 Contact/Compliance Authorization is separate (§4 G5) and is required before any record may become CONTACT_READY.

If any G0-A or G0-B input is missing, return BLOCKED with the missing inputs; do not invent approvals. A source whose terms status is UNKNOWN or BLOCKED, or whose review-by date has passed, is not approved and must not be used until re-reviewed.

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
- Before creating an account, check existing canonical records by registration number, then normalized domain, then brand; a match reuses the existing account_id. A partial or conflicting match is IDENTITY_HOLD, never a new account and never a silent merge.
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

1. icp_fit: strong / partial / out_of_scope / unknown, with evidence and stated mismatches. icp_fit excludes warehouse status, which is judged only in warehouse_status.
   - strong: positive cited evidence for each mandatory criterion: Shopify-first storefront; physical-goods catalog with SKU/variant complexity consistent with strategy §3.1; operating legal entity in the charter geography; and no evidenced strategy §3.3 exclusion. Revenue band, operator count and orders/day must be evidenced inside or near the core band where available; any that are unknown must be listed in key_unknowns. Unknown is never evidence of fit.
   - partial: one or more mandatory criteria lack positive evidence, or a dimension falls in the strategy §3.2 adjacent band.
   - out_of_scope: any strategy §3.3 exclusion is evidenced.
   - unknown: insufficient evidence to assess.
2. warehouse_status: confirmed / probable / unknown / disconfirmed / contradictory, with exact source references. contradictory = credible evidence conflicts; treat as EVIDENCE_HOLD.
3. buying_trigger: observed / inferred / none_known / expired, with type, event date, confidence, and trigger_recheck_at. Default recheck (experimental): job ads at posting close or 60 days after first seen; announcements and other public signals 90 days. A trigger past trigger_recheck_at becomes expired and counts as none_known until rechecked.
4. adoption_readiness: merchant_confirmed / possible / unknown / blocked (blocked = evidenced barrier such as an active incompatible WMS commitment or explicit refusal); do not infer budget or urgency from public storefront signals alone.

Preserve revenue band, operator count, orders/day, SKU/variant complexity, technology stack, and pain points separately with unknown where unsupported. Core ICP remains ~$500K–$10M, 2–10 operators and ~20–200 orders/day; exceptions are flagged, not silently promoted.

G4a — Fast commercial triage (GTM-CHG-005)

Choose one PRE-CONTACT business decision separately from the formal G2–G4 evidence fields:

- GOOD_CANDIDATE (green): credible, lawfully obtained signals establish a Shopify-first store, relevant physical products, charter geography and a credible merchant-run warehouse hypothesis, with no known disqualifier. Put it on the outreach-PREPARATION shortlist without a second browser audit or full revenue/operator verification. Preserve unknowns; GOOD is not verified strong fit, CONTACT_READY, or permission to contact.
- HUMAN_REVIEW (yellow): a specific material uncertainty could change pursue versus drop (e.g. fulfillment operator or consignment/PO compatibility). Seek only one targeted human review and record that question, owner and revisit date. Do not commission generic re-audits.
- DROP (red): observed reliable evidence establishes poor fit or out-of-scope capability. Retain brief non-personal reason and possible reactivation condition; do not infer an opt-out or legal suppression from commercial rejection.

If an underlying source method is not approved, hold that evidence; a good candidate label does not waive source rules. Keep brief source provenance, date, and explicit UNKNOWNs. The GTM lead owns the business selection decision. Triage is not a fourth authorization gate and does not replace the later G5 compliance, independent CONTACT_READY QA or separate outreach approval.

G4b — Hero-first contact preparation and language choice (GTM-CHG-006)

This section governs the ORDER of work after a merchant is retained under G4a. It is not an authorization to access new sources, collect personal data, call an account CONTACT_READY, or send a message.

1. Rank the retained merchant. Continue to enforce a concrete-RED-only commercial exclusion policy for the preparation shortlist; unknown contact details are a preparation HOLD, not a reason to DROP.
2. **Locate a real hero before drafting:** seek the named, currently employed owner/founder or accountable warehouse, ecommerce or operations decision-maker. Record the full name, company/role match, source link and observed date in the restricted GTM workspace ONLY. Generic title suggestions are not verified heroes. Before personal-data research, independently confirm a source-specific contact-research method, acceptable website/access terms, data-minimization, appropriate storage and privacy review; S02 merchant-discovery approvals alone do not permit named-person collection.
3. **Verify the business email before drafting:** require a source-attributed, legitimately published and role-relevant professional address for that identified person, with access/verification date and permitted-use classification. Never derive a pattern (e.g. first.last@domain), purchase lists, scrape, or harvest an individual address. If a hero or verified email cannot be established, set CONTACT_RESEARCH_HOLD and draft_state=NOT_STARTED; retain the merchant. Any generic company-address route needs an explicit recorded exception plus the applicable G5 review.
4. **Research the relevant opportunity:** record observed company facts separately from a testable hypothesis about LaSyncro's potential value. Select the most relevant discovery question about how the merchant currently picks, packs or receives supplier deliveries; do not assert they have a broken process without evidence.
5. **Choose language based on evidence:** record SV, EN or UNDECIDED and cited evidence. Prefer the person's voluntary public professional language when legitimately available; otherwise the merchant's established business/website language. A first name or surname is NEVER by itself evidence of language proficiency, preference, citizenship or origin. Where evidence remains inconclusive, default to the company's ordinary business communication language with the uncertainty noted.
6. **Draft only after the hero, verified business email, opportunity and language choice exist:** address that person, use one merchant-specific evidenced observation and an open discovery question. Do not mass-produce identical Swedish emails or promise unshipped functionality. A draft remains unsent.
7. **Independent checks and individual send:** G5 privacy/legal-basis/transparency/suppression review, independent G6 evidence QA, G7 CONTACT_READY promotion and explicit per-recipient dispatch approval remain unchanged. A published business address alone is not consent or legal permission to send marketing. Review suppression before any eventual send; no bulk campaigns, automatic follow-up or CRM mutation is implied.

Minimal private record fields: hero_full_name; hero_role; affiliation_evidence; hero_source_url; hero_verified_at; verified_business_email; email_source_url; email_verified_at; contact_source_approval_id; privacy_review_status; language_choice (SV|EN|UNDECIDED); language_evidence_url; language_reason; observed_fact; opportunity_hypothesis; discovery_question; draft_state (NOT_STARTED|WRITTEN|VERIFIED|APPROVED); send_state (NOT_AUTHORIZED|APPROVED_ONE_BY_ONE|SENT|STOPPED).

G5 — Contact-route and allowed-use review

- Apply G4b contact-first ordering: approved source and privacy checks before collecting named hero/business-email details, then verified identity/email, opportunity evidence and language selection BEFORE drafting. Until these are complete, no individualized draft or CONTACT_READY designation.
- Identify a public official company contact route or business role when legitimately available; avoid guessed, harvested or unverified individual emails.
- Check source terms, allowable data use, marketing/privacy review, existing CRM conflicts, suppression and no-contact records before calling an account contact-ready.
- Agents cannot decide that outreach is legally permitted merely because an address is public. Where checks are incomplete, mark COMPLIANCE_HOLD.
- Assign the most relevant, truthful problem hypothesis and a proposed first action. Actual messaging requires separately approved outreach scope/campaign and applicable legal checks.
- G5 Contact/Compliance Authorization: a record may become CONTACT_READY only when the charter records a g5_decision_id and a named compliance reviewer, and that decision documents the legal basis and transparency/notice approach for the contact type, confirms a suppression list exists and was checked, and limits the route to a company-level business channel unless the reviewer approves a role-based individual route. Without a G5 decision, every otherwise-qualified record is COMPLIANCE_HOLD. G0-B research authorization never implies G5.

G6 — Independent evidence QA

- Review 100% of records proposed as CONTACT_READY and 100% of material new contradictions. Verify source-to-claim support independently; reopen specific cited sources when needed for a decision-critical contact-readiness or contradictory claim. A preliminary GOOD_CANDIDATE does not require that browser QA to enter the preparation shortlist.
- Confirm independence of warehouse evidence; duplicate syndicated postings or repeated vendor claims are not independent corroboration.
- Validate canonical identity, plausible geography, claims about own fulfillment, source freshness, contact-route provenance, suppression status, and current product capability alignment.
- Sample non-ready records for false negatives when proportionate to available QA hours (20% remains an experimental target, not a prerequisite for GOOD shortlisting); record error types and correction rate. Tool inability to reopen a site is not by itself evidence of merchant misfit.
- Fail the individual record rather than inventing missing fields. Systemic invalid licensing, widespread false claims or contact/privacy violations cause a batch HOLD.
- Independent formal CONTACT_READY QA still requires a reviewer_id distinct from the researcher_id and, for agents, a separate session receiving citations rather than private researcher reasoning. Reopen approved decision-critical cited sources as needed to substantiate the formal check; disclose any unavailable source rather than calling it verified. This is not mandatory for initial GOOD triage.
- Hard stops (batch HOLD and SEV-1, no discretion): any use of an unapproved or expired source; any personal data outside the approved workspace or charter; any access that breaches source terms or access controls; any restricted partner, carrier or production data.
- Review triggers (provisional statistical thresholds; escalate to the lead for a human HOLD/continue decision, recorded as a blocker): at least 20% of audited records failing claim support; or two or more identity-merge errors. The lead may HOLD the batch; an agent may not dismiss the trigger.

G7 — Promotion to decision queue

GOOD_CANDIDATE from G4a enters only the outreach-PREPARATION shortlist. It is separate from the formal CONTACT_READY decision below; do not impose the latter on preliminary business selection.

A record is CONTACT_READY for human handoff only when all are true:

- Canonical merchant identity and Shopify-first evidence are supported.
- icp_fit = strong and warehouse_status = confirmed (strategy §5 A4: only Confirmed is ICP-fit assessment eligible). Probable is validation-only: EVIDENCE_HOLD with a named targeted validation step. Partial fit is EVIDENCE_HOLD unless the lead records an exception decision with reason.
- At least one credible problem/buying-trigger hypothesis that is not expired, or a well-documented qualifying research reason, exists (lack of a public trigger is not invented urgency).
- An appropriate business contact channel is recorded with provenance.
- G5 decision recorded; data-use review, suppression review, independent evidence QA and product-claims check are complete and marked PASS.
- All cited sources were APPROVED_FOR_RESEARCH and within their review-by date when accessed.
- There is a specific proposed next action, human owner, and review-by date.

CONTACT_READY does not mean outreach sent or authorized. If explicit outreach approval is absent, keep dispatch state NOT_AUTHORIZED.

Priority categories: P1 confirmed self-fulfillment + strong fit + credible trigger; P2 confirmed self-fulfillment + strong fit + fewer timing signals; probable operations are ranked within HOLD for validation, never as P1/P2; HOLD missing critical facts; EXCLUDE disconfirmed/out of scope. These are proposed operational labels, not immutable score thresholds.

5. Repeatable Asset B partner pipeline

B1. Discover agencies, Auto-ID/barcode and warehouse equipment vendors, packaging suppliers, logistics consultants, industry associations and complementary shipping platforms serving the ICP. Favor low competitive overlap.

B2. Validate actual merchant access, relevance, credibility, competitive risks, commercial incentives, decision-maker route, likely referral mechanism, and a realistic value exchange. A large customer count without ICP overlap has low priority.

B3. Define one partner-specific pilot offer, preferably warm, merchant-authorized referrals, a co-branded no-install Warehouse Health Check, or targeted merchant education. Do not ask for unrestricted client lists.

B4. Audit independently: verify company and claimed services, conflicts, source terms, reputational fit and plausible next meeting/contact route.

B5. Promote to PARTNER_CONTACT_READY only when all are true: verified legal entity and claimed services; ICP-overlap evidence from at least one independent source; competition_risk recorded and not high; one specific mutual-value offer; public business contact route with provenance; suppression check done; no partner customer data requested or held; independent reviewer PASS; owner and next-action date. PARTNER_CONTACT_READY is not approval to contact; contacting a partner requires a G5 decision.

B6. Handle approved introductions with documented merchant authorization, canonical matching, suppression, attribution conflict checks, human acceptance, and a recorded next step. Referral payments and terms require separate explicit approval.

B7. Measure introductions, qualified conversations, pilots, paid accounts, partner time/cost and retained revenue. A signed partnership with no qualified opportunities is not a productive channel.

6. Contact/follow-up state machine
State	Exact meaning	Owner action
RESEARCHING	Research unfinished	Investigate specified gaps
IDENTITY_HOLD	Canonical identity ambiguous or possible unmerged duplicate	Resolve with registration evidence; never merge silently
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

GOOD_CANDIDATE / HUMAN_REVIEW / DROP are commercial triage labels, not replacement formal contact states. A green merchant remains COMPLIANCE_HOLD as to contacting while G5 is blocked.

Partner states: RESEARCHING, EVIDENCE_HOLD, COMPLIANCE_HOLD, QA_HOLD and DISQUALIFIED apply as above; PARTNER_CONTACT_READY = passed B5, seek approval; contact and later partner stages follow strategy §6 B3.

Mapping to the strategy: strategy §5 A7 "Outreach eligible" and §8 stage 2 correspond to CONTACT_READY. Neither is authorization; authorization corresponds only to OUTREACH_APPROVED. Strategy A7 "Identity resolving" corresponds to IDENTITY_HOLD; "Candidate" corresponds to EVIDENCE_HOLD or COMPLIANCE_HOLD.

Every HOLD state requires hold_reason_code, missing_fact and revisit_at.

No CONTACTED without evidence that a contact occurred. No FOLLOW_UP_DUE if no outreach occurred. No PAID without verified commercial records. A follow-up date is a planned action, not an automation.

7. Minimum records and controlled storage

Keep two environments:

1. Repository: ratified strategy, approved operating workflow, redacted sprint reviews (docs/stratgies/gtm_sprints/<sprint-id>/review.md), the sanitized blocker register (docs/stratgies/gtm_sprints/blocker_register.md, §13.1), the GTM index, schemas, generic prompts, and change proposals only. No real individual contact addresses, private partner records, purchased datasets, raw source exports, access tokens or confidential merchant information.
2. Approved secure GTM workspace/CRM: source register, evidence, company/store/facility records, partner records, personal contacts when legitimately processed, suppression, outreach events, referral permission and actual follow-up queue. Access controlled, MFA, export restrictions and retention policy.

Recommended merchant record (fields may be stored in structured tables, not necessarily one file):

account_id, legal_entity_name, registration_number, brands[], storefront_domains[],
facility_refs[] (address or workplace ID; ownership evidenced|unknown),
region, fulfillment_status, fulfillment_evidence_ids, fulfillment_confidence,
icp_fit_status, revenue_band, warehouse_operators, estimated_daily_orders,
sku_complexity, operational_pain_hypothesis, buying_trigger_type,
trigger_evidence_ids, trigger_date, trigger_recheck_at, adoption_readiness,
key_unknowns, source_ids, evidence_last_checked_at, source_license_status,
contact_route_type, contact_route_source, contact_permission_status,
suppression_check, dedupe_check, product_scope_check, qa_status,
researcher_id, reviewer_id, queue_status, hold_reason_code, missing_fact,
revisit_at, priority_tier, recommended_message_angle, dispatch_state,
next_action, next_action_owner, next_action_date, last_contacted_at,
followup_due_at, originating_asset, assisted_asset, sprint_id

Pilot minimum: in a research-only sprint only these merchant fields are required:
account_id, legal_entity_name, registration_number, storefront_domains[],
icp_fit_status, fulfillment_status, buying_trigger_type, trigger_recheck_at,
adoption_readiness, evidence ids, queue_status, hold_reason_code,
missing_fact, revisit_at, next_action, next_action_owner,
next_action_date, qa_status, reviewer_id, sprint_id. Other fields stay null.

Required evidence observation:

evidence_id, account_id_or_partner_id, claim_field, observed_value,
observation_type (observed|inferred|merchant_confirmed), confidence,
source_id, exact_url_or_document_reference, accessed_at, event_date,
expires_at, source_independence_group, reliability_note,
license_permitted_use, researcher_id, reviewer_id, verified_at, status,
correction_history_reference

Required partner record:

partner_id, company_name, category, geography, icp_overlap_evidence,
competition_risk, offered_value, expected_referral_path,
public_contact_route, source_ids, permission_or_agreement_status,
partner_stage, qa_status, next_action, owner, next_action_date,
referrals_introduced, opportunities_generated, paid_merchants,
suppression_check, reviewer_id, hold_reason_code, missing_fact, revisit_at,
sprint_id

Required source register row (strategy §19.1):

source_id, name, official_url, access_method, terms_reference,
terms_status (VERIFIED|UNKNOWN|BLOCKED), permitted_use,
personal_data_allowed, cost, approval_status (CANDIDATE|
APPROVED_FOR_RESEARCH|SUSPENDED|BLOCKED), approved_by, approval_decision_id,
reviewed_at, review_by

Required suppression row (kept minimal and retained to prevent recontact):

suppression_id, org_number_or_domain, scope, reason, effective_at, source

Required decision row:

decision_id, gate (G0-A|G0-B|G5|exception|change), subject_ids,
decision (approve|hold|reject), scope, approver, decided_at, expires_at

Stable IDs are opaque: SRC-###, ACC-######, EVD-######, PRT-####, DEC-####, BLK-####.

Dates: ISO 8601; unknowns: explicit unknown/null, never zero as a proxy; IDs: canonical, stable, never based on mutable display names. No CSV field is permission to gather a particular kind of data.

8. Required sprint-end delivery package

A successful sprint produces these logical deliverables, kept in appropriate locations. Filenames are examples, not authorization for writing to any connected CRM:
Deliverable	Purpose	Handling
contact_ready.csv	Ranked new candidates; action owner/date, qualifying reasons, linked evidence IDs	Secure GTM workspace only
followups_due.csv	Previously contacted merchants with next authorized touch, prior interaction, next step/date	Secure GTM workspace only
outreach_preparation_shortlist.csv	GOOD/HUMAN_REVIEW/DROP with minimal sourced rationale and unknowns, NOT a contact list	Secure GTM workspace only
partner_queue.csv	Audited partner opportunities and next actions	Secure GTM workspace only
holds_and_exclusions.csv	Missing facts, duplicates, out-of-scope and suppressed counts/reasons	Secure GTM workspace only
evidence_register.*	Source IDs, claims, exact references, accessed/reviewed dates	Secure GTM workspace only
source_approvals.*	Source purpose, method, license, privacy, validity and owner	Controlled-access workspace
gtm_sprints/<sprint-id>/review.md	Sanitized aggregate results, QA, costs, blockers, decisions and next sprint parameters	Can be saved in repository after review
change_proposals.md	Explicit modifications suggested for strategy/SOP/rubric	Proposal only until approved

A contact-ready list is not a sending list. The GTM lead checks compliance and separately approves any dispatch. If no permitted channel or compliance review is available, report candidates in HOLD rather than force CONTACT_READY.

Required sprint-end scorecard

SPRINT_ID:
STRATEGY_PATH / VERSION / COMMIT / SHA256:
WORKFLOW_PATH / VERSION / COMMIT / SHA256:
G0A / G0B / G5 DECISION_IDS:
DATE_RANGE:
SCOPE_AND_ALLOWED_SOURCES:
RESEARCHED_NEW_UNIQUE:
GOOD_CANDIDATE / HUMAN_REVIEW / DROP: # pre-contact decisions, never contact authorization
DUPLICATES_REMOVED:
WAREHOUSE_CONFIRMED:
WAREHOUSE_PROBABLE:
WAREHOUSE_UNKNOWN:
WAREHOUSE_DISCONFIRMED:
NEW_CONTACT_READY:             # QA-passed and contact-use-reviewed
NEW_OUTREACH_APPROVED:         # separate explicit approval
ACTUALLY_CONTACTED:
FOLLOW_UP_DUE:
IDENTITY_HOLD / COMPLIANCE_HOLD / EVIDENCE_HOLD / QA_HOLD:
BLOCKERS_OPENED / FIXED / VERIFIED / CARRIED_OVER:   # §13 blocker register
REGRESSION_CHECKS_RUN / PASSED / FAILED:             # §14
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
0 (setup)	PREFLIGHT (§13.2): cold-start check, previous blockers, regression matrix, pinning, source review-by dates, owners, storage	G0-A then G0-B PASS or BLOCKED
1–3	Asset A + B discovery from allowed sources	G1 raw evidence and dedup queue
4–5	Identity and fulfillment verification; separate fit/trigger/readiness	G2–G4 classifications
6	Contact-route recording and G5 check; independent audit	G5–G6 PASS/HOLD per record
7	Build ranked queues, review active follow-ups and partner offers	G7 handoff pack
8	GTM lead evaluates audit, targets, legal gates and any outreach proposal	Human signoff or HOLD
9–10	DIAGNOSE/CORRECT/VERIFY/CLOSE (§13): finalize secure lists, redacted sprint report, blocker register, carryover and change proposals	Sprint close + next decision

A research-only sprint may close after Day 8 by combining Days 8–10; GTM-01 S01 uses 8 working days (§2.1).

If the sprint is research-only, the outreach, response and conversation numbers remain zero/unattempted rather than being treated as failures. Commercial-action targets only activate after separate approval.

Work in progress and stop rules

- Do not repeatedly research the same company once a canonical account and current valid evidence exist; instead refresh fields due for review.
- Suspend sources with invalid/unclear permitted use, systemic inaccurate warehouse signals, or unjustified cost.
- If source accuracy is weak, modify hypothesis and source selection through approval, not quota or classification rigor.
- If demand requires unsupported product features, park the opportunity and report the gap rather than promising unbuilt functionality.
- Carry unresolved accounts forward with owner, missing fact, revisit condition/date; never silently drop them or automatically recycle an opt-out.

10. Change control and continuity

Authority order: platform/security/legal constraints → current engineering/agent workflow for repo work → docs/stratgies/GTM_strategy_v1.0.md for GTM principles → approved sprint workflow for execution → current sprint charter for bounded targets and permissions.

- At every sprint start: read the strategy and workflow from the pinned commit (git show <commit>:<path>) and record, for both documents, commit SHA + path + version + SHA-256 in the sprint charter and report. Untracked or working-tree copies are not authoritative. A hash mismatch with the charter is BLOCKED.
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
  2. the workflow version marked approved in docs/stratgies/GTM_INDEX.md
  3. separately provided engineering/agent directives for repo access

FIRST: Verify both GTM documents exist at the charter's pinned commit; read
them completely. Report both versions and SHA-256 values, current git
branch/status, the G0-B decision ID, work scope and source approvals.
If either is inaccessible, a hash mismatches, G0-B is absent, or a source
is not APPROVED_FOR_RESEARCH within its review-by date, STOP as BLOCKED.

SCOPE: Research at most 15 new unique Shopify-first merchant accounts in
approved Swedish geography via approved sources and methods only. Reuse
canonical records, identify warehouse evidence, separate ICP fit / triggers /
readiness / confidence, and preserve source links and observation timestamps.

DO NOT: scrape prohibited sources, use production Shopify/warehouse data,
request or store private carrier manifests, invent revenue/order volume,
collect nonessential personal data, contact anyone, write live CRM records,
change product code, modify ratified docs, commit/push/deploy or purchase tools.

OUTPUT: unique candidates, GOOD/HUMAN_REVIEW/DROP triage with brief rationale,
deduplication, evidence references and candid confidence/unknowns; focused
human review only for material uncertainty. Independent QA still required for
any later CONTACT_READY submission; keep personal data out of Git.
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
SAMPLE: 100% of proposed CONTACT_READY and material contradictions; a
proportionate non-ready sample (20% experimental, not a GOOD gate).
No repeat browser QA required merely to label an initial merchant GOOD.
DO NOT: promote weak evidence, infer legal permission, contact anyone,
read production data, or modify strategy or product code.
OUTPUT: PASS/HOLD per record, exact corrections, systemic batch HOLD issues,
audit counts and source links; no automatic outreach approval.

11.3 Queue compiler — research sprint close

RUN_ID: GTM-01-S01-QUEUE-CLOSE
ROLE: Sprint queue compiler (NO EXTERNAL ACTION)
FIRST: Read ratified strategy, approved sprint SOP, current charter and
independent audit result. Do not treat a previous agent's claims as verified.
INPUT: GOOD pre-contact shortlist for preparation; only independent QA-passed
G5-authorized accounts for the CONTACT_READY queue; existing authorized contacts.
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

- [x] Confirm this SOP is approved as GTM-CHG-003 and prepared at docs/stratgies/GTM_sprint_workflow_v1.2.md; it becomes active only after publication and charter pinning in docs/stratgies/GTM_INDEX.md.
- [ ] Confirm the actual strategy path spelling (stratgies) and read exact repository files.
- [ ] Approve the first GTM-01 sprint charter (targets/region/source access/owner).
- [ ] Select a secure storage/CRM method and permitted source register; no default live CRM access.
- [ ] Approve any real-company data import/research method as applicable.
- [ ] Run bounded read-only research and three-way triage; reserve mandatory independent QA for formal CONTACT_READY promotion and material contradictions.
- [ ] Compile reviewed candidate and follow-up queues; obtain human outbound authorization if applicable.
- [ ] Close sprint with counts, source economics, evidence errors and change proposals.
- [ ] Use sprint learnings to calibrate the next sprint under explicit approval.
- [ ] Record G0-A, G0-B and (if any contact is intended) G5 decision IDs separately.
- [ ] Run the §14 regression matrix at PREFLIGHT and record results.

13. Continuous-improvement contract (mandatory every sprint)

Cycle: PREFLIGHT -> EXECUTE -> DETECT -> DIAGNOSE -> CORRECT -> VERIFY -> CLOSE. It uses the existing roles (§2.2); no new standing role, meeting or tool is created.

Every sprint must, without exception:
1. Review all previous unresolved blockers at kickoff (§13.2).
2. Capture each new blocker with a root cause and severity (§13.3–13.4).
3. Propose bounded corrections with a change category (§13.5).
4. Verify authorized fixes to VERIFIED, not merely FIXED (§13.6).
5. Carry unresolved dependencies and HOLD records forward (§13.2, §13.7).
6. Deliver three-way preliminary triage and independently audited CONTACT_READY queues where G5 permits (§4 G6–G7, §8).
7. Record exact document versions, commits, SHA-256 values and decision IDs (§3, §8, §10).

13.1 Persistent blocker register
- One sanitized register at docs/stratgies/gtm_sprints/blocker_register.md, persisting across sprints and programs; sprint reviews at docs/stratgies/gtm_sprints/<sprint-id>/review.md. Company names, contact details and record contents are excluded; reference opaque IDs only. Template in §15. Rows are never deleted; state changes are appended.
- Any agent or reviewer that stops, HOLDs a batch, or finds a rule gap opens a row. Individual record HOLDs are not blockers unless they share a systemic cause.

13.2 PREFLIGHT (Day 0, before G0-A)
- Cold-start validation: a fresh agent, given only the approved strategy, the approved workflow and the charter, verifies pinning, owners, storage, source review-by dates and decision IDs, and can state the run scope without any other context. Anything it cannot determine from those documents is a blocker (root cause DOC_GAP).
- Previous-sprint review: every register row not VERIFIED or CLOSED_WONTFIX is reviewed. Each is re-owned, re-dated, or escalated. G0-A cannot pass while any SEV-1 row is open.
- Carryover: unresolved HOLD records and dependencies from the previous sprint are listed with owner, missing fact and revisit_at; they are re-checked before new discovery and count toward the cohort cap only when re-researched.
- Run the §14 regression matrix against the current workflow and charter.

13.3 EXECUTE and DETECT
- Execute G1–G7 within the charter.
- Detect: gate failures, batch HOLDs, QA failures, source suspensions, and rule ambiguities are logged as blockers the same day.

13.4 DIAGNOSE: classifications
Root cause (one primary): SOURCE_PERMISSION, SOURCE_QUALITY, IDENTITY, EVIDENCE_RULE, COMPLIANCE, DATA_HANDLING, DOC_GAP, DOC_CONFLICT, APPROVAL_MISSING, CAPACITY, PRODUCT_FIT, TOOLING.
Severity:
- SEV-1: legal/privacy/licensing exposure, unapproved data or external action, or a rule that allows false promotion. Stop the affected batch; escalate to the lead the same day.
- SEV-2: blocks a gate or queue for the sprint. Owner and plan within one working day.
- SEV-3: degrades quality or effort. Track; fix at sprint end.

13.5 CORRECT: ownership, remediation and escalation
- Every blocker has one owner (GTM lead unless delegated), a remediation, and a due date.
- Escalation: SEV-1 immediately to the lead; SEV-2 overdue by two working days escalates to the lead; any blocker unresolved for two sprints is escalated for a stop/adjust decision (strategy §13.5).
Change categories and approval boundaries:
- C0 record correction (fix a record from its sources): reviewer may perform; logged.
- C1 charter parameter within workflow limits (dates, caps, source list from approved register): lead decision ID.
- C2 workflow rule, schema, threshold or gate change: §10 change control; GTM_CHANGE proposal (strategy §18.4); lead approval; version bump.
- C3 anything touching a ratified strategy principle, external-action permission, spend or new tooling: strategy change control; never in-sprint.
Agents may propose C1–C3 but never apply them.

13.6 VERIFY: FIXED vs VERIFIED
- FIXED: the remediation has been applied (record corrected, document change approved, source re-reviewed).
- VERIFIED: all of (a) an independent reviewer (not the fixer) re-ran the failing check or the relevant §14 regression case against the corrected state and it passed, with evidence referenced; and (b) a fresh cold-start PREFLIGHT (§13.2), run by a new agent session with only the approved documents and charter, passed with the fix in effect. Only VERIFIED closes a blocker. A C2/C3 fix is VERIFIED only after its effective version is approved, listed in GTM_INDEX.md and pinned in a charter.
- A synthetic §14 dry-run PASS is a simulated result and never counts as VERIFIED.

13.7 CLOSE
- docs/stratgies/gtm_sprints/<sprint-id>/review.md includes: blocker counts by severity/root cause/state, regression results, carryover list (by ID), and proposed changes with category.
- Approved C2 changes are appended to the revision log with effective sprint and GTM_INDEX.md is updated; the approved document becomes the authoritative workflow for subsequent sprints; prior versions remain in Git history and prior reports remain interpretable against their pinned version.
- Every new failure mode found in the sprint adds or updates a §14 regression case.

14. Workflow regression matrix (run at PREFLIGHT and after any C2 change)

Each case is a synthetic scenario checked against the written rules; no real merchant data is used. FAIL on any case blocks G0-A.

ID	Scenario (synthetic)	Expected outcome	Rule
R1	warehouse probable, icp strong, G5 present	EVIDENCE_HOLD; never CONTACT_READY	G7; strategy A4
R2	warehouse confirmed, icp strong, trigger valid, G5 present, QA PASS	CONTACT_READY; dispatch_state NOT_AUTHORIZED	G7; §6
R3	revenue/operators unknown, other criteria evidenced	icp partial or key_unknowns listed; never strong by default	G4
R4	new candidate shares org number or domain with an existing account	reuse account_id or IDENTITY_HOLD; no new account; no silent merge	G2
R5	evidence cites source with terms_status UNKNOWN or review_by passed	source not approved; record QA_HOLD; batch HOLD if used	G0; G6; G7
R6	only trigger is past trigger_recheck_at	trigger expired = none_known; may not support priority	G4; G7
R7	all evidence gates pass but no g5_decision_id	COMPLIANCE_HOLD	G5
R8	partner offers its customer list or carrier data	refuse; record nothing from it; SEV-1 if received	B3; B5; strategy B5/§11.2
R9	G0-B approved, outreach requested	not authorized; G5 and OUTREACH_APPROVED required	G0; G5; §6
R10	previous sprint has open SEV-1/SEV-2 blocker and HOLD records	SEV-1 blocks G0-A; SEV-2 re-owned; HOLDs carried with revisit_at	§13.2
R11	research-only sprint with no prior outreach	follow-up queue N/A; contact_ready_target 0	§2.1; §1
R12	charter hash differs from pinned document	BLOCKED	§10
R13	25% of audited records fail claim support; no privacy/licensing breach	review trigger: blocker opened, lead decides HOLD/continue; agent cannot dismiss	G6
R14	personal contact data found in a repository file	hard stop: batch HOLD, SEV-1, escalate same day	G6; §7; §13.4
R15	blocker marked FIXED; only synthetic dry-run passed	remains FIXED, not VERIFIED, until independent re-check and fresh cold-start PREFLIGHT	§13.6
R16	GTM_INDEX current-sprint charter pointer is missing, incorrect, points to a nonexistent file, or resolves to a charter with a mismatched sprint ID	BLOCKED; G0-A cannot pass. Open or update a DOC_GAP blocker. Do not assume a charter or invent its path.	G0; §13.1–13.2
R17	Shopify merchant has current own-warehouse statement and relevant products, but revenue/staff unknown	GOOD_CANDIDATE preparation shortlist; unknowns kept; no repeat browser QA; not CONTACT_READY	G4a; G7
R18	Fulfillment operator or consignment compatibility would change pursue/drop decision	HUMAN_REVIEW, one focused question/owner/date, not a blanket audit	G4a
R19	Reliable evidence of wholly outsourced fulfillment or unsupported specialty workflow	DROP with brief reason; no invented suppression	G4a
R20	GOOD_CANDIDATE while G5 is blocked and formal QA missing	Shortlisting allowed, CONTACT_READY and dispatch forbidden	G4a; G5–G7

15. Blocker register template (sanitized; no merchant/contact data)

blocker_id: BLK-0001
opened_at: YYYY-MM-DD
sprint_id: GTM-01-S01
run_id:
gate: G0-A|G0-B|G1|G2|G3|G4|G5|G6|G7|B1-B7|CLOSE
severity: SEV-1|SEV-2|SEV-3
root_cause: <one §13.4 code>
description: <rule-level description; opaque record IDs only>
affected_ids: []
owner:
remediation:
change_category: C0|C1|C2|C3
due_at:
escalated_at: null
state: OPEN|IN_PROGRESS|FIXED|VERIFIED|CARRIED_OVER|CLOSED_WONTFIX
fixed_evidence:
verified_by:
verified_evidence:      # regression case ID or re-run reference
carryover_count: 0
⸻
Revision and decision log
Date	Version	Change	Approval status
2026-10-26	1.0 draft	Proposed reusable two-week GTM sprint SOP anchored to ratified strategy; separated evidence QA, contact readiness, outreach authorization and sprint-end queues	PROPOSED — NOT YET RATIFIED
2026-10-26	1.1 (GTM-CHG-001)	G0-A/G0-B/G5 split; confirmed-only and strong-only promotion per strategy A4; positive-evidence strong ICP; trigger freshness; source review-by; independent QA definition and batch thresholds; IDENTITY_HOLD, PARTNER_CONTACT_READY and strategy state mapping; partner promotion criteria; source/suppression/decision schemas and pilot minimum; commit+SHA-256 pinning; two-sprint calendar mapping; continuous-improvement contract, regression matrix and blocker register (§13–15); hard stops vs review triggers; VERIFIED requires cold-start PREFLIGHT; durable locations under docs/stratgies/gtm_sprints/; GTM_INDEX.md entry point; saved as GTM_sprint_workflow_v1.1.md with v1.0 preserved. No strategy change.	APPROVED AND RATIFIED — effective GTM-01-S01
2026-10-26	1.2 (GTM-CHG-003)	Added R16 to block G0-A when the GTM_INDEX current-sprint charter pointer is missing, incorrect, nonexistent, or resolves to a mismatched sprint ID; requires a DOC_GAP blocker and forbids assuming or inventing a charter path. Preserves all v1.1 contracts and provisional limits. No strategy change.	APPROVED — effective GTM-01-S01 after publication and charter pinning

2026-10-27	1.3 (GTM-CHG-005)	Three-way pre-contact GOOD/HUMAN_REVIEW/DROP triage, proportional research, no extra browser QA for credible GOOD shortlisting; retains full G5–G7 contact gates, source controls and outbound approvals; R17–R20 added.	APPROVED — effective GTM-01-S01 after publication/index and charter pinning
