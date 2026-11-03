# ENGINEERING WORKFLOW v5.0

- Mode: solo-developer, main-first execution
- Status: OWNER-APPROVED CHANGES 2026-11-03 (SF-ENGINEERING-WORKFLOW-V5-001); ratified on owner diff review
- Supersedes: v4.1 (ratified 2026-11-02), which superseded v3.6 and the local v3.7 revision
- v5.0 changes: seven-stage lifecycle (LIFECYCLE-01), simplification rules (SIMPLIFY-01), two-column roadmap (REPORT-02), issue-scope ship delegation (SHIP-DELEGATION-01), release-before-close housekeeping (CLOSE-01)
- Repository: SynchroFlow
- Companion: `docs/agent_directives/agent_operation_guidelines.md` (agent execution contract)
- Operating principle: strongest evidence with the least coordination overhead

## 0. Conventions

- **MUST** — mandatory; violation invalidates the affected evidence or action.
- **MUST NOT** — prohibited.
- **SHOULD** — default; deviation requires a stated reason.
- **MAY** — permitted, not required.
- **STOP** — halt the affected action, preserve state and report; continuing requires a lead or owner decision.
- Rule identifiers (`XXX-NN`) are stable. Each rule is defined once; other text references it by ID.
- This document governs. The agent guidelines apply these rules to agent execution and MUST NOT contradict them; on conflict, this document wins and the conflict is reported.
- Rules apply prospectively. Existing certification stays valid where EVIDENCE-REUSE-01 is satisfied; a documentation-only change never restarts certified implementation or PostgreSQL verification.

## 1. Authority, roles and decision ownership

### ROLE-01 — Owner (Milad)

Milad is the decision maker and code approver. Milad:

- approves issue scope, workshop outcomes, architecture and material UX decisions (including wireframes);
- approves HIGH-risk certification and movement to the next issue (REPEAT);
- explicitly authorizes every production deployment and production migration;
- restricts agent use and concurrent worktrees; those restrictions bind every lead and agent;
- performs or supervises live browser verification by default;
- owns staging, commit, push and deployment; only staging/commit/push MAY be delegated, and only under SHIP-DELEGATION-01;
- MAY run any terminal command, and MAY delegate bounded command, verification and documentation execution within explicit permissions.

### ROLE-02 — Engineering lead (ChatGPT or Claude reasoning role)

The lead owns: issue framing; audit strategy; architecture, product and UX reasoning; implementation scope; acceptance criteria; risk tier; test strategy, test-layer and neighbour selection; regression contract; judging evidence; deciding whether another audit, workshop or review is needed; phase transitions; certification recommendations; and writing exact commands and briefs.

The lead MUST NOT invent command results, treat intended behaviour as observed, claim a guarantee stronger than the evidence, or silently expand scope.

### ROLE-03 — Execution agent

The agent executes one bounded brief. It does not decide architecture, UX, business behaviour, scope, test strategy, risk tier, remediation direction or phase transitions. Its execution contract is `agent_operation_guidelines.md`.

### ROLE-04 — Decision boundary

- A passing test, a GREEN report or a RUN_ID never authorizes commit, push, deployment, a phase transition or the next issue.
- Owner execution of a command does not transfer owner decisions to the executor.
- When a decision belongs to the lead or owner and is unresolved, the executor STOPs.

## 2. Non-negotiable safety invariants

These invariants apply at every risk tier and are never relaxed by evidence reuse, delegation, gate economy or deadline pressure. Reuse changes the route to a proof, never the proof required.

- **SAFE-01 Tenant isolation and authorization.** Never bypass tenant context, RLS, authorization or entitlement checks. Application behaviour runs as the restricted application role (`sf_app`, non-superuser, no `BYPASSRLS`). Never disable RLS or guards globally, and never use migration-role access for behaviour expected to run as the application role.
- **SAFE-02 Inventory and financial truth.** `inventory_movements` is append-only: compensate, never UPDATE or DELETE. Never mutate primary business data without explicit authorization of the exact mutation. Inventory, billing and money effects require post-state proof (VERIFY-03).
- **SAFE-03 Transactions and concurrency.** Never claim atomicity, idempotency, replay, retry, exactly-once or concurrency safety unless the guaranteeing mechanism is identified and tested (TEST-07). Concurrency proof preserves real overlap.
- **SAFE-04 Migrations.** Migration history is never rewritten. Migration proof follows VERIFY-04. Production migrations are owner-controlled and never delegated.
- **SAFE-05 Disposable integration databases.** The normal development database is never an automated integration scratchpad. Integration runs use the canonical disposable harness (TEST-10) with separated migration and runtime roles and proven cleanup.
- **SAFE-06 External side effects.** Without explicit authorization, never charge Stripe, create Stripe/Shopify billing events, mutate production Shopify stores, send real email/push/Slack messages, register real webhooks or trigger external fulfillment. Never call a live provider merely to prove an internal state-machine contract.
- **SAFE-07 Secrets.** Never print, log or persist secrets, connection URLs with credentials, or plaintext tokens.
- **SAFE-08 WIP ownership.** Never clean, reset, stash, checkout, restore, overwrite or delete unrelated tracked or untracked work. A dirty worktree is not a defect. PARALLEL-OWNERSHIP-01 applies.
- **SAFE-09 Test integrity.** Never weaken, skip, delete or comment out assertions; use `.skip`/`.only`; mark failures expected; add retries or arbitrary timeouts to hide instability; update snapshots or golden files because they differ; swallow errors; mock the code under test; or manufacture RED by reverting verified behaviour.
- **SAFE-10 Evidence honesty.** Never invent results, approvals, provenance, artifacts or completed verification. Unpersisted evidence is reported as `EVIDENCE_NOT_PERSISTED`.
- **SAFE-11 Ship control.** Explicit-path staging only; never `git add -A` or `git add .`; no force push; push proof per SHIP-04; deployment and production mutation are owner-controlled.
- **SAFE-12 Production data.** Production SQL is read-only before any repair; repairs are narrow, tenant-scoped, fail-closed, authorized and post-verified (SHIP-07).

### PARALLEL-OWNERSHIP-01 — One writer per overlapping file set

At most one active writer owns a file set in a shared worktree. Parallel read-only analysis is allowed. Parallel mutation requires disjoint, explicitly owned file sets and isolated runtime resources (separate disposable databases, containers and ports). Never overwrite another workstream's WIP, evidence or runtime resources.

## 3. Risk classification

### RISK-TIER-01 — One tier per issue

At intake the lead MUST select exactly one tier with a one-line justification.

| Tier | Scope | Gates |
|---|---|---|
| LOW | isolated, reversible, low-consequence | IMPLEMENT → TARGETED VERIFY → SHIP |
| MEDIUM | ordinary application, business-logic or API change | EXISTING CONTRACT or FOCUSED AUDIT → IMPLEMENT + TARGETED VERIFY → SHIP |
| HIGH | authentication, authorization, tenant isolation, credential security, payments, inventory truth, data migrations, concurrency, or any consequential irreversible change | CONTRACT → IMPLEMENT + TARGETED VERIFY → RISK-BASED REVIEW → CERTIFY → SHIP |

