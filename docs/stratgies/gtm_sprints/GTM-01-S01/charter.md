# GTM-01-S01 Sprint Charter

Sanitized sprint charter (workflow v1.2 §3). No merchant names, contact details, prospect lists or source exports. Values marked `ASSIGN` or `PENDING` are not approvals, and agents must never fill them.

**Charter status:** G0-A FOUNDATION PASS under GTM-01-S01-G0A-LEAD-001; G0-B RESEARCH AUTHORIZATION BLOCKED. Research authorization is FALSE and outreach authorization is FALSE.

## How to read this charter

- **Published directive:** a rule in an approved document listed in `docs/stratgies/GTM_INDEX.md`. It binds every sprint.
- **Approved research permission:** a value below that carries a lead decision ID. Only these permit action.
- **Pending decision:** any `ASSIGN`, `PENDING`, `FALSE` or `null` value. It permits nothing.

## Charter

```yaml
sprint_id: GTM-01-S01
program: GTM-01
mode: RESEARCH_ONLY            # RESEARCH_AND_CONTACT requires G5 PASS

# Active documents (from GTM_INDEX.md)
index:
  path: docs/stratgies/GTM_INDEX.md
  version: "GTM-CHG-003 (published in a5363140497f96b91c1096c9e40b56e4878d8506)"
  sha256: 705974f9e2e41f405a2e48f43d9b3c50ece7fbc9fc4d252d305b93c9baa36a45
strategy:
  path: docs/stratgies/GTM_strategy_v1.0.md
  version: "1.0"
  sha256: 2f2b4e98ff0f647479473c65cd6566f6f97e88a562e9d0ace7d3a4b507277bd7
workflow:
  path: docs/stratgies/GTM_sprint_workflow_v1.2.md
  version: "1.2"
  sha256: 99f2e8c2afd55674341719d09c4ff68e6d401310bf5d833d2e40ad6296ebf070
source_baseline_commit: d7fafc66e51e0ecbeccc6804576e2c4cef7aaa40   # baseline the charter was drafted from
document_baseline_commit: a5363140497f96b91c1096c9e40b56e4878d8506  # Published workflow/index baseline
execution_commit: PENDING   # recorded in the sprint execution record at G0-B, never self-referenced here

# Decisions
workflow_decision_id: GTM-CHG-003     # workflow v1.2 approved; effective after publication and charter pinning
charter_convention_decision_id: GTM-CHG-002
setup_decision_id: GTM-01-S01-SETUP-001
reviewer_designation_decision_id: GTM-01-S01-REVIEWER-DESIGNATE-001
c1_record_decision_id: GTM-01-S01-C1-RECORD-001  # lead-approved setup recording, not gate authorization
g0a_decision_id: GTM-01-S01-G0A-LEAD-001  # 2026-10-27; conditional lead approval + QA-01 final cold-start PASS
g0b_decision_id: PENDING
g5_decision_id: null                  # no contact authorization
previous_blocker_review: GTM-01-S01-BLOCKER-REVIEW-001  # published 2026-10-27; verified evidence still pending

# Scope
geography_decision_id: GTM-01-S01-GEO-REV-001  # lead ratified 2026-10-27; only S01 pilot territory
geography: [Stockholm County (all 26 municipalities), Uppsala, Västerås, Eskilstuna, Enköping, Strängnäs, Håbo]
geography_extended_selective: [Örebro, Norrköping, Linköping, Gävle]  # when merchant fit justifies travel
geography_sample_guidance: "~8–10 Greater Stockholm, ~3–5 core Mälardalen, ~0–2 extended; not quotas; total <=15"
geography_scope_rule: "Stockholm-based visit access and ICP evidence outrank population; warehouse site may differ from company office; visits not mandatory in research-only S01"
segment: Shopify-first, self-fulfilling SMB (strategy §3.1 core ICP)
core_icp:
  revenue: "~USD 500K–10M"
  warehouse_operators: "2–10"
  orders_per_day: "~20–200"
research_target: 15                   # max new unique merchant accounts
self_fulfillment_candidate_target: 5  # experimental; confirmed + probable
contact_ready_target: 0               # 0 until G5 PASS
followup_queue: N/A                   # no authorized outreach exists
partner_review_target: 2              # max; review only
budget_cap: 0
research_hours_cap: 12                # planning cap approved by GTM-01-S01-SETUP-001; not research authorization
qa_hours_cap: 4                       # planning cap approved by GTM-01-S01-SETUP-001; not research authorization
calendar: "S01 Day 0 = program Days 1–7; S01 Days 1–8 = program Days 8–15 (workflow §2.1)"
start_date: ASSIGN
end_date: ASSIGN

# Responsibilities
lead: approving user, GTM lead
evidence_reviewer: GTM-01-S01-QA-01   # lead-designated distinct reviewer agent session; not a second human
compliance_reviewer: null             # required before any G5 decision
researcher: dedicated GTM research agent
researcher_id: GTM-01-S01-RESEARCH-01 # reserved; no research authorized
retention_review_deletion_owner: GTM lead  # dates assigned after actual sprint close

# Sources (approved METHOD IDs only; research execution still blocked by G0-B)
source_charter_decision_id: GTM-01-S01-SOURCES-CHARTER-001  # lead-approved C1 alignment on 2026-10-27
source_register: GTM-01-S01 restricted company Drive / Research Source Permissions Register
approved_sources:
  - SRC-002        # SCB; primary structured AB discovery
  - SRC-004        # JobTech; OPTIONAL corroboration, no hiring-based quota
approved_access_methods:
  - id: SRC-002
    provider: SCB Allmänna företagsregister, current free API
    permission_id: GTM-01-S01-SRC002-PERM-001
    terms_clearance_id: GTM-01-S01-SRC002-TERMS-CLEAR-001
    scope: bounded AB-level filtered queries, Stockholm County and named Mälardalen pilot municipalities, selective outer cities; company-only fields
    geography_extension_id: GTM-01-S01-SRC002-GEO-EXT-001
    terms_status: APPROVED_FOR_RESEARCH
    cost_sek: 0
    review_by: 2027-01-25
    execution: NOT_AUTHORIZED_UNTIL_G0_B
  - id: SRC-004
    provider: Arbetsförmedlingen JobTech JobSearch
    permission_id: GTM-01-S01-SRC004-PERM-001
    scope: at most 3 optional candidate-specific lookups, no negative signal from absent ads
    terms_status: APPROVED_FOR_RESEARCH
    cost_sek: 0
    review_by: 2027-01-25
    execution: NOT_AUTHORIZED_UNTIL_G0_B
candidate_sources:
  - id: SRC-003
    role: primary merchant-domain Shopify and self-fulfillment verification
    status: NOT_APPROVED_FOR_RESEARCH  # requires reviewed domain-specific method/terms
  - id: SRC-001
    role: supporting Bolagsverket legal-entity verification
    status: NOT_APPROVED_FOR_RESEARCH  # exact method pending approval
personal_data: NONE  # company-level only; no named contacts or raw responses

# Storage
workspace_proposal: restricted company Google Drive
workspace_location: "https://drive.google.com/drive/folders/1tLruW0KvPOKB7kSPTnRH5dx4pBn93bUa"  # verified folder; not research permission
workspace_owner: "milad.arbabi@lasyncro.com"
workspace_access_evidence: "restricted owner-only Google Drive; QA-01 read access via owner account (read-only by conduct, not ACL)"
sanitized_outputs:
  blocker_register: docs/stratgies/gtm_sprints/blocker_register.md
  sprint_review: docs/stratgies/gtm_sprints/GTM-01-S01/review.md

# Authorizations
research_authorized: false
outreach_authorized: false
live_crm_write_authorized: false
purchases_authorized: false
account_registration_authorized: false
data_import_authorized: false
```

