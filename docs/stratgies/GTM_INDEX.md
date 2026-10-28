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
| GTM-01-S02 | `docs/stratgies/gtm_sprints/GTM-01-S02/charter.md` | RESEARCH_ONLY | LEAD-APPROVED; G0-A/B execution evidence pending charter preflight | FALSE (G5 BLOCKED) |

**Index status:** GTM-CHG-006 workflow v1.4 is approved and ratified by the GTM lead (2026-10-28), effective for S02 after charter/index pinning. S02 nationwide merchant research was lead-approved under GTM-01-S02-G0B-LEAD-001, but the versioned charter has not documented an independently verified G0-A/G0-B PASS; treat further gated execution as EVIDENCE_HOLD until verified, rather than inferring PASS from a lead decision or this index. Previously authorized bounded merchant-source methods remain subject to domain terms and quotas. The lead has additionally approved a narrowly scoped hero/business-email identification process (GTM-01-S02-CONTACT-METHOD-001), but contact-source terms and privacy/compliance review remain open; no personal contact-data research or sending is authorized by this index. G5 BLOCKED. S01 remains unchanged.

**Pinning rule:** this index records path, version and file SHA-256 only. Every sprint charter must additionally pin the actual Git commit SHA from which these files are read (workflow §3, §10). A charter without a commit pin fails G0-A.

## Approved documents

| Document | Path | Version | Status | SHA-256 |
|---|---|---|---|---|
| GTM strategy | `docs/stratgies/GTM_strategy_v1.0.md` | 1.0 | APPROVED AND RATIFIED (2026-10-26) | `2f2b4e98ff0f647479473c65cd6566f6f97e88a562e9d0ace7d3a4b507277bd7` |
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.4.md` | 1.4 | APPROVED AND RATIFIED; GTM-CHG-006 (S02, subject to charter pinning) | `f8f7824c1340f93b700a5b8024052f24a801d22e493b687badc92e936bdc03ad` |

Approval of the workflow does not itself pass G0-A or G0-B. Follow the current charter's separate gate decisions and `docs/stratgies/gtm_sprints/blocker_register.md`. BLK-0004 remains OPEN for G5; it does not automatically block company-level research, but independently verified source and sprint gates are still required.

## Historical and proposed documents (not authoritative)

| Document | Path | Version | Status |
|---|---|---|---|
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.3.md` | 1.3 | Prior approved version — retained unchanged; superseded by v1.4 |
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.2.md` | 1.2 | Prior approved version — retained unchanged; superseded by v1.3 |
| Sprint workflow | `docs/stratgies/GTM_sprint_workflow_v1.1.md` | 1.1 | Prior ratified version — retained unchanged; superseded by v1.2 |
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
| 2026-10-26 | GTM-CHG-003 | Add workflow v1.2 R16 current-sprint pointer regression; update index, S01 charter and blocker register | APPROVED; PUBLISHED |
| 2026-10-27 | GTM-CHG-004 | Reconcile index S01 status with lead-approved G0-B for `GTM-01-S01-RESEARCH-001`; research only; G5 remains BLOCKED; no strategy/workflow change | APPROVED; PUBLISHED |
| 2026-10-27 | GTM-CHG-005 | Fast GOOD/HUMAN_REVIEW/DROP preliminary triage; keep G5/G6 contact-readiness, independent QA and separate dispatch authorization | APPROVED; published as v1.3 after main merge |
| 2026-10-28 | GTM-01-S02-SETUP-001 | Lead directed new RESEARCH_ONLY Sweden-wide merchant sprint. Register S02 as SETUP-ONLY; G0-A/G0-B and website/source methods require new sprint-specific clearance. Prior S01 cohort untouched | LEAD DIRECTED; SETUP ONLY; RESEARCH NOT YET AUTHORIZED |

Updating this index is a C2 change (workflow §13.5): it requires a GTM lead decision ID and a revision-log entry.

| 2026-10-28 | GTM-01-S02-G0A-REVIEW-001 + GTM-01-S02-G0B-LEAD-001 | S02 limited nationwide research activated by explicit lead approval, subject to S02 charter's published gate and source-condition evidence; G5 blocked; S01 untouched | LEAD AUTHORIZED; VERIFY CHARTER PINS |
| 2026-10-28 | GTM-CHG-006 + GTM-01-S02-CONTACT-METHOD-001 | Ratify hero-first and verified-business-email-first preparation; evidence-based SV/EN choice; publish workflow v1.4 and pin S02 to it. Approve bounded *method intent* for manually identifying a hero through official team/company pages, clearly public professional materials and published business email routes, subject to separate source terms, privacy and execution review. Maintain G5/G6/G7 and per-send authorization. S01 unchanged. | LEAD RATIFIED; SOURCE/COMPLIANCE EXECUTION HOLD |