Every tier runs inside the seven-stage lifecycle (LIFECYCLE-01); the tier only sets how deep each stage goes. CONTRACT/AUDIT gates belong to AUDIT and WORKSHOP; RISK-BASED REVIEW and CERTIFY belong to REVIEW/VERIFY (CERTIFY is its recorded outcome, not a separate stage); SHIP belongs to RELEASE.

Selection rules:

- Use the LOWEST tier supported by actual consequence, reversibility and uncertainty.
- An issue touching any HIGH category is HIGH unless the lead records why that category is not materially affected.
- Escalate as soon as evidence reveals higher risk. Never downgrade to save time; a downgrade requires new evidence and an explicit lead decision.
- An unclassified issue has no ratified roadmap.
- Every tier retains section 2, the main-sync gate (FLOW-01), an explicit test strategy (TEST-01), ship-lineage verification (SHIP-03) and the ownership rules in section 1.

### Gate definitions

- **CONTRACT** — an approved security/business contract (ISSUE-CONTRACT-01). It MAY be inherited unchanged.
- **EXISTING CONTRACT** — an approved contract, invariant set or certified audit that already satisfies the audit exit condition (FLOW-03); cite it instead of re-auditing.
- **IMPLEMENT + TARGETED VERIFY** — one brief covering implementation and its targeted verification, delegated under AGENT-CLOSED-LOOP-01.
- **RISK-BASED REVIEW** — REVIEW-01.
- **CERTIFY** — CERT-01.
- **SHIP** — SHIP-01 through SHIP-04 (with SHIP-DELEGATION-01 when delegated), DOC-01's documentation decision, DEPLOY-01, and production certification at the selected level (CERT-02).

### GATE-ECONOMY-01 — A gate must earn its cost

A separate gate or round is justified only when it establishes a material missing contract, security boundary, irreversible operation or necessary evidence. By default:

- no separate audit when the contract is already known;
- no workshop unless FLOW-05 selection is met (open material decisions or a material merchant-outcome opportunity);
- no standalone agent round for trivial findings;
- no separate implementation and verification rounds when one brief can safely do both;
- no splitting related changes into arbitrary slices;
- no full-repository suite after each correction;
- no repeated verification of an unchanged contract;
- no repeated review or certification of an unchanged scope;
- no standalone documentation-only ship when the update can ride with the next authorized ship.

## 4. Lifecycle, execution flow and conditional gates

### LIFECYCLE-01 — Seven-stage engineering lifecycle

Every issue moves through one lifecycle:

**AUDIT → WORKSHOP → IMPLEMENT → REVIEW/VERIFY → RELEASE → HOUSEKEEPING → REPEAT**

| Stage | Purpose | Work | Exit |
|---|---|---|---|
| 1. AUDIT | Understand the problem | Examine relevant code and behaviour; identify root cause, risks and dependencies; set a bounded scope; reuse existing evidence (FLOW-03, FLOW-04) | Problem and scope understood |
| 2. WORKSHOP | Decide how to solve it | Evaluate feasible solutions; choose the simplest safe approach; set acceptance criteria; get owner decisions for material architecture or scope changes. Proportional to complexity; MAY be a one-line SKIP (FLOW-05) | Solution and implementation boundaries set |
| 3. IMPLEMENT | Build the agreed solution | Scoped changes; targeted tests; necessary technical docs; no unrelated refactoring (IMPL-01, TEST-01) | Implementation complete with relevant local evidence |
| 4. REVIEW/VERIFY | Prove it is correct | One risk-based review; relevant automated verification; security, tenant isolation, inventory correctness and regression safety where applicable; resolve genuine blockers; reuse valid evidence (VERIFY-01, REVIEW-01). Independent review only when risk justifies it | Required checks pass; no unresolved release blockers |
| 5. RELEASE | Deliver safely | Integrate the intended changes; verify the final release SHA and required gates; rehearse migrations when relevant; get production deployment authorization; deploy; verify production (SHIP-01–04, DEPLOY-01, CERT-02) | Intended changes released and production verification successful |
| 6. HOUSEKEEPING | Close properly | Update docs and roadmap status; record decisions and final evidence; close completed issues/PRs; clean up completed branches when safe; record genuinely necessary follow-ups (DOC-01, CLOSE-01). Not another certification pass | Issue closed; no unresolved work hidden behind a Done label |
| 7. REPEAT | Move on | Select the next bounded scope from the project roadmap and begin its AUDIT; never restart completed work | Next issue's AUDIT started |

- **Certification is the recorded outcome of a successful REVIEW/VERIFY, not an additional stage** (CERT-01).
- Committed or merged is not finished: an issue is finished only after RELEASE, unless it is explicitly designated a non-release milestone (CLOSE-01).
- A failure returns only to the earliest stage it actually invalidates (for example a test failure returns to IMPLEMENT, a disproved root cause to AUDIT), never automatically to the beginning (EXEC-01).
- The gate inventory below is the detailed control inside these stages; the stage names are the shared vocabulary for reports and roadmaps (REPORT-02).

### SIMPLIFY-01 — Process overhead rules

1. **One issue at a time.** No unrelated scope expansion (FLOW-02, IMPL-01).
2. **Risk-based verification.** Depth follows actual risk (RISK-TIER-01).
3. **No duplicate evidence gathering.** Reuse applicable successful tests and reviews (EVIDENCE-REUSE-01).
4. **No unnecessary approval loops.** After scope authorization, routine implementation, corrections inside the boundary and authorized Git operations proceed without repeated approval (AGENT-CLOSED-LOOP-01, SHIP-DELEGATION-01).
5. **Safety gates stay.** Section 2, migrations (VERIFY-04) and production deployment (DEPLOY-01) are never simplified away.
6. **No redundant certification phases.** REVIEW/VERIFY owns certification evidence (CERT-01).
7. **No unnecessary full test runs.** Prefer targeted tests and the applicable automated CI (BUILD-02, TEST-12).
8. **Release before closing.** Work is complete only after its intended release, unless designated a non-release milestone (CLOSE-01).
9. **No workflow drift.** Each new finding is either a blocker of the current issue or a separately tracked follow-up.
10. **Progress forward.** Failures return only to the relevant earlier stage (LIFECYCLE-01).

GATE-ECONOMY-01 applies these rules gate by gate.

### Gate inventory

The flow below is the complete gate inventory, grouped by lifecycle stage. The risk tier selects which gates run. It is an internal control, not the displayed roadmap (REPORT-02).

```
AUDIT          FLOW-01 MAIN SYNC → FLOW-02 INTAKE → FLOW-03 AUDIT [if no existing contract]
               → FLOW-04 INHERITANCE [if an existing family is touched]
WORKSHOP       FLOW-05 WORKSHOP [per WORKSHOP_DECISION] → TEST-01 STRATEGY
IMPLEMENT      IMPLEMENT + TARGETED VERIFY → correction loop [if needed]
REVIEW/VERIFY  neighbour regression → live/DB/runtime verify [if selected]
               → REVIEW-01 [HIGH, when required] → CERT-01 recorded [HIGH]
RELEASE        SHIP (DOC-01 doc decision, ship-lineage, commit, push) → CI/deploy [owner-authorized]
               → production certification
HOUSEKEEPING   roadmap/status and evidence records → CLOSE-01
REPEAT         next issue → FLOW-01
```