## Setup decision record

`GTM-01-S01-SETUP-001` records only the named roles, proposed workspace type, planning-hour caps and zero budget above. It does not pass G0-A or G0-B and does not authorize research execution, source use or access, contact/outreach, CRM writes/imports, purchases or account registration. The GTM lead designated `GTM-01-S01-QA-01` in decision `GTM-01-S01-REVIEWER-DESIGNATE-001` and assigned the GTM lead as retention review/deletion owner under `GTM-01-S01-C1-RECORD-001`. One person can coordinate or operate every sprint role; separate people, computers and Google accounts are not prerequisites. Research and independent QA remain distinct passes (separate agent sessions when using agents). This recording does not authorize research, source use, outreach or any gate.

## S01 geographical decision

`GTM-01-S01-GEO-REV-001` (GTM lead ratification, 2026-10-27) supersedes the earlier Gothenburg/Borås/Helsingborg sampling assumption **for GTM-01-S01 only**. The underlying Sweden-first strategy, ICP, source legality, G0-A PASS and research caps remain unchanged. Prioritize Greater Stockholm and nearby Mälardalen for potential future warehouse visits; cities and population are research sampling inputs, not qualification evidence or visit obligations. Source-method geographic clearance for SRC-002 is recorded in restricted Drive as `GTM-01-S01-SRC002-GEO-EXT-001`. Merchant-site SRC-003 remains method/domain-specific pending. No G0-B execution, G5 outreach, contact collection or API credential use is authorized by this geographical decision.

