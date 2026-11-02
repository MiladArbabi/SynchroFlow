# AGENT OPERATING INSTRUCTIONS — laSyncro

- Aligned with: ENGINEERING WORKFLOW v4.0 (`docs/agent_directives/engineering_workflow.md`)
- Status: RATIFIED — owner approved 2026-11-02
- Scope: the execution contract for any agent running a laSyncro brief

The workflow is the single authority. This document applies the workflow to agent execution and does not restate it. Rule IDs below (for example SAFE-05, EXEC-01) refer to the workflow. If the two conflict, follow the workflow and report the conflict under FINDINGS. MUST / MUST NOT / SHOULD / MAY / STOP have the meanings in workflow section 0.

## 1. Role and authority

- **You execute; you do not decide.** The engineering lead owns framing, architecture, product semantics, scope, risk tier, test strategy, regression contract, test-layer selection, acceptance criteria, sufficiency of evidence and phase transitions (ROLE-02). Milad owns approvals, code approval, ship and deployment (ROLE-01).
- Your job is to:
  - run exactly the requested commands and authorized mutations;
  - answer the numbered questions;
  - report exactly what happened;
  - surface contradictions, failures, unexpected passes, side effects and missing evidence.
- MUST NOT:
  - improve the brief or widen scope;
  - redesign the test strategy or add test layers;
  - fix adjacent problems;
  - continue into the next phase.
- When evidence suggests a higher risk tier than the brief states, report it under FINDINGS and stay inside the brief's boundary. You never choose, change or downgrade the tier.
- Not your call: whether behaviour is a defect; whether a design is correct; whether a layer is required or a test may be skipped; whether a failure, flake or assertion change is acceptable; whether a snapshot updates; whether a provider call is worthwhile; whether scope expands; whether work continues after a material contradiction; priority; architecture.

## 2. Execution identity and scope

- Start every report and handoff with `RUN_ID:` and `ATTEMPT:` as the first content lines. Preserve the invoking RUN_ID and follow RUN-IDENTITY-01 for retries.
- Execute only the single phase or slice the brief names. A combined phase (for example IMPLEMENT + TARGETED VERIFY) is still one phase. Finish the slice, report, stop.
- Authority comes from the brief or a verified artifact with exact path, identity, revision and checksum (AUTHORITY-CONTINUITY-01). Do not rely on unavailable chat-only documents. Distinguish approved authority from your reconstructions and recommendations.
- Do not invent a side-effect contract because a nearby side effect exists. Test only the semantic contract the brief establishes.
- Do not mutate from memory. Before any authorized mutation, run a narrow read-only preflight (grep, sed, ls, small scripts, schema inspection) proving the target file and range, anchors, current implementation and fixtures, any existing canonical helper, and, for API work, the route manifest, middleware/auth/entitlement gates, transaction boundary and authoritative data source.

## 3. Worktree, WIP and parallel isolation

- Everything is read-only unless the brief explicitly authorizes the mutation.
- Assume unrelated changes are legitimate; they must survive (SAFE-08). Inspect and mutate only named files. Never clean, reset, stash, checkout or restore unrelated files, delete unrelated untracked files, or rebuild packages to tidy status.
- PARALLEL-OWNERSHIP-01: one writer per overlapping file set. Use only your own disposable databases, containers, networks and ports. Never stop, reuse or delete another workstream's resources, evidence or WIP. Stop only processes your brief created, and never kill ambient processes because their names match.
- Record WIP baseline hashes (status and tracked diff) before mutation or expensive execution, and prove them unchanged afterwards when the brief protects WIP.
- Read-only Git commands are allowed: `status`, `diff`, `diff --check`, `diff --stat`, `log`, `rev-parse`, `show`, `fetch`.

## 4. Mutation boundaries

Never do any of the following autonomously:

- edit production source, tests, test helpers, fixtures, test/CI configuration or dependencies;
- run seeds, `dev`, stateful setup/rebuild, or ad hoc builds (BUILD-01; `npm run build -w apps/backend|apps/frontend` only when authorized);
- UPDATE or DELETE rows, or call mutating APIs (POST/PATCH/PUT/DELETE);
- reset the worktree, clean generated files or alter unrelated dist output;
- repair unrelated errors.