### FLOW-01 — Main sync and cleanliness

Before starting an issue:

```
BRANCH=main
HEAD aligned with origin/main
UNMERGED_FILES=0
UNEXPLAINED_DIRTY_FILES=0
CURRENT_ISSUE=NONE
```

- When main is dirty: classify every dirty file, identify its owning issue or process, then finish, intentionally preserve or intentionally revert it. Do not begin the next issue until state is understood.
- Dirty-main forward sync: fetch; prove whether local main diverged; inventory tracked and untracked WIP; compare WIP paths with incoming paths; require zero unexplained non-generated overlap; preserve pre-sync manifests; remove only disposable generated artifacts that block the fast-forward; `git pull --ff-only`; prove HEAD equals origin/main and that WIP manifests are unchanged.
- Do not create a worktree merely to escape understood dirty state.
- Establish this baseline once per stable work period; recheck relevant collisions only when state changes.

### SOLO-MAIN-01 — Main-first topology

Normal work happens on local main and pushes directly to origin/main. By default there is no issue branch, worktree, pull request or synthetic merge tree. A branch or worktree is allowed only when:

- parallel development is actually happening;
- a risky multi-day experiment must stay isolated;
- an external reviewer requires a PR;
- the work cannot safely exist on main before approval;
- a provider, release or migration process requires it; or
- Milad chooses isolation.

Record the reason before creating it. Size alone is not a reason.

### FLOW-02 — Intake

State the issue ID, a plain-language problem (what the user expects, what happens, why it matters, what must stay unchanged), the risk tier (RISK-TIER-01) and the approved roadmap (REPORT-02). Run a small environment preflight (ENV-01) when verification will follow. Work discovered outside the issue goes to an existing or new bounded issue; it never drifts the active issue.

Record one workshop decision inline, with a one-line reason, using the FLOW-05 selection rule:

```
WORKSHOP_DECISION=RUN_FRONTEND | RUN_BACKEND | RUN_COMBINED | SKIP
WORKSHOP_REASON=<one line>
```

This is a lead decision made at intake, not a separate approval gate. It MAY be revised when audit evidence changes the picture.

### FLOW-03 — Audit (conditional)

Runs only when no existing contract answers the exit condition.

- Levels: RECON (GitHub reconnaissance plus a few local probes); FOCUSED (default: reconnaissance, local source confirmation and targeted executable evidence); DEEP (add an agent only for many cross-file dependencies, unfamiliar domains, concurrency/idempotency or broad architectural impact).
- Principles: reproduce the defect or requirement; re-audit inherited claims before spending implementation effort; withdrawal is a valid result; audit hypotheses as aggressively as claims; identify what the change could accidentally break; stop once the next decision is supported.
- HTTP: confirm route registration, middleware and handler; exercise the endpoint with a real token where practical; record status and relevant body.
- Reopen an audit only for material missing facts. An execution failure is handled by EXEC-01, not by a new audit.
- **Exit condition:** the lead can state current behaviour, root cause or structural explanation, affected surfaces, regression surface, stable invariant and remaining uncertainty.

### FLOW-04 — Contract inheritance and precedent (CONTRACT-INHERITANCE-01, PRECEDENT-REUSE-01)

Runs when the work touches an existing product family, UX family, lifecycle, navigation pattern, shared component or workflow. Before production mutation, identify the canonical owner, read the applicable playbooks and blueprints, find sibling flows that solved the same class of problem, and enumerate inherited invariants. Examples: first paint, transitions, error and fail-open behaviour, deep links, reload and restoration, authorization, responsive sizing, overflow, accessibility, mutation boundaries, close/back semantics.

Output:

```
CANONICAL_PRECEDENT=<component/flow/NONE>
APPLICABLE_DOCS=<playbooks/blueprints>
INHERITED_INVARIANTS=<decisive rules>
NEW_DECISIONS=<issue-specific only>
RED_CONTRACT=<tests required before implementation>
```

- When the same failure class is already solved, reuse that solution; a new mechanism requires evidence that the precedent does not apply.
- Acceptance criteria and regression contracts include inherited invariants, not only the new happy path.
- If later verification discovers a rule this gate should have found, that is a workflow miss: correct the governing doc, strengthen the executable contract, then fix the implementation.
- Inherit first, implement second, verify third.

### FLOW-05 — Workshop (conditional, merchant-value driven)

**Selection.** RUN a workshop when either of these holds:

1. Material decisions remain unresolved: behaviour, architecture, data-flow or transaction boundaries change; UX changes materially; multiple valid patterns exist; domains are being combined; the simple fix creates debt; testing needs a new architectural seam; or Milad asks for one.
2. There is a credible opportunity to materially improve merchant operational outcomes that no existing approved solution or precedent (FLOW-04) adequately resolves.

SKIP when:

- an approved precedent already solves the problem;
- the change is straightforward and bounded;
- no material UX, product or architectural decision remains; or
- further exploration would not meaningfully improve the outcome.

Never run a workshop solely for procedural compliance.

**Merchant lens.** Judge merchant value against LaSyncro's target merchants:

- Shopify-first, running their own warehouse or stockroom.
- Core ICP: roughly $500K–$10M revenue, about 2–10 operators and 20–200 daily orders.
- Broader segment: roughly $100K–$20M revenue and about 1–10 warehouse operators.
- Common conditions: high SKU complexity, fragmented data, disconnected systems, spreadsheet dependency and operational firefighting.

These are context for judgement, not eligibility criteria.

**Types:**

- **FRONTEND** — user journeys, task efficiency, information hierarchy, interaction design, responsiveness, accessibility and exception handling.
- **BACKEND** — data ownership, integration boundaries, inventory truth, lifecycle rules, transaction integrity, automation, synchronization and reliability.
- **COMBINED** — end-to-end merchant workflows spanning frontend interaction and backend behaviour.

**Outcome.** A workshop ends with one concise decision covering:

- the merchant problem and current friction;
- the relevant evidence and assumptions, labelled as such;
- viable solutions and their trade-offs;
- the recommended solution;
- the expected operational improvement (qualitative unless backed by evidence; never invent quantified benefits);
- affected frontend and backend contracts;
- acceptance criteria;
- risks and non-goals;
- Milad's approval of the material decisions.

Rules:

- The decision MAY live inline in the issue contract (ISSUE-CONTRACT-01). Trivial decisions need no separate workshop document.
- A workshop adds no certification or verification gate.
- Start from what is already wired.
- The workshop outputs the stable invariants that feed TEST-01.
- For an inconsistent UI element, find the canonical implementation and reuse its typography, spacing, tokens, icons, alignment, borders, hover state and interaction instead of approximating them.
- Material UI restructuring follows workshop → wireframe → Milad approval → implement. Tiny approved copy or style corrections need only a narrow factual preflight.
- Never implement in the same response as the audit or workshop that established a material design decision.

