# GTM Blocker Register

Sanitized and persistent (workflow v1.1 §13.1, §15). Opaque IDs only: no merchant names, contact details or record contents. Rows are never deleted; state changes are appended to the History table.

**Status:** ACTIVE (GTM-CHG-001, effective GTM-01-S01). FIXED means remediation applied; VERIFIED additionally requires an independent check and a fresh cold-start PREFLIGHT (workflow §13.6). No row is VERIFIED.

## Open blockers

| ID | Opened | Sprint | Gate | Sev | Root cause | Description | Owner | Category | Due | State |
|---|---|---|---|---|---|---|---|---|---|---|
| BLK-0001 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | APPROVAL_MISSING | No approved sprint workflow; remediated by GTM-CHG-001 ratifying v1.1 | GTM lead (unassigned) | C2 | GTM-01-S01 G0-A cold start | FIXED |
| BLK-0002 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | APPROVAL_MISSING | GTM lead, evidence reviewer and non-repository workspace not designated | GTM lead (unassigned) | C1 | ASSIGN | OPEN |
| BLK-0003 | 2026-10-26 | GTM-01-S01 | G0-A | SEV-2 | SOURCE_PERMISSION | No source APPROVED_FOR_RESEARCH; candidates SRC-001/SRC-003 proposed; SRC-002 and SRC-004 terms UNKNOWN | GTM lead (unassigned) | C1 | ASSIGN | OPEN |
| BLK-0004 | 2026-10-26 | GTM-01-S01 | G5 | SEV-3 | COMPLIANCE | No compliance reviewer or documented legal basis; blocks contact only (needed before S02 outreach) | GTM lead (unassigned) | C1 | ASSIGN | OPEN |

## History

| Date | ID | From | To | Evidence / reference |
|---|---|---|---|---|
| 2026-10-26 | BLK-0001…0004 | — | OPEN | GTM-01-S01-FOUNDATION-001; GTM-01-S01-G0-PREP-002 |
| 2026-10-26 | BLK-0001 | OPEN | FIXED | GTM-CHG-001 approved; workflow v1.1 published (GTM-CHG-001-PUBLISH-005). VERIFIED pending independent check + GTM-01-S01-G0A-COLDSTART |

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
