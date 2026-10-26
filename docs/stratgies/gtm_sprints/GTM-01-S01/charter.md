# GTM-01-S01 Sprint Charter

Sanitized sprint charter (workflow v1.1 §3). No merchant names, contact details, prospect lists or source exports. Values marked `ASSIGN` or `PENDING` are not approvals, and agents must never fill them.

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
strategy:
  path: docs/stratgies/GTM_strategy_v1.0.md
  version: "1.0"
  sha256: 2f2b4e98ff0f647479473c65cd6566f6f97e88a562e9d0ace7d3a4b507277bd7
workflow:
  path: docs/stratgies/GTM_sprint_workflow_v1.1.md
  version: "1.1"
  sha256: aa016d00176238bd43dd42aaf2d276055b7b18ae8855d45746322ca580faf792
source_baseline_commit: d7fafc66e51e0ecbeccc6804576e2c4cef7aaa40   # baseline the charter was drafted from
execution_commit: PENDING   # recorded in the sprint execution record at G0-B, never self-referenced here

# Decisions
workflow_decision_id: GTM-CHG-001     # workflow v1.1 approved and ratified
charter_convention_decision_id: GTM-CHG-002
g0a_decision_id: PENDING
g0b_decision_id: PENDING
g5_decision_id: null                  # no contact authorization
previous_blocker_review: PENDING      # §13.2 kickoff review of BLK-0001..0005

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
research_hours_cap: PENDING           # proposal: 12 research hours + 4 QA hours
calendar: "S01 Day 0 = program Days 1–7; S01 Days 1–8 = program Days 8–15 (workflow §2.1)"
start_date: ASSIGN
end_date: ASSIGN

# Responsibilities
lead: ASSIGN
evidence_reviewer: ASSIGN             # must differ from researcher
compliance_reviewer: null             # required before any G5 decision
researcher: ASSIGN

# Sources (the register lives in the approved workspace; IDs only here)
approved_sources: PENDING
candidate_sources:
  - id: SRC-001
    name: Bolagsverket free high-value datasets
    proposed_method: manual lookup; legal persons only
    terms_status: UNKNOWN (licence name); commercial reuse stated on official page
    approval: PENDING
  - id: SRC-003
    name: Merchant's own public website
    proposed_method: manual human-paced viewing; no automation; no individual names
    terms_status: UNKNOWN (per site)
    approval: PENDING
  - id: SRC-002
    name: SCB company register API
    terms_status: UNKNOWN (terms shown at registration)
    approval: NOT PROPOSED
  - id: SRC-004
    name: JobTech JobSearch
    terms_status: UNKNOWN
    approval: NOT PROPOSED
approved_access_methods: PENDING
personal_data: NONE                   # company-level only in S01

# Storage
workspace_location: PENDING           # approved non-repository workspace (workflow §7)
sanitized_outputs:
  blocker_register: docs/stratgies/gtm_sprints/blocker_register.md
  sprint_review: docs/stratgies/gtm_sprints/GTM-01-S01/review.md

# Authorizations
research_authorized: false
outreach_authorized: false
live_crm_write_authorized: false
purchases_authorized: false
account_registration_authorized: false
```

## Gate status

| Gate | Status | Missing |
|---|---|---|
| G0-A Foundation | HOLD | g0a_decision_id; lead, evidence_reviewer, researcher; workspace_location; approved_sources; previous_blocker_review; BLK-0001 VERIFIED cold start |
| G0-B Research authorization | HOLD | G0-A PASS; g0b_decision_id; research_hours_cap; start_date and end_date; execution_commit |
| G5 Contact/compliance | BLOCKED by design | compliance_reviewer; legal basis; suppression list. Not required for S01 |

**Next gate:** GTM-01-S01-G0A-COLDSTART-002, run in a new session by a reviewer who is not the fixer.

## Unresolved blockers (see blocker register)

BLK-0001 (FIXED, not VERIFIED), BLK-0002 (OPEN), BLK-0003 (OPEN), BLK-0004 (OPEN, carried to S02), BLK-0005 (FIXED, not VERIFIED).

## Change control

Filling a `PENDING` or `ASSIGN` value requires a lead decision ID recorded in this charter. That is a C1 change (workflow §13.5). Changing caps beyond workflow limits, or the mode, is C2.