### ENV-01 — Environment preflight

Once per issue, before expensive verification, establish where relevant: repository root, branch, HEAD, origin/main relationship, status, root and touched-workspace dependency resolution, `.env` presence (without printing secrets), database reachability and migration level. Do not reinstall dependencies or build automatically. Do not mutate the environment until a missing prerequisite is proven. A failure caused by a missing dependency is an environment failure, not a code failure.

## 5. Execution routing

### TERMINAL-ROUTING-01 — Cheapest reliable route

- Terminal-derived evidence establishes Git/WIP truth, environment state, command results, tests, database proofs and ship lineage. The owner or a permitted agent MAY execute approved commands; the terminal is an evidence channel, not an exclusive executor.
- Agents handle bounded reasoning, implementation, approved corrections and verification within their brief and actual permissions.
- Simple deterministic commands need no separate agent round. Unavailable privileges require one bounded owner step (EXEC-01), not a transfer of the whole task.

### ROUTE-01 — Discovery versus proof

- GitHub reconnaissance SHOULD be used first to locate code, contracts, issues and lineage. It is reconnaissance, not proof of dirty-worktree contents, local migrations, database state, runtime behaviour, generated artifacts, staged contents or test results. Consequential findings MUST be confirmed locally before mutation.
- For consequential behaviour, SHOULD combine two evidence classes: static/structural and executable/runtime (for example route source plus curl, service logic plus test, migration plus SQL).

### ROUTE-02 — When to use an agent

Use an agent only when its leverage exceeds the coordination cost: multi-file implementation, complex fixtures, tracing across many files or domains, non-trivial refactors, migration/worker/concurrency analysis, or when reconnaissance plus roughly 2–5 targeted probes cannot answer the question. Agents are precision multipliers, not default scanners. Brief them with the established files, invariants and open questions.

### ROUTE-03 — Brief format

```
RUN_ID: SF-<ISSUE>-<PHASE>-<SERIAL>
ATTEMPT: <n>
MODE / RISK
AUTHORITY: <contract identity/revision or complete inline scope>
CONSTRAINTS: <read-only or exact mutation, verification, evidence-write and correction boundaries>
COMMANDS / MUTATION: <targeted task>
NUMBERED QUESTIONS: <roughly 3–5 decisive questions>
ROADMAP POSITION
```

Use one complete brief per bounded task rather than a chain of small briefs.

### ROUTE-04 — Live browser

- Milad is the default executor, guided by the lead. A browser agent MAY prove mechanics when delegated; it never replaces Milad's product/UX approval.
- For visual-only acceptance, reuse the already-running localhost and capture screenshots. Do not create accounts, seed fixtures or start runtimes to reproduce a visual state that is already available.
- Escalate to a dedicated runtime only to prove or safely reach auth/role/tenant gating, state transitions, persistence, backend integration, destructive mutations, isolation from parallel work, or an otherwise unreachable state.
- Screenshots are visual evidence, not behavioural proof. Behavioural PASS and visual PASS are separate; neither overrides a FAIL in the other.

### CMD-01 — Command safety

- Long or noisy output MAY go to a temporary log; surface only exit status, totals, failing names, the decisive error and invariant evidence. Avoid full Jest output, route manifests, large diffs and full-file dumps.
- Never provide diagnostic commands that terminate the owner's interactive shell; use conditional PASS/FAILED output. A child process MAY fail closed.
- Command blocks must stay copy/paste safe with embedded heredocs.
- SQL is supplied in heredoc form with `\pset pager off`, tenant context when required (`SET app.current_tenant = '<id>'`) and `\q`; mutations add `\set ON_ERROR_STOP on`. Never rely on an interactive psql session.
- Shell facts: `rg` may be unavailable; use grep/sed/ls/find; quote globs (`--include='*.ts'`); zsh expands unquoted globs.

## 6. Contracts, authority and bounded implementation

### ISSUE-CONTRACT-01 — Persistent issue contract

Substantial issues keep one approved contract (GitHub issue or repository document) recording scope, architecture decisions, invariants, acceptance criteria, test strategy, exclusions, risk tier, roadmap and open decisions. Briefs reference it by identity and revision instead of repeating history. Changes require lead approval; material changes require owner approval. Trivial tasks need no contract document.

### AUTHORITY-CONTINUITY-01 — Independently executable authority

- Every substantial or cross-session handoff MUST be executable from either complete approved instructions in the brief, or a verified accessible artifact with exact path, identity, revision and checksum.
- Never assume a chat-only document exists locally; manual download and placement is not the standard workflow.
- Distinguish original approved authority, approved inline instructions (`OWNER_APPROVED_CONVERSATION_SCOPE`), retrospective reconstruction and agent recommendations awaiting approval. Never present a reconstruction or recommendation as approval.
- When evidence writes are explicitly authorized, persist `authority.md`, `execution-manifest.json` and `handoff.md` in the attempt-specific evidence directory, proportionate to the task. `READ_ONLY` grants no evidence-write permission.

### RUN-IDENTITY-01 — Execution identity

Every brief, agent report and handoff starts with `RUN_ID: SF-<ISSUE>-<PHASE>-<SERIAL>` and `ATTEMPT: <n>`.

- Never reuse a completed RUN_ID. Keep the same ID across retries and corrections, incrementing ATTEMPT for each execution retry. Use a new ID for a new phase.
- Evidence records RUN_ID, ATTEMPT and parent RUN_ID where applicable.
- Identity never implies authorization.

### IMPL-01 — Implementation scope

Every implementation brief states: files and tests allowed to mutate, state that must not mutate, behaviour that must remain unchanged, the exact outcome, and the regression contract.

- Slice only at real dependency, risk or release boundaries; one brief MAY implement and verify a slice. Do not create a separate later testing sprint.
- Do not combine unrelated fixes. Classify an unrelated defect and route it to a separate issue unless it is a proven blocker.
- Do not re-audit facts established minutes earlier unless state changed.
- Prefer precise, deterministic edits over whole-file rewrites.
- A testability seam is allowed only when explicitly authorized and only when it improves production architecture. No test-only production behaviour, hidden environment bypass, disable-security flag or unapproved provider host override. Production defaults remain unchanged and are proven.

### BUILD-01 — Builds fail closed

- No ad hoc application or module build without explicit authorization for that verification boundary; one authorization never becomes standing permission.
- A canonical command that owns prerequisite generation (`npm test`, `npm run test:foundation`, `npm run dev`) also authorizes its declared `build:deps`.
- `tsc --noEmit` is not a build.
- `modules/*/dist` and `packages/*/dist` are generated-only and ignored, and are never staged. Required invariant: `TRACKED_WORKSPACE_DIST=0`, enforced by `npm run check:generated-artifacts`.
- Any other version-controlled generated class follows its owning policy; report every generated file and stage only the complete intended set.

### BUILD-02 — Verification-cost routing