## G0-A foundation decision

GTM lead decision: `GTM-01-S01-G0A-LEAD-001` (2026-10-27), ratified against the lead's prior explicit approval to proceed contingent on the final QA recommendation. Fresh independent reviewer pass `GTM-01-S01-G0A-FINAL-002` at `dc21bdfc764e928be93585869b81d00ca90f38ae` returned PASS; no second human reviewer is required. MFA and data-location/export controls are documented lead attestations in the restricted company Drive (not independently inspected admin controls). Previous-blocker review `GTM-01-S01-BLOCKER-REVIEW-001` has been linked. Seven previously blocking rows are VERIFIED in the published blocker register; G5-only BLK-0004 remains OPEN. **Foundation PASS does not authorize research or outreach.**

## Gate status

| Gate | Status | Missing |
|---|---|---|
| G0-A Foundation | PASS | GTM-01-S01-G0A-LEAD-001; final QA-01 cold-start GTM-01-S01-G0A-FINAL-002 PASS; seven blockers VERIFIED. MFA and restricted export handling confirmed by lead attestation, not independently inspected UI. BLK-0004 remains OPEN, G5 only. |
| G0-B Research authorization | BLOCKED | G0-A PASS; g0b_decision_id naming this RUN_ID, cohort cap, dates and approved sources/methods; start_date and end_date; published execution_commit |
| G5 Contact/compliance | BLOCKED by design | compliance_reviewer; legal basis; suppression list. Not required for S01 |

**Next prerequisite:** specific G0-B research authorization with RUN_ID, dates, 15-merchant cap, 12 research hours, approved source methods and execution commit. SRC-003 merchant-site verification remains method/domain-specific pending; SRC-001 Bolagsverket pending. No execution until G0-B.

## Unresolved blockers (see blocker register)

BLK-0001–BLK-0003 and BLK-0005–BLK-0008 VERIFIED after GTM-01-S01-G0A-FINAL-002; BLK-0004 OPEN (G5/S02, nonblocking for research-only). Tracked history: GTM-01-S01-G0A-REGISTER-VERIFIED-001.

## Change control

Filling a `PENDING` or `ASSIGN` value requires a lead decision ID recorded in this charter. That is a C1 change (workflow §13.5). Changing caps beyond workflow limits, or the mode, is C2.
