# LaSyncro GTM Index

Stable entry point for GTM agents and operators. Read this file first, then read only the documents listed as **APPROVED** below, from the pinned commit (`git show <commit>:<path>`). Untracked or working-tree copies are not authoritative.

**Index status:** APPROVED (GTM-CHG-001), effective from GTM-01-S01.

**Pinning rule:** this index records path, version and file SHA-256 only. Every sprint charter must additionally pin the actual Git commit SHA from which these files are read (workflow §3, §10). A charter without a commit pin fails G0-A.

## Approved documents

| Document | Path | Version | Status | SHA-256 |
|---|---|---|---|---|
| GTM strategy | `docs/stratgies/GTM_strategy_v1.0.md` | 1.0 | APPROVED AND RATIFIED (2026-10-26) | `2f2b4e98ff0f647479473c65cd6566f6f97e88a562e9d0ace7d3a4b507277bd7` |
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.1.md` | 1.1 | APPROVED AND ACTIVE (GTM-CHG-001; effective GTM-01-S01) | `aa016d00176238bd43dd42aaf2d276055b7b18ae8855d45746322ca580faf792` |

Approval of the workflow does not by itself pass G0-A or G0-B: the open blockers in `docs/stratgies/gtm_sprints/blocker_register.md` and the charter requirements in workflow §3 still apply.

## Historical and proposed documents (not authoritative)

| Document | Path | Version | Status |
|---|---|---|---|
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.0.md` | 1.0 | Historical — PROPOSED, never approved; superseded by v1.1 |

## Durable sanitized records

| Record | Path |
|---|---|
| Blocker register | `docs/stratgies/gtm_sprints/blocker_register.md` |
| Sprint review | `docs/stratgies/gtm_sprints/<sprint-id>/review.md` |

Repository files contain no merchant names, contact details, prospect lists, source exports or credentials. Those live only in the approved GTM workspace.

## Decision log

| Date | Decision ID | Change | Status |
|---|---|---|---|
| 2026-10-26 | — | Strategy v1.0 ratified | APPROVED |
| 2026-10-26 | GTM-CHG-001 | Ratify workflow v1.1, this index and the gtm_sprints locations; effective GTM-01-S01 | APPROVED AND RATIFIED |

Updating this index is a C2 change (workflow §13.5): it requires a GTM lead decision ID and a revision-log entry.