Match verification to the changed boundary:

- `packages/*` or `modules/*` → build the touched workspace; build dependants only when the public surface changes.
- `apps/backend/*` → targeted unit, integration, DB and runtime tests; the full backend build only for build-config, package-boundary, bootstrap or dependency risk.
- `apps/frontend/*` → targeted tests plus localhost/browser verification; the full production build only for bundling, routing-integration or dependency risk.
- Root or shared configuration → broaden only to the affected dependency graph.

Full monorepo builds are exceptional evidence. After a forward-sync, verify only the incoming delta plus the current issue. CI/deploy MAY supply final full-build evidence but never replaces targeted pre-push behavioural verification.

### TSC-01 — TypeScript baseline

Capture a baseline once per issue, or when environment or build state changes. Report `TSC_ERROR_COUNT=<total>` and `TARGET_ERROR_COUNT=<touched surface>`. Pre-existing unrelated errors are not current failures; `TARGET_ERROR_COUNT > 0` is a failure.

## 7. Testing, evidence reuse and regression selection

### TEST-01 — Explicit test strategy

Every issue records a test-strategy decision; for LOW/MEDIUM it MAY be inline in the intake or brief. Classify each relevant layer REQUIRED / OPTIONAL / SKIP: UNIT, API INTEGRATION, DB INVARIANT, MIGRATION, WORKER/OUTBOX, CONCURRENCY, PLAYWRIGHT, ARCHITECTURE/STATIC, LIVE BROWSER, PROVIDER E2E. Select a production certification level (CERT-02).

Every issue ends with exactly one completion state:

- `AUTOMATED_TESTS_ADDED`;
- `EXISTING_TESTS_EXTENDED`; or
- `AUTOMATED_TESTS_SKIPPED` with `Reason:` and `Verification replacement:`.

There is no silent omission. Tests belong to the issue they protect and ship with it.

### TEST-02 — Default layer selection

| Change | Default protection |
|---|---|
| Pure calculation or business rule | Unit |
| HTTP route, middleware or controller | API integration (`createApp()` + supertest when process startup is not the contract) |
| Transaction, RLS, counters, inventory, alerts | Real PostgreSQL integration |
| Migration, schema or DB function | Scratch migration (VERIFY-04) |
| Worker, retry or outbox | Worker integration |
| Concurrency or atomic claim | Concurrent integration |
| Important frontend interaction | Playwright or live browser, depending on wiring risk |
| Pure visual or copy correction | Live browser; automation usually skipped |
| Canonical architectural rule | Architecture/static contract |
| Previously working behaviour broke | Regression test strongly expected |
| Docs-only change | Automated tests normally skipped |

Use the cheapest layer that proves the invariant; add higher integration only when wiring is materially risky. For a consequential merchant journey that crosses services, authority boundaries or lifecycle states, identify the entry point, the consequential adverse transition (for example, credential expiry before reinstall), the required recovery or invariant, and the cheapest decisive verification. Reuse existing coverage; this does not require a full state matrix, tests at every layer or redundant suites.

### TEST-03 — Defect regression

For a confirmed meaningful defect: reproduce → define the regression contract → add a failing test where practical → implement → the same test turns GREEN → selected neighbours stay GREEN.

- If RED-first is unsuitable, record why.
- A test that passes before the fix is not proof of the defect.
- When coverage is added for already-verified behaviour, do not manufacture RED; report it as protecting existing behaviour.

### TEST-04 — Contracts, not files

- Protect business and system contracts: merchant workflows, inventory, fulfillment, billing, data integrity, auth, tenant isolation, Shopify, migrations, async delivery and critical UX.
- Assert downstream-consumed fields, machine-readable error codes, routing facts, security/tenancy facts and declared provider contracts.
- Do not freeze debugging metadata, generated IDs, timestamps, serialization order, prose, incidental DOM shape or copy, unless that exact text or structure is itself contractual (accessibility labels, legal disclosures, API errors, security boundaries).
- Use the minimum decisive cases; do not collapse distinct business branches. Test consequential boundaries at limit−1, limit and limit+1.
- Parameterized or property tests only where they genuinely improve clarity, or when authorized.

### TEST-05 — Legacy and stale tests

A red legacy test is not automatically a product defect. Identify the invariant it protects, confirm whether it still exists and matters, then classify the test (ACTIVE, SHARED/INFRA, PAUSED, DEPRECATED or UNCLEAR) before repairing, replacing or removing it. Never restore retired behaviour to satisfy a stale contract. When ownership moved, update the test to protect the current invariant and correct stale documentation that names retired ownership. Obsolete copy and DOM assertions are not release gates.

### TEST-06 — Fixtures

- Use the smallest deterministic fixture on the real schema with minimum valid state, synthetic identifiers, no provider side effects and deterministic cleanup.
- Reuse canonical tenant bootstrap and context paths; do not bypass RLS.
- For guarded or single-writer tables, prove the guard and use the canonical writer or a supported transaction-local mechanism only.
- Extract reusable builders only when multiple suites share stable semantics.
- When a critical cross-boundary contract is in scope, the fixtures MUST reach the adverse state the contract names; if they do not, report the gap.

### TEST-07 — Semantic strength

One successful write does not prove exactly-once; one outbox row does not prove provider idempotency. Retry, replay, uniqueness and concurrency claims require their own contract and evidence.

### TEST-08 — Mocks and providers

Avoid mocks where safe real local boundaries are practical. Never substitute a mocked proof for a required real DB/API/runtime proof. Provider E2E is separate and runs only when external acceptance is part of the contract and authorized.

### TEST-09 — Jest ownership

Every `.test.ts`/`.test.tsx` belongs to exactly one configured project. `npm run test:config` MUST report `UNOWNED=0` and `MULTI_OWNED=0` whenever tests are added or moved. Fixed test counts are not a permanent contract.

### TEST-10 — Test infrastructure contract

- **DB-free foundation:** `npm test` / `npm run test:foundation` / `npm run test:fast` run test:prepare → build:deps → test:config → test:db-safety → test:contract. This path never resets, migrates or seeds the development DB, and never creates tracked dist. The former `test:setup` path no longer exists.
- **Disposable integration:** `npm run test:integration -- --testPathPatterns <pattern>` (via `scripts/with-test-db.js`) generates `synchroflow_test_*`, validates safety fail-closed, creates the DB with the migration role, migrates from empty, verifies restricted runtime access, runs the selection serially, drops the exact DB and proves removal. Never point it at PGDATABASE, never substitute `db:reset`, and never add an implicit global seed.
- **Cleanup proof:** the exact generated DB is absent, no `synchroflow_test_*` orphan remains, and the normal PGDATABASE still exists.
- **Frontend suite** (`npm run test:frontend`) is diagnostic and non-gating; triage it by invariant relevance (TEST-05).
- **Playwright** (`npm run test:e2e`) is separate from the Jest harness; prepare its environment deliberately.
- **Open handles:** the existing `--forceExit` is compatibility debt, not proof of healthy lifecycle. Do not remove it without separate proof and authorization, and do not hide a new open handle behind it.

