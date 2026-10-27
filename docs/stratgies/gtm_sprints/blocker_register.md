# GTM Blocker Register

Sanitized and persistent (workflow v1.2 §13.1, §15). Opaque IDs only: no merchant names, contact details or record contents. Rows are never deleted; state changes are appended to the History table.

**Status:** ACTIVE. C2 workflow/index/charter remediation is published (b0ff019bfac5b51e72436ccdf4d112cba195f01e); the C1 charter reviewer, workspace and source-method record is published (1108d3d989ae011e23471ca1dfabb8b1da35d108). GTM-01-S01-BLOCKER-REVIEW-001 reviewed all eight legacy blockers, reassigned and dated them. FIXED is not VERIFIED: independent re-check and fresh cold-start PREFLIGHT under workflow §13.6 remain required. No blocker is VERIFIED. G0-A/G0-B remain BLOCKED.

## Open blockers

| ID | Opened | Sprint | Gate | Sev | Root cause | Description | Owner | Category | Due | State |
|---|---|---|---|---|---|---|---|---|---|---|
| BLK-0001 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | APPROVAL_MISSING | No approved sprint workflow; remediated by GTM-CHG-001 ratifying v1.1 | LaSyncro GTM lead | C2 | 2026-10-30 | FIXED |
| BLK-0002 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | APPROVAL_MISSING | GTM-01-S01-SETUP-001 names the lead and researcher and proposes restricted company Google Drive; the specific independent reviewer/session and exact secure workspace path/access verification remain pending | LaSyncro GTM lead | C1 | 2026-10-30 | IN_PROGRESS |
| BLK-0003 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | SOURCE_PERMISSION | No source APPROVED_FOR_RESEARCH; candidates SRC-001/SRC-003 proposed; SRC-002 and SRC-004 terms UNKNOWN | LaSyncro GTM lead | C1 | 2026-10-30 | FIXED |
| BLK-0004 | 2026-10-26 | GTM-01-S01 | G5 | SEV-3 | COMPLIANCE | No compliance reviewer or documented legal basis; blocks contact only (needed before S02 outreach) | LaSyncro GTM lead | C1 | 2026-11-13 | OPEN |
| BLK-0005 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | DOC_GAP | Sprint charter location undefined; a fresh agent could not discover the active charter from repo documents. Remediated by GTM-CHG-002 (index convention + GTM-01-S01 charter) | LaSyncro GTM lead | C2 | 2026-10-30 | FIXED |
| BLK-0006 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | DOC_GAP | F1: workflow v1.1 lacks an R16 regression for a missing, incorrect, nonexistent or sprint-mismatched current-charter pointer. GTM-CHG-003 remediation adds R16 in v1.2; publication and independent verification remain pending | LaSyncro GTM lead | C2 | 2026-10-30 | FIXED |
| BLK-0007 | 2026-10-26 | GTM-01-S01 | G0-A/G0-B | SEV-2 | DOC_CONFLICT | F2: charter labels missing mandatory G0-A/G0-B inputs HOLD although workflow §3 requires BLOCKED. GTM-CHG-003 remediation changes both gate statuses to BLOCKED; publication remains pending | LaSyncro GTM lead | C2 | 2026-10-30 | FIXED |
| BLK-0008 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | DOC_GAP | F3: the S01 charter does not pin the active GTM_INDEX path/version/SHA-256. GTM-CHG-003 remediation adds the prepared index pin; publication and subsequent commit pinning remain pending | LaSyncro GTM lead | C2 | 2026-10-30 | FIXED |

## History

| Date | ID | From | To | Evidence / reference |
|---|---|---|---|---|
| 2026-10-26 | BLK-0001…0004 | — | OPEN | GTM-01-S01-FOUNDATION-001; GTM-01-S01-G0-PREP-002 |
| 2026-10-26 | BLK-0001 | OPEN | FIXED | GTM-CHG-001 approved; workflow v1.1 published (GTM-CHG-001-PUBLISH-005). VERIFIED pending independent check + GTM-01-S01-G0A-COLDSTART |
| 2026-10-26 | BLK-0001 | FIXED | FIXED | GTM-01-S01-G0A-COLDSTART-001 ran in the author session, so it is not independent; status unchanged |
| 2026-10-26 | BLK-0005 | — | OPEN | Found by GTM-01-S01-G0A-COLDSTART-001 |
| 2026-10-26 | BLK-0005 | OPEN | FIXED | GTM-CHG-002 approved and implemented (GTM-CHG-002-IMPLEMENT-001). VERIFIED requires GTM-01-S01-G0A-COLDSTART-002: a new session, reviewer not the fixer, locates the charter from GTM_INDEX.md alone and passes the cold-start PREFLIGHT |
| 2026-10-26 | BLK-0002 | OPEN | OPEN | GTM-01-S01-SETUP-001 designated the lead and researcher, proposed restricted company Google Drive, and set planning caps of 12 research hours, 4 QA hours and zero budget. Exact workspace path/access verification and reviewer-session identity remain pending; no execution permission granted |
| 2026-10-26 | BLK-0006…0008 | — | IN_PROGRESS | F1–F3 recorded by GTM-CHG-003-IMPLEMENT-001. Approved remediation is prepared in the four-file patch; not FIXED or VERIFIED until corrected state is published, then independently re-checked under workflow §13.6 |