When mutation is authorized:

- change only the named files and state;
- make no adjacent cleanup;
- report every changed and generated file, including unexpected output (never delete it);
- stop if a correct implementation needs broader scope.

**Generated module output.** Run only the requested workspace build. Report every generated file. Do not cherry-pick or delete unexpected output.

**Testability seams** need explicit authorization and must follow IMPL-01. After adding one, prove production call sites still use the normal defaults.

**Reusable fixture builders** need explicit authorization. When authorized, they use the real schema, produce deterministic state, default to safe no-provider behaviour and support reliable cleanup.

**Documentation edits.** Follow DOC-01's deterministic pattern; fail rather than duplicate. A blank `git diff --check` does not prove content was written, so verify content directly. Untracked files are invisible to `git diff`; prove they exist with `git status --short`.

## 5. Database and environment facts

- The canonical local environment is root `./.env`, which defines `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE`, `PGMIGRATION_USER` and `PGMIGRATION_PASSWORD`. Do not assume `DATABASE_URL` exists.
- Standalone application-role SQL:

  ```
  set -a; . ./.env; set +a
  export DATABASE_URL="postgresql://${PGUSER}:${PGPASSWORD}@${PGHOST}:${PGPORT}/${PGDATABASE}"
  ```

  Never print either URL or any credential (SAFE-07).
- Every tenant SQL session uses `\pset pager off` and `SET app.current_tenant = '<id>';` (CMD-01). `sf_app` is restricted and has no `rolbypassrls`; never assume an RLS bypass.
- `inventory_movements` is append-only. Never DELETE from it; corrections are compensating and explicitly authorized (SAFE-02).
- Integration tests run only through the disposable harness (TEST-10, SAFE-05). Never use the development DB, `db:reset` or PGDATABASE as a scratchpad. Scratch DBs are administered with `PGMIGRATION_USER`; runtime verification uses `sf_app`.
- When cleanup proof is requested: the exact generated DB is gone, no `synchroflow_test_*` orphan remains, and PGDATABASE still exists. Do not inspect development application tables unless authorized.
- Shell variables do not persist between command blocks. Re-establish them, and prove that any earlier state you depend on still exists.
- Do not hide failures by discarding output, and do not truncate decisive evidence; keep any bounds the brief sets.

## 6. Test execution and integrity

- Run exactly the layers and suites the brief selects. Do not add Playwright because it seems useful, skip DB integration because unit tests are easier, or replace REQUIRED with a cheaper layer. If a required layer cannot run safely, report BLOCKED.
- **Test integrity (SAFE-09)** is absolute. A failing assertion, failing test, unexpected PASS or contradiction is evidence: report it, never correct it into success.
- **Path selection:** positional Jest paths can be ignored. Use `--testPathPatterns` (mobile: `--testPathPattern`) and confirm the exact files with `--listTests` before running. Record the selection per TEST-11.
- **Regression order (TEST-03):** reproduce → add the test → prove it FAILS for the expected reason → implement only when authorized → rerun the same test → prove PASS → run selected neighbours. Do not alter the test between RED and GREEN unless authorized. A test that already passes pre-fix is reported as a contradiction. When the brief states the behaviour is already verified, add coverage without reverting source, and report it as protecting existing behaviour.
- **Contracts:** execute the lead's regression contract and exact boundaries (for example 49/50/51) without substitution. Do not reinterpret contracts into weaker tests, or replace a requested real DB/API/runtime proof with mocks (TEST-04, TEST-08). Keep compatible invariants folded when the brief allows; never collapse distinct decision boundaries. Introduce parameterized or property tests only when authorized; when used, report seeds and preserve failing examples.
- **Layer specifics:** API per VERIFY-02 (real route via `createApp()` + supertest; do not call controllers directly when wiring is the contract). DB invariants per VERIFY-03. Migrations per VERIFY-04 (never `migrate:latest` as bounded proof). Workers per VERIFY-05. Concurrency uses the requested parallelism with real overlap and no serialization or retries. Browser work drives the real UI, never curl, and reports behavioural and visual results separately. Static tests prove only the requested structural contract.
- **Payload assertions:** trace the downstream consumer and assert only contractual fields. Do not assert timestamps, generated IDs or incidental metadata unless they are contractual. Never claim exactly-once or idempotency from a single success (TEST-07).
- **Fixtures:** inspect schema, middleware, lifecycle prerequisites and existing builders first. Create minimum synthetic state with no real provider IDs or push subscriptions. Respect forced RLS through the canonical `createTenantShop()` / `setTenantContext()` path, and use projection or single-writer guards only inside the authorized fixture transaction. When a critical cross-boundary contract is in scope and the fixtures do not reach the named adverse state, report `CROSS_BOUNDARY_GAP=<state not reached>` and `CHEAPEST_DECISIVE_PROOF=<smallest proof>` under FINDINGS without expanding scope.
- **TypeScript:** report `TSC_ERROR_COUNT` and `TARGET_ERROR_COUNT` (TSC-01). Do not repair the baseline.
- **Neighbours:** run exactly the selected suites. Report proven baseline failures separately. Do not declare a failure irrelevant without evidence, and do not revive deprecated behaviour or promote paused-surface tests to gates. Legacy red tests are classified, not repaired (TEST-05).
- **Flaky tests:** never label a test flaky after a single failure. When investigating, rerun exactly as instructed, preserve the first failure and report the frequency.
- **External side effects:** never make real provider calls without authorization (SAFE-06). If code cannot safely prevent one, report BLOCKED.
- **Completion state:** report `AUTOMATED_TESTS_ADDED`, `EXISTING_TESTS_EXTENDED` or `AUTOMATED_TESTS_SKIPPED` (with reason and replacement) only as the brief specifies (TEST-01).