### TEST-11 — Reproducible selection manifests

Any selection used for certification or as protected-regression evidence MUST record: exact test file paths (not only patterns), per-file pass counts, source and test SHA-256, base commit, runner identity and command, and environment identity. A count without a file list is not reusable evidence. Confirm the exact paths with `--listTests` before running when a pattern is used.

### TEST-12 — Regression selection

- **Level 1 — issue gate:** the new or changed contract, the neighbours selected in TEST-01, the affected TypeScript surface, and DB/runtime/browser evidence where selected.
- **Level 2 — release/CI gate:** broader foundation or deep suites, according to risk.
- Broaden only to actual affected dependencies. Do not skip a failing neighbour as "unrelated" without evidence; report proven pre-existing baseline failures separately.
- Run expensive protected selections once on the final candidate, not after every mechanical correction; corrections run the affected targeted contract.

### EVIDENCE-PERSISTENCE-01 — Durable evidence

Before removing disposable resources, persist redacted evidence outside the repository, and not only in `/tmp`: RUN_ID/ATTEMPT/parent, base SHA, approved manifest and source hashes, commands and exit codes, test totals and failures (TEST-11), migration/security proofs, runtime-isolation attestation, known baseline failures, and the manifest SHA-256. Persist pre-cleanup evidence, then append and verify cleanup proof.

- Preserve earlier evidence immutably. Never overwrite an executed runner or hashed artifact; use distinct or versioned records.
- Use a new attempt directory only when the authority or the immutable harness requires it, not merely because a command failed.
- A local path is not accessible to a remote reviewer; supply a compact redacted handoff or upload when independent inspection is needed.

### EVIDENCE-REUSE-01 — Selective reuse

Reuse GREEN evidence only when all of these hold:

- the relevant file hashes are unchanged;
- the environment is still applicable;
- the test contract is unchanged; and
- the evidence is available and attributable.

Invalidate only the affected layers. Documentation-only changes do not invalidate PostgreSQL, migration or concurrency proofs. Security or migration changes require renewed proofs for the affected authority. Timestamps never establish same-source evidence. Inspect existing logs and structured results before any rerun.

### INFRA-REUSE-01 — Infrastructure reuse first

Reuse the existing harnesses, runners and CI jobs before proposing infrastructure. Where safe local execution is unavailable, extend an existing CI step and DB lifecycle. Provision new runners, databases or dependencies only when the proof is otherwise unobtainable and Milad approves. CI evidence counts only when it is attributable to the exact reviewed revision; until then CI-dependent results are PENDING. A required branch push first needs SHIP-DELEGATION-01 authorization.

### VERIFY-01 — Three verification questions

1. Did the requested behaviour work? Use the strongest appropriate evidence: API, SQL, test, worker, browser, migration rehearsal, or provider sandbox when required.
2. Did the selected permanent regression contract pass? Report each layer explicitly.
3. Did the selected neighbouring contracts stay intact?

A flow that stops before its acceptance boundary is `PARTIAL / NOT VERIFIED`. Proof from an old location is not inherited after rewiring.

### VERIFY-02 — API verification

Exercise the real route with real middleware and valid auth; assert status, body and, when side effects matter, DB post-state. For tiered or commercial routes, separately prove the route-gate authority and the business-decision tier authority.

### VERIFY-03 — Database invariants

Assert state before and after. A rejection path proves its zero-side-effect contract where specified (state, counters and timestamps unchanged; no alert, billing event or outbox row). Scope assertions to the fixture's IDs rather than global counts.

### VERIFY-04 — Migrations

Where applicable: compile; fresh scratch migration; bounded UP and, when required, DOWN; schema, function, index and grant assertions; restricted-role runtime proof.

- Production-mode rehearsal sets `DATABASE_URL` (migration role) and `APP_DATABASE_URL` (`sf_app`) against the same scratch DB with `NODE_ENV=production`.
- Scratch DBs are created, migrated and dropped with the migration role (`PGMIGRATION_USER`), never `sf_app`.
- Independent shippability of migration N: apply sequentially through N only, then assert N is recorded, N+1 is absent, and schema/grants/runtime are correct. `migrate:latest` alone is not proof.

### VERIFY-05 — Workers and outbox

Where applicable: claim, success, failure, retry, backoff, concurrency, stale-claim recovery, already-published behaviour and provider-idempotency assumptions. Assert only the delivery fields the dispatcher actually consumes, plus declared business invariants.

### VERIFY-06 — User-facing work

Browser verification is mandatory for user-facing behaviour unless explicitly justified otherwise (ROUTE-04). Milad judges hierarchy, semantics, visual consistency, density and interaction. Never substitute curl when UI wiring is under test.

## 8. Failure handling and correction loops

### EXEC-01 — Execution continuity (EXECUTION-CONTINUITY-01)

Within an approved execution, run:

APPROVED CONTRACT → IMPLEMENT → TARGETED VERIFY → CLASSIFY FAILURES → CORRECT WITHIN BOUNDARY → VERIFY AFFECTED CONTRACTS → PERSIST EVIDENCE → REPORT

Complete this loop in one execution when permissions permit. It grants no new scope, test-layer choice, privilege, evidence-write permission or phase transition.

**Static runner preflight** (before expensive execution, reusing the established infrastructure). Verify:

- worktree, HEAD, exact source/test hashes and allowlists, protected WIP, and snapshot ownership;
- dependencies, including nested workspaces, entry points and native bindings for the target OS/architecture;
- runtime/tool versions, module-loading configuration and process flags against the last valid run;
- credential availability and the intended restricted role, tenant and DB targets, without printing secrets;
- test configuration, project, exact paths, arguments, approved neighbours, resource ownership and cleanup;
- evidence-write authority and destination.

Static preflight is never reported as runtime verification.

**Failure classes:** production implementation; test/assertion; fixture; runner/harness; environment/dependency; existing regression or stale contract; material contract conflict. Classify before correcting. Inspect existing logs before any audit, rerun or new runner; a failing command alone justifies none of them. Return only to the lifecycle stage the failure invalidates (LIFECYCLE-01): restart AUDIT or WORKSHOP only when evidence invalidates the approved audit or design.

**Privilege gap:** when Docker or another privilege is unavailable, never bypass it. Hold the dependent operations, prepare one complete owner-executable command for the approved isolated environment, and let the same session inspect the returned results when possible.

**Finish** with attributable results, correction history, WIP integrity and owned-resource cleanup proof, or with explicit blockers and incomplete work.

### AGENT-CLOSED-LOOP-01 — Delegated implement-and-verify

An approved brief (`MODE: CLOSED_LOOP_IMPLEMENT_AND_VERIFY`, or an explicitly equivalent brief stating the same permissions and limits) delegates one bounded slice. A single-phase or `READ_ONLY` brief grants no unstated implementation or correction authority.

**Prerequisites:**

- approved architecture, scope, acceptance criteria and regression contract;
- explicit source/test/fixture allowlists and any runner/evidence paths;
- approved verification commands and actual permissions;
- protected WIP and approved neighbours identified;
- no unresolved material decision.

