# GTM-01-S01 Sprint Charter

Sanitized sprint charter (workflow v1.2 §3). No merchant names, contact details, prospect lists or source exports. Values marked `ASSIGN` or `PENDING` are not approvals, and agents must never fill them.

**Charter status:** DRAFT. G0-A and G0-B have not passed. Research authorization is FALSE and outreach authorization is FALSE.

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
g0a_decision_id: PENDING
g0b_decision_id: PENDING
g5_decision_id: null                  # no contact authorization
previous_blocker_review: GTM-01-S01-BLOCKER-REVIEW-001  # published 2026-10-27; verified evidence still pending

# Scope
geography: [Gothenburg, Borås, Helsingborg]
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
    scope: AB-level filtered queries, Gothenburg/Borås/Helsingborg; company-only fields
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

## Gate status

| Gate | Status | Missing |
|---|---|---|
| G0-A Foundation | BLOCKED | Source methods 2/2 and previous-blocker review published/linked. Independent documentary and R1–R16 synthetic checks passed under GTM-01-S01-G0A-INDEPENDENT-001, but full cold-start remains BLOCKED: account-linked MFA/export controls need evidence; renewed independent preflight and lead g0a_decision_id remain pending. |
| G0-B Research authorization | BLOCKED | G0-A PASS; g0b_decision_id naming this RUN_ID, cohort cap, dates and approved sources/methods; start_date and end_date; published execution_commit |
| G5 Contact/compliance | BLOCKED by design | compliance_reviewer; legal basis; suppression list. Not required for S01 |

**Next prerequisites:** verify company-account MFA and appropriate export controls, then conduct fresh independent G0-A cold-start and targeted blocker re-check. SRC-003 remains unapproved for merchant-site research (site-specific permission required before use); SRC-001 remains pending. Source minimum 2/2 does not authorize execution.

## Unresolved blockers (see blocker register)

BLK-0001 (FIXED), BLK-0002 (IN_PROGRESS: security evidence outstanding), BLK-0003 (FIXED), BLK-0004 (OPEN: G5/S02, nonblocking for research-only), BLK-0005–BLK-0008 (FIXED). None is VERIFIED pending fresh independent cold-start; see GTM-01-S01-BLOCKER-REVIEW-001.

## Change control

Filling a `PENDING` or `ASSIGN` value requires a lead decision ID recorded in this charter. That is a C1 change (workflow §13.5). Changing caps beyond workflow limits, or the mode, is C2.
