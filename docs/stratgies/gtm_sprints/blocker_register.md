# GTM Blocker Register

Sanitized and persistent (workflow v1.2 §13.1, §15). Opaque IDs only: no merchant names, contact details or record contents. Rows are never deleted; state changes are appended to the History table.

**Status:** ACTIVE. GTM-CHG-003 is approved for GTM-01-S01 but GTM-CHG-003 remediation approved; publication evidence and independent verification are required before VERIFIED. FIXED means remediation applied; VERIFIED additionally requires an independent check and a fresh cold-start PREFLIGHT (workflow §13.6). No row is VERIFIED. Approved changes: GTM-CHG-001, GTM-CHG-002, GTM-CHG-003. Setup decision: GTM-01-S01-SETUP-001.

## Open blockers

| ID | Opened | Sprint | Gate | Sev | Root cause | Description | Owner | Category | Due | State |
|---|---|---|---|---|---|---|---|---|---|---|
| BLK-0001 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | APPROVAL_MISSING | No approved sprint workflow; remediated by GTM-CHG-001 ratifying v1.1 | GTM lead (unassigned) | C2 | GTM-01-S01 G0-A cold start | FIXED |
| BLK-0002 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | APPROVAL_MISSING | GTM-01-S01-SETUP-001 names the lead and researcher and proposes restricted company Google Drive; the specific independent reviewer/session and exact secure workspace path/access verification remain pending | approving user, GTM lead | C1 | GTM-01-S01 G0-A | OPEN |
| BLK-0003 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | SOURCE_PERMISSION | No source APPROVED_FOR_RESEARCH; candidates SRC-001/SRC-003 proposed; SRC-002 and SRC-004 terms UNKNOWN | GTM lead (unassigned) | C1 | ASSIGN | OPEN |
| BLK-0004 | 2026-10-26 | GTM-01-S01 | G5 | SEV-3 | COMPLIANCE | No compliance reviewer or documented legal basis; blocks contact only (needed before S02 outreach) | GTM lead (unassigned) | C1 | ASSIGN | OPEN |
| BLK-0005 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | DOC_GAP | Sprint charter location undefined; a fresh agent could not discover the active charter from repo documents. Remediated by GTM-CHG-002 (index convention + GTM-01-S01 charter) | GTM lead (unassigned) | C2 | GTM-01-S01 G0-A cold start | FIXED |
| BLK-0006 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | DOC_GAP | F1: workflow v1.1 lacks an R16 regression for a missing, incorrect, nonexistent or sprint-mismatched current-charter pointer. GTM-CHG-003 remediation adds R16 in v1.2; publication and independent verification remain pending | approving user, GTM lead | C2 | After GTM-CHG-003 publication | IN_PROGRESS |
| BLK-0007 | 2026-10-26 | GTM-01-S01 | G0-A/G0-B | SEV-2 | DOC_CONFLICT | F2: charter labels missing mandatory G0-A/G0-B inputs HOLD although workflow §3 requires BLOCKED. GTM-CHG-003 remediation changes both gate statuses to BLOCKED; publication remains pending | approving user, GTM lead | C2 | After GTM-CHG-003 publication | IN_PROGRESS |
| BLK-0008 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | DOC_GAP | F3: the S01 charter does not pin the active GTM_INDEX path/version/SHA-256. GTM-CHG-003 remediation adds the prepared index pin; publication and subsequent commit pinning remain pending | approving user, GTM lead | C2 | After GTM-CHG-003 publication | IN_PROGRESS |

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