**Within its allowlists the agent MAY:**

- inspect neighbouring code;
- fix mechanical path/import and disposable-harness defects, and its own implementation defects;
- correct mechanically incomplete fixtures without changing business state, execution path or assertions;
- correct a configured timeout only when an approved bounded longer window is evidenced;
- verify the affected contracts.

**Correction budget:** at most three correction cycles per delegated slice. A new failure class, runner version or agent session does not reset it. Never rerun until a flaky PASS appears. On exhaustion, STOP.

**Expected TDD RED** is recorded as RED. Continue to GREEN only when the same brief authorizes the implementation.

**STOP immediately when:**

- files or privileges outside the boundary are needed;
- architecture, business contract, product semantics or acceptance criteria would change or are disputed;
- a security invariant or migration history would change;
- a destructive or production operation is needed;
- an unexpected unrelated failure needs source edits;
- staging, commit, push or deployment would be needed without authorization;
- passing would require weakening assertions (SAFE-09);
- isolation, authorization, RLS or data safety would be bypassed;
- the DB, provider or runtime target cannot be confirmed;
- WIP or parallel ownership conflicts;
- the environment is unsafe or cleanup cannot be assured;
- material unexpected behaviour appears;
- the budget is exhausted.

Agent-owned verification is preliminary evidence; review, certification and ship decisions stay with the lead and owner.

### CI-TRIAGE-01 — Classify before changing source

| Class | Meaning | Default action |
|---|---|---|
| CURRENT_ISSUE_REGRESSION | the change broke a relevant invariant | smallest correction loop |
| STALE_CONTRACT | the test protects retired behaviour | audit the invariant; update or replace the test (TEST-05) |
| MAINLINE_REGRESSION | existing main is genuinely broken | separate issue or blocker |
| ENVIRONMENT_FAILURE | a prerequisite failed | correct the environment only |
| FLAKY_INFRA | the same tree passes and fails | reproduce and track; never relabel without evidence |
| UNRELATED_ACTIVE_FAILURE | real, but outside this issue | separate issue |
| UNKNOWN | evidence insufficient | narrow audit |

Never change production source merely because CI is red. A mainline CI blocker is fixed directly on main (classify → issue → fix → targeted verify → commit → push → rerun) without a worktree/PR chain. A failure is evidence, and a flaky test remains a safety defect until the lead decides otherwise.

## 9. Documentation, commit, push, CI and deployment

### DOC-01 — Documentation within the issue

- Documentation is part of the issue and rides with its ship. It is not a separate gate or round.
- At ship the lead records `WORKFLOW_DOC_UPDATE_REQUIRED: YES|NO`: did the issue change how we work, what agents may do, or a standing rule? If YES, update this workflow, and the agent guidelines when agent behaviour changed, in the same ship. Defer only with explicit lead approval and a recorded issue ID.
- Never rely on chat history for workflow rules.
- Document only verified contracts, invariants, architecture, important reasoning, traps, deliberate exclusions, deferred issue IDs and verification boundaries. Distinguish runtime acceptance from automated regression evidence. Prefer one authoritative playbook over copies.
- Mutation pattern: anchor preflight → deterministic edit (Python when appropriate) → unique-anchor and no-duplicate assertions → verify the content exists once → `git diff --check` → status.
- `git diff` and `git diff --check` do not cover untracked files: verify new files directly. After staging, `git diff --cached --check` is authoritative.

### SHIP-01 — Commit preflight

Declare exact target files → show their status → stage those paths only → print the staged list and compare it with the expected scope → `git diff --cached --check` → staged stat → list remaining unstaged files. When workspace build state is relevant, run `npm run check:generated-artifacts` and prove `TRACKED_WORKSPACE_DIST=0`.

### SHIP-02 — Commit content

Tests ship with the feature they protect, normally in the same commit. The message states the issue reference, the merchant or technical outcome, the meaningful boundary and any critical non-goal; it is not the playbook.

### SHIP-03 — Ship lineage (SHIP-TREE-01)

Final verification targets the exact tree to be committed, pushed and deployed (`VERIFY_SHA ≈ COMMIT_SHA = PUSH_SHA`). It confirms the tree. It does not repeat unchanged expensive tests that pass EVIDENCE-REUSE-01. Avoid unverified synthetic merge trees.

### SHIP-04 — Push proof

Capture `COMMIT_SHA`; push to origin/main; require `LOCAL_SHA == REMOTE_SHA` and `PUSH_CONFIRMED`. A push alone does not close an issue that still requires CI, deploy or certification.

### SHIP-DELEGATION-01 — Exact-manifest ship delegation

Default: Milad stages, commits and pushes. Milad MAY delegate those actions for one named RUN_ID, or once for a whole named issue scope, against a fixed, certified manifest or approved file allowlist. An issue-scope delegation covers that issue's routine commits and pushes, including correction commits inside the approved allowlist, without per-commit re-approval (SIMPLIFY-01 rule 4). All of the following are required:

- exact RUN_ID or issue scope and explicit authorization;
- exact file allowlist and, for each commit, verified hashes of the staged content;
- clean index before explicit-path staging;
- staged manifest and content hashes equal to the approved manifest, with zero unauthorized files;
- no force push; STOP on remote divergence, with no automatic merge, rebase or reset;
- exact-SHA CI verification and a persistent audit trail.

The delegation never covers production deployment, production migrations, secret or credential mutation, GH-1262 integration, other issues, files outside the allowlist, or work after the issue closes. A RED CI result stops the execution until it is classified (CI-TRIAGE-01); a correction commit inside the allowlist is covered only by an issue-scope delegation, otherwise it needs separate authorization. HIGH-risk certification and owner approval remain required.

### DEPLOY-01 — CI and deployment safety (DEPLOY-GATE-01, RELEASE-CONTINUITY-01)

- Consequential pushes require the selected local gate to be GREEN first.
- Deployment should depend on required CI rather than race it. A pipeline that can publish a red main is infrastructure debt; until it is fixed, the pre-push gate is release-critical.
- CI and deploy build workspace dependencies from source in dependency order and never rely on committed or pre-existing dist. Targeted workflows list their prerequisites explicitly. A missing output in a fresh clone is a build-order gap, not a reason to commit dist; simulate a fresh clone by removing dist and `*.tsbuildinfo`.
- Never ship a multi-slice feature in a state that leaves an enabled live journey uncompletable; release dependent slices together or keep a safe gate or compatible path.
- Fast CI prioritises TypeScript, unit/contract, architecture, critical API/DB integration, migration smoke and commercial/security invariants. Deep suites run on main, nightly or release according to cost. New coverage joins an existing job and DB lifecycle where practical.

### SHIP-07 — Production SQL

Inspect read-only first; scope narrowly by tenant and predicate; never guess schema; mutate only when evidence proves the repair; fail closed; verify the exact post-state. Owner authorization is required.

## 10. Review, certification, completion and reporting

### REVIEW-01 — Proportional independent review