| 2026-10-27 | BLK-0001 | FIXED | FIXED | GTM-01-S01-BLOCKER-REVIEW-001; owner=LaSyncro GTM lead; due=2026-10-30; Workflow v1.2 published; old FIXED state retained. Independent verification required. |
| 2026-10-27 | BLK-0002 | OPEN | IN_PROGRESS | GTM-01-S01-BLOCKER-REVIEW-001; owner=LaSyncro GTM lead; due=2026-10-30; Reviewer QA-01, company Drive owner/location and retention owner published; MFA/access independent check still required. In progress, not verified. |
| 2026-10-27 | BLK-0003 | OPEN | FIXED | GTM-01-S01-BLOCKER-REVIEW-001; owner=LaSyncro GTM lead; due=2026-10-30; SCB SRC-002 and optional JobTech SRC-004 are 2/2 APPROVED_FOR_RESEARCH in restricted source register, both gated by G0-B. FIXED, not verified; SRC-003 site-specific terms remain unapproved. |
| 2026-10-27 | BLK-0004 | OPEN | OPEN | GTM-01-S01-BLOCKER-REVIEW-001; owner=LaSyncro GTM lead; due=2026-11-13; G5 contact/privacy/suppression requirements still OPEN and deferred to S02 before any outreach. Nonblocking for research-only S01. |
| 2026-10-27 | BLK-0005 | FIXED | FIXED | GTM-01-S01-BLOCKER-REVIEW-001; owner=LaSyncro GTM lead; due=2026-10-30; Charter discoverability convention published; FIXED not verified; independent cold start must locate it from GTM_INDEX.md. |
| 2026-10-27 | BLK-0006 | IN_PROGRESS | FIXED | GTM-01-S01-BLOCKER-REVIEW-001; owner=LaSyncro GTM lead; due=2026-10-30; R16 published in workflow v1.2; FIXED not verified; reviewer must test pointer missing/wrong/nonexistent/sprint mismatch. |
| 2026-10-27 | BLK-0007 | IN_PROGRESS | FIXED | GTM-01-S01-BLOCKER-REVIEW-001; owner=LaSyncro GTM lead; due=2026-10-30; G0-A and G0-B BLOCKED wording published; FIXED not verified; reviewer must rerun relevant regression. |
| 2026-10-27 | BLK-0008 | IN_PROGRESS | FIXED | GTM-01-S01-BLOCKER-REVIEW-001; owner=LaSyncro GTM lead; due=2026-10-30; Active index path/version/SHA-256 pinned in charter to C2 document baseline; FIXED not verified; reviewer must check SHA and provenance. |

**2026-10-27 lead blocker review.** The 2026-10-30 dates are the next G0-A verification checkpoints. BLK-0004 has a separate 2026-11-13 planning review date for pre-G5 work, not S01 outreach permission. These dates are internal checkpoints, not external deadlines. Only the distinct GTM-01-S01-QA-01 reviewer may provide independent verification evidence, followed by a new cold-start PREFLIGHT. G0-A/G0-B/G5 remain BLOCKED; no research authorized.

## Row template

```yaml
blocker_id: BLK-0000
opened_at: YYYY-MM-DD
sprint_id:
run_id:
gate: G0-A|G0-B|G1|G2|G3|G4|G5|G6|G7|B1-B7|CLOSE
severity: SEV-1|SEV-2|SEV-3
root_cause: SOURCE_PERMISSION|SOURCE_QUALITY|IDENTITY|EVIDENCE_RULE|COMPLIANCE|DATA_HANDLING|DOC_GAP|DOC_CONFLICT|APPROVAL_MISSING|CAPACITY|PRODUCT_FIT|TOOLING
description:            # rule-level; opaque IDs only
affected_ids: []
owner:
remediation:
change_category: C0|C1|C2|C3
due_at:
escalated_at: null
state: OPEN|IN_PROGRESS|FIXED|VERIFIED|CARRIED_OVER|CLOSED_WONTFIX
fixed_evidence:
verified_by:            # must differ from the fixer
verified_evidence:      # independent re-check + cold-start PREFLIGHT reference
carryover_count: 0
```