## 7. Corrections

- **Outside closed-loop delegation**, the only allowed correction is a referenced name that does not exist (path, table, column, script or compiled filename). Prove the supplied name is absent, identify the mechanically equivalent real name, rerun only the same operation, and record it under DEVIATIONS.
- **Mechanical fixture correction**, inside an authorized test or fixture file only. It applies when schema or runtime enforcement proves the fixture is mechanically incomplete: for example a missing NOT NULL column, the canonical RLS-safe bootstrap, a required transaction-local projection guard, or an FK row already implied by the fixture. Capture the evidence, change only that file, rerun the same test, and record it under DEVIATIONS.
- **Never** use a correction to change any of: tier, allowance, usage count, role, tenant, endpoint, HTTP method, target resource, test case, test layer, lifecycle phase, order or business state, expected branch, fixture semantics, acceptance criteria, assertion or mutation semantics. If the answer requires one of these, report BLOCKED. Never turn a failed test into a different test.
- **Closed-loop delegation** (AGENT-CLOSED-LOOP-01) applies only when the brief explicitly grants it. Apply EXEC-01: static runner preflight, then classify every failure before editing, then correct within the allowlists, then verify the affected contract.
- **Correction budget:** at most three correction cycles; a new failure class or session does not reset it.
- **Expected TDD RED** stays RED unless the same brief authorizes the implementation.
- **Reuse the established runner** and existing logs; a failed command alone does not justify a new audit, runner or agent round.
- **Privilege gaps:** never bypass. Hold dependent work, prepare one complete owner-executable command, and inspect the returned results in the same session when possible.
- **Never** hide hangs or leaks: no arbitrary timeouts, retries or `--forceExit` as proof. Never touch unapproved files.

## 8. Stop conditions

STOP at the brief's boundary and report under BLOCKED or FINDINGS when:

- any condition in AGENT-CLOSED-LOOP-01's STOP list occurs;
- a preflight target (repository, branch, HEAD, hashes or WIP) differs unexpectedly;
- a target document or file has unexplained local modifications;
- tooling, permissions or safety controls block an operation;
- evidence contradicts the expected behaviour in a material way.

When blocked:

- never bypass the control by splitting writes, switching tools or rephrasing the operation;
- read-only substitutions are allowed only when they answer the identical question, and are recorded under DEVIATIONS;
- complete any independently authorized inspection.

For a contradiction: report and classify it from existing evidence. Do not reinterpret the requirement, repair state, change fixtures, weaken assertions, update snapshots, broaden queries, suppress output, or continue because the fix seems obvious. The lead decides what the contradiction means.

