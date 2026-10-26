# LaSyncro GTM Index

Stable entry point for GTM agents and operators. Read this file first, then read only the documents listed as **APPROVED** below, from the pinned commit (`git show <commit>:<path>`). Untracked or working-tree copies are not authoritative.

## Startup instruction

1. Read this index.
2. Read the approved strategy and the approved workflow listed below.
3. Load the current sprint charter from the path under **Current sprint**. The charter path always follows the convention `docs/stratgies/gtm_sprints/<sprint-id>/charter.md`.
4. Read `docs/stratgies/gtm_sprints/blocker_register.md`.
5. Classify every rule or value you rely on as one of:
   - **Published directive:** a rule in an approved document. It binds every sprint.
   - **Approved research permission:** a charter value carrying a lead decision ID.
   - **Pending decision:** any `ASSIGN`, `PENDING`, `FALSE` or `null` charter value. It permits nothing.
6. If the charter is missing, or a mandatory G0-A/G0-B input is pending, report the affected gate as BLOCKED. Do not start research.

## Current sprint

| Sprint | Charter | Mode | Research authorized | Outreach authorized |
|---|---|---|---|---|
| GTM-01-S01 | `docs/stratgies/gtm_sprints/GTM-01-S01/charter.md` | RESEARCH_ONLY | FALSE | FALSE |

**Index status:** GTM-CHG-003 APPROVED; this prepared revision becomes the published active index for GTM-01-S01 only after the four-file change is committed and available on remote `main`. Until then, the published baseline remains authoritative.

**Pinning rule:** this index records path, version and file SHA-256 only. Every sprint charter must additionally pin the actual Git commit SHA from which these files are read (workflow §3, §10). A charter without a commit pin fails G0-A.

## Approved documents

| Document | Path | Version | Status | SHA-256 |
|---|---|---|---|---|
| GTM strategy | `docs/stratgies/GTM_strategy_v1.0.md` | 1.0 | APPROVED AND RATIFIED (2026-10-26) | `2f2b4e98ff0f647479473c65cd6566f6f97e88a562e9d0ace7d3a4b507277bd7` |
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.2.md` | 1.2 | APPROVED; ACTIVE AFTER PUBLICATION (GTM-CHG-003; effective GTM-01-S01) | `99f2e8c2afd55674341719d09c4ff68e6d401310bf5d833d2e40ad6296ebf070` |

Approval of the workflow does not by itself pass G0-A or G0-B: the open blockers in `docs/stratgies/gtm_sprints/blocker_register.md` and the charter requirements in workflow §3 still apply.

## Historical and proposed documents (not authoritative)

| Document | Path | Version | Status |
|---|---|---|---|
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.1.md` | 1.1 | Prior ratified version — retained unchanged; superseded by v1.2 after publication |
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.0.md` | 1.0 | Historical — PROPOSED, never approved; superseded by v1.1 |

## Durable sanitized records

| Record | Path |
|---|---|
| Sprint charter | `docs/stratgies/gtm_sprints/<sprint-id>/charter.md` |
| Blocker register | `docs/stratgies/gtm_sprints/blocker_register.md` |
| Sprint review | `docs/stratgies/gtm_sprints/<sprint-id>/review.md` |

Repository files contain no merchant names, contact details, prospect lists, source exports or credentials. Those live only in the approved GTM workspace.

## Decision log

| Date | Decision ID | Change | Status |
|---|---|---|---|
| 2026-10-26 | — | Strategy v1.0 ratified | APPROVED |
| 2026-10-26 | GTM-CHG-001 | Ratify workflow v1.1, this index and the gtm_sprints locations; effective GTM-01-S01 | APPROVED AND RATIFIED |
| 2026-10-26 | GTM-CHG-002 | Charter discovery convention, current-sprint pointer and startup instruction; GTM-01-S01 charter created (draft, no permissions granted) | APPROVED |
| 2026-10-26 | GTM-CHG-003 | Add workflow v1.2 R16 current-sprint pointer regression; update the index, S01 charter and blocker register without changing strategy or granting execution permissions | APPROVED; PUBLICATION PENDING |

Updating this index is a C2 change (workflow §13.5): it requires a GTM lead decision ID and a revision-log entry.