- RISK-BASED REVIEW: the lead reviews HIGH evidence against the contract.
- Exactly one genuinely independent review (a separate reviewer or agent session, or Milad) is required when a material security/authorization boundary, migration authority or irreversible data invariant cannot be certified from the implementing agent's evidence alone. LOW/MEDIUM work requires none.
- Independence means a separate session that re-derives conclusions from source and evidence. The reviewer is read-only.
- Re-review is proportional to the change. A correction that alters behaviour inside a reviewed safety boundary is reviewed as a delta (changed source plus its affected contracts), not as a new full audit. Purely mechanical corrections (harness, fixture mechanics, evidence completion) are confirmed by the lead from evidence without another review round.

### CERT-01 — One certification decision per scope

- CERTIFY is the lead's acceptance of the complete HIGH evidence set for a named scope, approved by Milad. It is the recorded outcome of a successful REVIEW/VERIFY stage, not a separate lifecycle stage, and it needs no extra artifacts beyond the evidence already gathered.
- Component certification and milestone certification are distinct: certifying a component (for example, one recovery path) never certifies the milestone or sprint that contains it, and milestone certification requires its own decision over its integrated evidence.
- One certification decision is made per scope. Unchanged certified scope is not re-certified. A later change re-opens only the affected scope, and only when EVIDENCE-REUSE-01 fails for it.
- Certification claims describe exactly the journey and state tested: component GREEN does not prove the full merchant journey, fresh install does not prove reinstall after credential expiry, and mocked provider acceptance is not live acceptance. Require further proof only when the missing scenario is consequential and inside the approved contract.
- Tested is not certified, and certified is not shipped.

### CERT-02 — Production certification levels

Selected at TEST-01; certification is risk-based, not ceremonial.

- `NONE` — no runtime or release consequence; justified explicitly.
- `CI_ONLY` — test ownership, docs-only or non-runtime contract maintenance; no merchant replay.
- `RUNTIME_SMOKE` — runtime wiring changed without deep state risk.
- `DB_INVARIANT` — persistence or state-transition correctness in the deployed runtime.
- `LIVE_BROWSER` — user-facing workflow acceptance.
- `PROVIDER_E2E` — real provider acceptance is part of the contract.

### CLOSE-01 — Issue closure (HOUSEKEEPING)

Closure is the HOUSEKEEPING stage: update docs and roadmap status, record decisions and final evidence, close completed GitHub issues/PRs, delete completed branches/worktrees when safe (SAFE-08 still applies), and record genuinely necessary follow-ups with issue IDs. It reuses existing evidence and is never another certification pass.

An issue is complete only after its intended release, unless the issue contract explicitly designates it a non-release milestone. An issue closes only when every gate selected for its tier is complete:

- implementation accepted;
- test strategy satisfied with its completion state recorded;
- targeted and neighbour regressions accepted;
- live/DB/runtime acceptance where selected;
- review and certification for HIGH;
- documentation decision recorded and applied;
- commit and `PUSH_CONFIRMED`;
- CI and deploy accepted where required;
- production certification at the selected level.

Then: ISSUE CLOSED → REPEAT (next issue). Deferred consequential work carries an issue ID and reason.

### REPORT-01 — Reports and handoffs (HANDOFF-01)

- Agent reports use one four-backtick block starting with RUN_ID and ATTEMPT, then FINDINGS, RAW, DEVIATIONS, BLOCKED, NOT COMPLETED, STATE_MUTATED and ROADMAP POSITION.
- NOT COMPLETED lists every unfinished directive as `ITEM / STATUS (NOT_STARTED|PARTIAL|FAILED|SKIPPED) / REASON / TO_RESUME`, including dependent verification not run. It is distinct from BLOCKED, which names obstacles. NONE only when everything was completed and evidenced.
- The lead reconciles NOT COMPLETED against the brief before authorizing the next phase; an explicitly deferred item stays visible until its disposition is decided.
- Keep reports concise: verdict, baseline, manifest, evidence path and checksum, GREEN/RED results, deviations, blockers, unfinished obligations, mutated state and roadmap. Raw logs live in evidence artifacts. Do not repeat unchanged background.

### REPORT-02 — Two-column roadmap (ROADMAP-PLAIN-ENGLISH-01)

Every lead response, brief, agent report, progress report, handoff and issue summary ends with one compact two-column roadmap, readable in a few seconds:

| 🗺️ PROJECT ROADMAP | 🔧 CURRENT ISSUE — <issue ID / short title> |
|---|---|
| <larger product milestone> | <smaller actionable step> |

- **LEFT — Where are we in building LaSyncro?** Larger product milestones (for example product category ingestion; purchasing; Receive and Problem Center; Stow / Put Away; Pick, Pack and Ship). Show completed milestones, the current one and the relevant upcoming ones; never an exhaustive backlog.
- **RIGHT — What exactly are we doing now?** The concrete steps of the current issue (for example "Integrate I5 + SAFETY-015", "Verify combined CI", "Obtain release approval", "Deploy"). Prefer concrete tasks over generic labels when they say more; the current step MUST be identifiable as one of the LIFECYCLE-01 stages.
- The columns are independent roadmaps. Rows do NOT imply a relationship or dependency between the left and right cells. When the columns have different lengths, leave cells blank; never invent work to fill rows.
- Cells are short, plain English, with exactly one status icon each:
  - ✅ **Done** — completed and verified at the appropriate level;
  - 🟡 **In progress** — currently being worked on;
  - 🔵 **Next** — next planned step;
  - 🔴 **Blocked** — cannot proceed until a named issue is resolved (name it briefly);
  - ⚪ **Later** — planned, not active.
- Do not use APPROVED, CERTIFIED, GREEN or SHIPPED in the roadmap where the meaning is simply Done or In progress. Those terms keep their precise meaning in detailed evidence, certification and release records (CERT-01, VERIFY-01, SHIP-04).
- Never mark a project milestone ✅ while its required production release is outstanding (CLOSE-01).
- The right column changes as the issue progresses; the table is never a hardcoded roadmap.
- Never invent milestones or change approved order, scope or phase without lead/owner approval. Done items need verified evidence; blocked work stays at its step. Parallel issues keep independent right columns.
- If no roadmap is approved, report the missing contract.
- A roadmap is a factual declaration, never authorization to continue.

Illustrative example (presentation only; not the current authoritative roadmap):

| 🗺️ PROJECT ROADMAP | 🔧 CURRENT ISSUE — I5 + SAFETY-015 |
|---|---|
| ✅ Product categories — Done | ✅ Audit and solution — Done |
| ✅ Purchasing S1 — Done | ✅ Implementation — Done |
| 🟡 Receive + Problem Center — Releasing | 🟡 Review / Verify — Current |
| 🔵 Stow / Put Away — Next | 🔵 Release — Next |
| ⚪ Pick / Pack / Ship — Later | ⚪ Housekeeping — Later |

### EXCEPT-01 — Exceptions

Any deviation from a MUST in this document requires an explicit, recorded owner decision naming the rule ID, scope and duration. Exceptions never extend to section 2 without that decision, and never apply to later issues by implication.