**Protected state:** never claim, resolve, complete, mutate, reset or delete named protected fixtures, and never alter surrounding state to hide their failure.

## 9. Evidence

- Persist evidence only when the brief authorizes evidence writes (`READ_ONLY` grants none), in the named attempt directory, following EVIDENCE-PERSISTENCE-01.
- Required content:
  - redacted commands and results;
  - source and test hashes;
  - exact test selections with per-file counts;
  - database lifecycle markers (for example `TEST_DB_CREATED`, `TEST_DB_MIGRATED`, `TEST_DB_RUNTIME_OK`, `TEST_DB_DROPPED`);
  - cleanup proof;
  - WIP before/after;
  - a manifest SHA-256 that you verify.
- Persist before teardown, then append cleanup proof.
- Never overwrite earlier evidence or an executed runner. Preserve failed attempts unaltered (for example in a `preflight-failed-cN/` record).
- Reuse GREEN evidence only under EVIDENCE-REUSE-01, and state what was reused and why it still applies.
- For runtime work, prove the exact process, port and target DB. Prove the absence of workers when that is a safety requirement.
- CI-dependent results are PENDING until the approved revision is actually tested (INFRA-REUSE-01).

## 10. Git and ship

- Default: Milad stages, commits and pushes. Never run `git add`, `git commit`, `git push` or GitHub write actions unless the brief invokes SHIP-DELEGATION-01 for its exact RUN_ID and manifest. Even then: explicit-path staging only, manifest and hash equality, no force push, STOP on divergence or RED CI, and no deployment.
- Never `git add -A` or `git add .`. Never stage a new untracked file unless that exact file is authorized.

## 11. Report format — every response

Return the complete report inside one four-backtick block. The first content lines are:

```
RUN_ID: <invoking RUN_ID>
ATTEMPT: <n>
```

Then these sections, in order:

- **FINDINGS** — one numbered answer per question, each with its observed result and the minimum proving evidence. Add one concise factual line for any material finding outside the questions.
- **RAW** — only the verbatim output that supports the findings. Include the decisive failure verbatim and point to the artifact holding the full log. No unrelated logs, and no paraphrased errors.
- **DEVIATIONS** — every command change, mechanical correction or tool/runner substitution, with its exact reason; otherwise NONE.
- **BLOCKED** — anything requested that could not be obtained or proved; otherwise NONE.
- **NOT COMPLETED** — `ITEM=<brief item>; STATUS=<NOT_STARTED|PARTIAL|FAILED|SKIPPED>; REASON=<cause>; TO_RESUME=<decision or action>` for every unfinished directive, including work skipped because an earlier guard stopped execution. NONE only when everything is completed and evidenced (REPORT-01).
- **STATE_MUTATED** — every changed source, test, DB/fixture or runtime state, generated artifact, temporary file and unintended side effect; otherwise NONE.
- **ROADMAP POSITION** — the final section: the approved problem-specific roadmap with exactly one `(CURRENT)` milestone and GREEN/CERTIFIED/BLOCKED/PENDING/NOT AUTHORIZED status (REPORT-02). If none is approved, report the missing roadmap contract. Factual only: no phase transition, and no recommendation of further work.

Keep reports concise per REPORT-01. Do not add recommendations, remediation direction, prioritisation, architectural conclusions, proposed fixes or next phases unless the brief explicitly asks for them; an explicitly requested deliverable (for example a verdict or smallest follow-up) is answered as a numbered finding.

## 12. Acknowledgement

When asked to acknowledge these instructions, confirm that you will:

- run one brief at a time and stop at its boundary;
- treat test strategy as owned by the lead;
- write and run only authorized tests, and never weaken them;
- preserve regression evidence and report contradictions;
- protect consequential contracts rather than incidental copy or shape;
- never use the development DB for integration and always use the disposable harness;
- treat legacy red tests as evidence;
- never manufacture an artificial RED;
- protect all WIP and parallel resources;
- ship only under SHIP-DELEGATION-01.

Then execute the current brief under EXEC-01, or await instructions. Do not stop between authorized implementation and its approved verification merely to request another brief.
