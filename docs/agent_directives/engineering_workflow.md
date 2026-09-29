ENGINEERING WORKFLOW v3.2

Mode: Solo-developer, main-first execution

Effective: 2026-09-20

Primary repository: SynchroFlow

Operating principle: strongest evidence with the least coordination overhead.

CANONICAL FLOW

MAIN SYNC + CLEANLINESS GATE

→ ELI5

→ AUDIT

→ WORKSHOP [only when required]

→ TEST STRATEGY / REGRESSION CONTRACT

→ IMPLEMENT

→ TARGETED VERIFY

→ IMPLEMENTATION CORRECTION [only if required]

→ TARGETED VERIFY rerun

→ NEIGHBOUR REGRESSION

→ LIVE / DB / RUNTIME VERIFY [when required]

→ WORKFLOW DOCUMENTATION DECISION

→ DOC

→ COMMIT PRE-FLIGHT

→ COMMIT ON MAIN

→ PUSH + SHA CONFIRMATION

→ CI / DEPLOY

→ CI FAILURE TRIAGE [only if CI fails]

→ RISK-BASED PRODUCTION CERTIFICATION

→ ISSUE CLOSED

→ NEXT ISSUE

One issue at a time.

One phase at a time.

Tests belong to the issue they protect.

Not every issue requires automated tests.

Every test decision must be explicit.

Prefer executable invariants over manual memory.

Zero assumptions.

Evidence before conclusions.

⸻

1. CORE PRINCIPLE

The goal is not maximum test coverage.

The goal is permanent protection around behaviour whose silent regression could materially affect:

- merchant workflows;
- inventory correctness;
- fulfillment;
- billing;
- money;
- data integrity;
- authentication / authorization;
- tenant isolation;
- Shopify integrations;
- migrations;
- async delivery;
- launch reliability;
- critical UX flows.

Tests protect business and system contracts, not merely files.

Do not think:

We changed wms.controller.ts, so test wms.controller.ts.

Think:

We changed Pack behaviour. Which product, transaction, inventory, commercial, authorization, alert, outbox, and user-flow contracts depend on it?

⸻

2. SOLO MAINLINE OPERATING MODE

2.1 Default topology

Normal issue work happens directly on local main and pushes directly to origin/main.

Default:

origin/main

→ local main

→ audit

→ implementation

→ verification

→ commit

→ push main

→ CI/deploy

→ production certification

By default, do not create:

- an issue branch;
- a worktree;
- a pull request;
- a synthetic merge tree.

This repository is operated by one active developer unless explicitly stated otherwise. Isolation machinery must therefore justify its coordination cost.

2.2 Branch/worktree exceptions

A branch or worktree is allowed only when at least one of these is true:

- parallel development is genuinely happening;
- a risky multi-day experiment must remain isolated;
- an external reviewer explicitly requires a PR;
- the work cannot safely exist on main before external approval;
- a temporary branch is required by a provider, release, or migration process;
- Milad explicitly chooses isolation for the issue.

A large issue by itself is not enough reason.

If an exception branch is used, record why before creating it.

2.3 Main cleanliness gate

Before starting every issue, require:

BRANCH=main

HEAD aligned with origin/main

UNMERGED_FILES=0

UNEXPLAINED_DIRTY_FILES=0

CURRENT_ISSUE=NONE

If main is dirty:

1. classify every dirty file;
2. identify which issue or process owns it;
3. finish, intentionally preserve, or intentionally revert that state;
4. do not use a worktree merely to escape unexplained local state;
5. begin the next issue only after state is understood.

Never clean, reset, or overwrite unrelated dirty work merely to make the tree look clean.

2.3.1 Dirty-main forward-sync protocol

If local main is behind origin/main while carrying explained WIP:

1. fetch origin/main;
2. prove whether local main has diverged;
3. inventory tracked and untracked WIP;
4. compare WIP paths against incoming paths;
5. require zero unexplained non-generated overlap before fast-forwarding;
6. preserve pre-sync tracked/untracked WIP manifests;
7. remove only disposable generated workspace artifacts that block the fast-forward;
8. use git pull --ff-only;
9. prove local HEAD == origin/main;
10. prove tracked and untracked non-generated WIP manifests are unchanged.

Do not create a worktree merely because main is dirty when the dirty state is understood and a safe overlap audit can prove that a fast-forward will preserve it.

2.4 Mainline invariants

SOLO-MAIN-01

Normal issue execution happens directly on main.

SOLO-MAIN-02

No new issue begins while main contains unexplained dirty state.

SHIP-TREE-01

Final local verification must target the same lineage that will be pushed and deployed.

CI-TRIAGE-01

A red test must be classified against its current invariant before production source is changed.

DEPLOY-GATE-01

Direct-main does not mean uncontrolled production deployment. Required pre-push verification must pass before pushing consequential code, and production deployment should not outrun required CI. If the deployment pipeline can publish a red main commit before required CI finishes, treat that pipeline ordering as infrastructure debt and use the strongest required local gate until it is corrected.

⸻

3. ROLES

3.1 Engineering Lead — ChatGPT / Claude reasoning role

Owns:

- issue framing;
- audit strategy;
- architectural reasoning;
- product / UX reasoning;
- implementation scope;
- acceptance criteria;
- regression-contract definition;
- test-layer selection;
- neighbouring regression selection;
- judging evidence;
- deciding whether another audit round is necessary;
- deciding whether WORKSHOP is required;
- deciding whether tests are required, optional, or skipped;
- writing deterministic terminal commands;
- writing deterministic DOC commands;
- writing explicit staging, commit, push, and verification commands.

Must not:

- invent command results;
- treat intended behaviour as observed behaviour;
- strengthen a guarantee beyond what source/evidence proves;
- silently expand issue scope.

3.2 Code Agent — leverage execution layer

Use the agent when its leverage exceeds coordination cost.

Good agent tasks:

- multi-file source analysis;
- architecture tracing across many files;
- multi-file implementation;
- non-trivial refactors;
- regression-test implementation with substantial fixtures;
- cross-domain dependency analysis;
- large but bounded source audits;
- migration or worker analysis where autonomous navigation saves meaningful time.

Do not use the agent merely because a phase touches code.

The agent does not decide:

- architecture;
- UX;
- business behaviour;
- issue scope;
- test strategy;
- remediation direction.

3.3 Milad — decision maker / code approver

Milad:

- approves issue scope;
- approves workshop decisions;
- approves architecture decisions;
- approves material UX decisions and wireframes;
- performs or supervises live browser verification by default;
- runs normal-terminal commands;
- performs documentation mutation where requested;
- performs staging, commit, and push;
- approves movement to the next issue.

⸻

4. EXECUTION ROUTING — RECON FAST → VERIFY LOCAL → ESCALATE WHEN COMPLEX

Use the cheapest, safest, fastest path that gives strong evidence.

The default evidence progression is:

GitHub reconnaissance
→ local terminal confirmation
→ agent escalation only when complexity justifies it
→ executable/runtime proof
→ live browser where user-facing wiring matters

Discovery and proof are deliberately separated. A tool that efficiently locates likely ownership is not automatically authoritative for the current local worktree or runtime.

4.0 GitHub connector — fast repository reconnaissance

Use the GitHub connector before broad manual scans when the question is primarily:

- where a concept, contract, route, service, test, document, commit, or issue lives;
- whether an existing GitHub issue already owns a newly surfaced concern;
- which committed files on current repository main appear relevant;
- which prior commits or issues establish lineage or terminology;
- whether a canonical abstraction already exists.

Good GitHub reconnaissance tasks:

- code search across committed source;
- locating candidate source/tests/docs quickly;
- issue search before creating a duplicate;
- commit/history discovery;
- reading existing issue contracts;
- narrowing the local terminal audit to a small set of likely files.

GitHub connector findings are reconnaissance evidence, not final local proof.

Do not use GitHub connector results as authoritative proof of:

- current dirty-worktree contents;
- unstaged or untracked local changes;
- local migration state;
- local DB contents;
- current runtime behaviour;
- current generated artifacts;
- staged snapshot contents;
- test/build/typecheck success;
- production state unless the specific GitHub artifact itself is the contract under inspection.

Before source mutation, consequential GitHub findings must be confirmed against the local checkout when local state could differ.

Canonical rule:

GitHub tells us where to look.
The local terminal tells us what is actually true in the working environment.

4.1 VS Code / normal terminal is authoritative for

- Git state;
- branch/head verification;
- one to three targeted grep / sed probes;
- narrow filesystem inspection;
- SQL/curl evidence;
- targeted Jest execution;
- TypeScript checks;
- migration status;
- deterministic one-file or two-file edits;
- documentation edits;
- staging;
- commit;
- push;
- local/remote SHA verification.

4.2 Agent is preferred only when leverage exceeds coordination cost

Use an agent when at least one of these is true:

- multi-file implementation is required;
- regression fixtures are complex;
- bounded source tracing spans many files/domains;
- a non-trivial refactor is required;
- cross-domain impact analysis would otherwise require many manual passes;
- repetitive but bounded edits span many files;
- migration/worker/concurrency analysis benefits materially from autonomous navigation;
- local terminal + GitHub reconnaissance cannot answer the question confidently with a small number of targeted probes.

Do not use an agent merely to locate code or repeat reconnaissance already available cheaply through GitHub search plus targeted terminal commands.

Default escalation test:

Can GitHub reconnaissance + roughly 2–5 targeted local terminal probes answer the question confidently?

- YES → do not use an agent.
- NO → if deeper analysis requires multi-file reasoning, use an agent.

Agents are precision multipliers, not default scanners.

When an agent is used after reconnaissance, feed it the already-established files, invariants, and open questions so it spends effort on the difficult part rather than rediscovering the repository.

4.3 Live browser

Default executor: Milad, guided by the engineering lead.

A browser agent may prove mechanics when explicitly delegated, but cannot replace Milad's product/UX approval.

Reuse the current localhost before provisioning another runtime.

For visual-only acceptance, first inspect the already-running localhost.

If the required visual state is already present or can be reached safely in the current localhost, capture screenshots from that runtime and review them directly. Do not create a new account, seed fixtures, or start a disposable runtime solely to reproduce a visual state that already exists.

Escalate to a dedicated or disposable runtime only when it is needed to prove or safely reach the acceptance state, for example:

\- authentication, role, or tenant gating;

\- state transitions or CTA wiring;

\- persistence or reload behaviour;

\- backend/API/DB integration;

\- destructive or consequential mutations;

\- runtime isolation from parallel work;

\- or a target state that cannot be reproduced reliably in the current localhost.

Screenshots are visual evidence, not behavioural proof. They may satisfy the visual/UX gate when the relevant behaviour has already been proven separately, but they do not replace behavioural verification when wiring, state, persistence, authorization, or integration is the contract under test.

4.4 Agent brief format

Keep briefs small:

CONSTRAINTS

<bounded permissions / read-only or mutation scope>

COMMANDS / MUTATION

<targeted task>

NUMBERED QUESTIONS

1. ...

2. ...

3. ...

Prefer roughly 3–5 decisive questions.

4.5 Three-level audit routing

Use the smallest audit level that can establish the required facts.

LEVEL 1 — RECON

GitHub connector + a few targeted local terminal probes.

Use for:

- ownership discovery;
- locating source/tests/docs;
- existing-issue discovery;
- obvious contract mismatches;
- commit/lineage discovery.

LEVEL 2 — FOCUSED AUDIT — DEFAULT

GitHub reconnaissance
* local source confirmation
* targeted executable evidence where relevant.

Typical evidence:

- source;
- tests;
- Git state;
- API;
- SQL;
- runtime.

This is the normal audit depth for most issues.

LEVEL 3 — DEEP AUDIT

Add an agent when the bounded question requires:

- many cross-file dependencies;
- unfamiliar domain tracing;
- concurrency/idempotency analysis;
- broad architectural impact;
- many manual passes that an agent can replace safely.

Do not jump to Level 3 by default.

4.6 Discovery vs proof rule

Never let efficient discovery silently become proof of consequential behaviour.

For consequential claims, prefer two independent evidence classes where practical:

- static/structural evidence; and
- executable/runtime evidence.

Examples:

- route source + curl;
- service logic + targeted test;
- migration/query contract + SQL;
- frontend model/component + live browser;
- staged diff + targeted regression suite.

The second layer need not duplicate the first. It should prove the invariant from a different angle.

⸻

5. ENVIRONMENT PREFLIGHT

Run a small environment preflight once per issue before expensive verification.

Establish where relevant:

- correct repository root;
- expected branch;
- current HEAD;
- origin/main relationship;
- Git status;
- root dependency resolution;
- workspace dependency resolution for touched workspace;
- .env availability without printing secrets;
- DB reachability where DB work is involved;
- migration level where schema-dependent work is involved.

Do not automatically reinstall dependencies.

Do not automatically build.

Do not mutate environment until the missing prerequisite is proven.

A test failure caused by missing workspace dependencies is an environment failure, not automatically a code failure.

⸻

6. COMMAND SAFETY AND OUTPUT BUDGET

6.1 Output budget

Long-running or noisy commands should write to a temporary log:

command > /tmp/<issue>-<purpose>.log 2>&1

Surface only:

- exit status;
- suite/test totals;
- failing suite/test names;
- the decisive error block;
- relevant invariant evidence.

Avoid by default:

- entire Jest output;
- entire route manifests;
- entire large diffs;
- hundreds of grep matches;
- full-file dumps.

Expand only the failing or decision-relevant range.

6.2 Terminal-killing guards

Do not provide diagnostic shell commands that intentionally terminate Milad's interactive shell with a normal exit 1 path.

Prefer:

if <condition>; then

  echo "PASS"

else

  echo "FAILED_CONDITION"

fi

A child process such as Python may fail closed with raise SystemExit(...); that must not terminate the surrounding interactive shell.

6.3 Shell command blocks

Use command blocks that remain copy/paste safe even when they contain embedded Markdown or heredocs.

6.4 SQL command form

All SQL supplied for terminal execution must use heredoc form and include:

\pset pager off

...

\q

For mutations also use:

\set ON_ERROR_STOP on

Never rely on an interactive psql session as the primary command path.

⸻

7. PHASE 1 — ELI5

Before technical work, state the issue in simple operational terms:

- what the user/operator expects;
- what currently happens;
- why that difference matters;
- what must remain unchanged.

Keep this short.

ELI5 is not evidence. It defines the problem to audit.

⸻

8. PHASE 2 — AUDIT

8.1 Goal

Prove the current state before deciding what to change.

8.2 Audit principles

- use GitHub reconnaissance first when it can cheaply narrow ownership or lineage;
- confirm consequential repository findings locally before mutation;
- reproduce the defect or requirement;
- re-audit inherited issue claims before spending implementation effort;
- withdrawal is a valid result;
- do not implement a defect that no longer reproduces from memory;
- audit hypotheses as aggressively as inherited claims;
- stop once enough evidence exists for the next decision;
- identify neighbouring behaviour that could regress;
- determine whether a meaningful defect can become a permanent regression contract.

8.3 Audit must establish where relevant

- what is happening;
- where it happens;
- why it happens;
- affected route/service/DB/worker/UI surfaces;
- stable business invariant;
- regression surface;
- remaining uncertainty.

8.4 Regression-surface question

Every material issue should answer:

What existing behaviour could this change accidentally break?

Examples:

- WMS transaction state;
- inventory counters;
- usage counters;
- alerts;
- billing events;
- outbox state;
- auth;
- tenant isolation;
- frontend entitlement gates;
- Shopify installation;
- migration compatibility.

8.5 HTTP issues

When HTTP is affected:

1. inspect relevant route registration;
2. identify middleware;
3. identify handler;
4. exercise affected endpoint with a real token where practical;
5. test neighbouring affected endpoints where regression risk exists;
6. record status and relevant body.

Do not repeatedly dump the full route manifest when the route is already established.

8.6 Database issues

Canonical local environment comes from root ./.env.

Do not print:

- DATABASE_URL;
- PGPASSWORD;
- migration credentials;
- API secrets.

For normal tenant queries, set the relevant tenant context.

Verify actual schema before querying guessed columns or tables.

8.7 Filesystem rules

- rg may be unavailable;
- use grep, sed, ls, and targeted find where appropriate;
- quote globs such as --include='*.ts';
- avoid full-file dumps;
- prefer exact ranges and exact search terms.

8.8 Audit rounds

Default progression:

RECON
→ evaluate candidate ownership
→ FOCUSED LOCAL AUDIT
→ evaluate
→ DEEP AGENT AUDIT only if material uncertainty remains

If evidence is incomplete:

AUDIT round 1
→ evaluate
→ AUDIT round 2 only for missing facts

Do not fire one giant speculative audit covering every theory.

Do not ask an agent to rediscover facts already established through GitHub reconnaissance and local confirmation.

8.9 Audit exit condition

AUDIT ends when the engineering lead can state:

- current behaviour;
- root cause or current structural explanation;
- affected surfaces;
- regression surface;
- stable invariant where applicable;
- remaining uncertainty.

If that cannot be stated, AUDIT continues.

⸻

9. PHASE 3 — WORKSHOP

WORKSHOP is not mandatory.

9.1 Use WORKSHOP when

- behaviour changes;
- UX changes materially;
- architecture changes;
- data-flow boundaries change;
- transaction boundaries change;
- multiple valid implementation patterns exist;
- domains are being combined;
- the simple fix would create future debt;
- testing requires a new architectural seam;
- Milad explicitly requests it.

9.2 Workshop rules

Start from what is already wired.

Inspect sibling/canonical implementations before inventing a new pattern.

Present:

- realistic options;
- trade-offs;
- recommendation;
- risks;
- explicit non-goals.

9.3 Stable contracts

When WORKSHOP occurs, identify the invariants future code must preserve.

Examples:

- rejected Pack completion causes zero side effects;
- only newly over-cap units may be billed;
- provider delivery remains asynchronous;
- inventory movements remain append-only;
- tenant isolation remains enforced.

These become input to TEST STRATEGY.

9.4 Canonical UI rule

For an inconsistent UI element:

1. find the canonical implementation;
2. establish typography, spacing, tokens, icons, alignment, borders, hover state, interaction;
3. reuse that language instead of approximating it.

Material restructuring:

WORKSHOP

→ wireframe

→ Milad approval

→ IMPLEMENT

Tiny approved copy/style corrections may skip full workshop after a narrow factual preflight.

⸻

10. PHASE 4 — TEST STRATEGY / REGRESSION CONTRACT

This is a required decision for every issue.

Automated tests are not automatically required.

10.1 Classify relevant layers

For each issue classify as REQUIRED / OPTIONAL / SKIP:

- UNIT;
- API INTEGRATION;
- DB INVARIANT;
- MIGRATION;
- WORKER / OUTBOX;
- CONCURRENCY;
- PLAYWRIGHT;
- ARCHITECTURE / STATIC;
- LIVE BROWSER;
- PROVIDER E2E.

Also choose a production certification level:

- NONE;
- CI_ONLY;
- RUNTIME_SMOKE;
- DB_INVARIANT;
- LIVE_BROWSER;
- PROVIDER_E2E.

10.2 Default test selection

Change type

Default protection

Pure calculation / business rule

Unit

HTTP route / middleware / controller

API integration

Transaction / RLS / counters / inventory / alerts

Real Postgres integration

Migration / schema / DB function

Scratch migration

Worker / retry / outbox

Worker integration

Concurrency / atomic claim

Concurrent integration

Important frontend interaction

Playwright or live browser depending wiring risk

Pure visual / copy correction

Live browser; automation usually skipped

Canonical architectural rule

Architecture/static contract

Previously working behaviour broke

Regression test strongly expected

Docs-only change

Automated tests normally skipped

Choose the lowest-cost layer that proves the invariant.

Add higher integration only when wiring itself is materially risky.

10.3 Defect regression rule

For a confirmed meaningful defect:

AUDIT

→ reproduce defect

→ define regression contract

→ add failing regression test where practical

→ IMPLEMENT

→ failing test turns green

→ selected neighbouring contracts remain green

Do not manufacture RED by reverting already-correct verified production behaviour.

If RED-first is unsuitable, record why.

10.4 Test completion state

Every issue ends with one of:

AUTOMATED_TESTS_ADDED

or:

EXISTING_TESTS_EXTENDED

or:

AUTOMATED_TESTS_SKIPPED

Reason: <specific reason>

Verification replacement: <what proves correctness>

No silent omission.

10.5 Permanent contract rule

Good:

- Starter order 51 must not complete;
- rejected Pack completion must not increment usage;
- billing/overage must not enter generic dispatch;
- affected order with unresolved Pick deficit must not become executable Pack work.

Weak:

- function X calls helper Y.

Test implementation shape only when that shape itself is an architectural contract.

10.6 Test value

A red legacy test is not automatically a product defect.

Before repairing it:

1. identify the invariant it protects;
2. verify the invariant is still relevant;
3. classify the test;
4. update/delete/replace the test if it protects obsolete behaviour.

Classifications:

- ACTIVE;
- SHARED / INFRA;
- PAUSED;
- DEPRECATED;
- UNCLEAR.

Do not revive deprecated product behaviour merely to make Jest green.

10.7 Test-case economy

Protect the invariant with the minimum decisive cases.

Use parameterized tests when assertion semantics genuinely repeat.

Do not collapse distinct business branches merely to reduce test count.

10.8 Contractual vs incidental assertions

Prefer assertions for:

- fields consumed by downstream business behaviour;
- machine-readable error codes;
- durable routing facts;
- security/tenancy facts;
- values explicitly defined as product/provider contracts.

Avoid freezing:

- debugging metadata;
- generated IDs;
- timestamps;
- serialization order;
- human-readable prose;
- incidental fields.

10.9 Semantic strength rule

Do not claim exactly-once, idempotency, replay safety, retry safety, or concurrency safety unless the mechanism that guarantees it is identified and tested.

One successful write is not automatically exactly-once.

One outbox row is not automatically provider idempotency.

10.10 API integration factory rule

Prefer:

createApp()

+ supertest request(app)

when route/middleware behaviour is the contract.

Do not import process bootstrap unless process startup itself is under test.

⸻

11. CURRENT TEST INFRASTRUCTURE CONTRACT

11.1 Safe DB-free foundation

Canonical default:

npm test

Equivalent safe foundation:

npm run test:foundation

Expected foundation:

test:prepare

→ build:deps

→ test:config

→ test:db-safety

→ test:contract

This path must remain DB-free.

test:prepare may generate ignored workspace build output required for package resolution. It must not create tracked modules/*/dist or packages/*/dist artifacts.

It must not reset, migrate, or seed the normal development DB.

11.2 Jest ownership

Every .test.ts / .test.tsx belongs to exactly one configured Jest project.

Required invariant:

UNOWNED=0

MULTI_OWNED=0

Validate when test files are added or moved:

npm run test:config

Do not treat fixed test counts as a permanent contract.

11.2.1 Generated workspace artifact ownership

Canonical invariant:

TRACKED_WORKSPACE_DIST=0

modules/*/dist and packages/*/dist are generated-only, ignored workspace outputs.

Validate with:

npm run check:generated-artifacts

test:config includes this generated-artifact ownership guard.

Source, configuration, tests, and explicit build steps are authoritative. Never use committed workspace dist as a runtime, type-resolution, CI, or deployment fallback.

11.3 Disposable backend integration DB

Canonical targeted path:

npm run test:integration -- --testPathPatterns <pattern>

Expected lifecycle:

generate synchroflow_test_*

→ fail-closed safety validation

→ create with migration role

→ migrate from empty

→ execute application behaviour as restricted role

→ run selected tests serially

→ drop exact generated DB

→ prove cleanup

The normal development DB is never the automated integration scratchpad.

11.4 Cleanup proof

A successful integration run is not complete until cleanup is proven where the harness requires it:

- exact generated DB dropped;
- zero orphan synchroflow_test_* DBs remain;
- normal PGDATABASE still exists.

11.5 Frontend suite

Historical frontend failures are triaged by current invariant relevance.

Do not make obsolete copy/DOM-shape assertions a release gate merely because they already exist.

11.6 Playwright

Playwright remains explicit and separate from the disposable Jest integration DB unless deliberately wired otherwise.

Prepare its environment deliberately.

11.7 Open-handle debt

Existing --forceExit compatibility is not proof of healthy process ownership.

Do not hide a newly introduced open handle behind an existing warning.

⸻

12. PHASE 5 — IMPLEMENT

Never implement in the same response as the AUDIT or WORKSHOP that established a material design decision.

12.1 Small-slice rule

Large issues may use manageable slices under one issue:

Slice A

→ verify

Slice B

→ verify

Slice C

→ verify

→ DOC once

→ COMMIT once unless there is a specific reason otherwise

Do not create a separate later testing sprint.

12.2 Implementation scope

Every implementation brief states:

- files allowed to mutate;
- tests allowed to mutate;
- state that must not mutate;
- behaviour that must remain unchanged;
- exact requested outcome;
- regression contract being implemented.

12.3 No unrelated cleanup

Do not combine unrelated fixes.

When an unrelated defect is discovered:

- classify it;
- create/defer to a separate issue when needed;
- do not contaminate the current implementation unless it is a proven blocker.

12.4 Source preflight

Before mutation, establish the exact boundary if not already known.

Do not re-audit facts established minutes earlier unless state changed.

12.5 Mutation mechanism

Prefer:

- precise Python heredoc;
- precise agent edit;
- another deterministic bounded method.

Avoid whole-file rewriting when narrow replacement is enough.

12.6 Testability seams

A small seam is allowed when it improves production architecture and enables safe verification.

No test-only production behaviour.

No hidden environment bypass unless explicitly designed.

12.7 Builds — fail closed

Do not run ad hoc application/module builds unless explicitly authorised for that specific verification boundary.

There is no standing permission for manual build commands.

Invoking a canonical repository command that explicitly owns prerequisite generation — for example npm test, npm run test:foundation, or npm run dev — also authorizes the prerequisite workspace build declared by that command (test:prepare / dev:prepare → build:deps). Do not separately ask for permission for the build that is part of the already-authorized canonical command.

Approval of one ad hoc dev-runtime build does not authorize another later in the issue.

TypeScript --noEmit checks are not treated as builds.

Workspace build output under modules/*/dist and packages/*/dist is generated-only and ignored. Never stage it.

If another authorised build changes a different class of committed generated output, report that set and apply the owning artifact policy before staging.

12.8 TypeScript baseline

Capture a baseline once per issue or when environment/build state changes.

For subsequent checks report:

TSC_ERROR_COUNT=<current total>

TARGET_ERROR_COUNT=<errors in touched surface>

Existing unrelated errors are not current issue failures.

TARGET_ERROR_COUNT > 0 is a failure.

⸻

13. PHASE 6 — VERIFY + REGRESSION

Verification answers three questions.

13.1 A — Did the requested behaviour work?

Use the strongest appropriate evidence:

- API;
- SQL;
- test;
- worker execution;
- browser;
- migration rehearsal;
- provider sandbox when required.

13.2 B — Did the permanent regression contract pass?

Run selected tests from TEST STRATEGY.

Report explicit layer results.

13.3 C — Did neighbouring consequential contracts remain intact?

Run only the neighbouring suites selected during TEST STRATEGY.

Do not run the whole repository after every small correction.

13.4 Two-level verification model

Level 1 — issue gate

Run:

- new/changed contract;
- relevant neighbouring regressions;
- affected TSC;
- DB/runtime/browser evidence where applicable.

Level 2 — release/CI gate

Run broader foundation/deep suites according to risk or CI requirements.

The full repository suite is not a ritual after every targeted pass.

13.5 Database invariants

For transaction-sensitive work, assert post-state, not only HTTP status.

A rejected request may require proving:

- state unchanged;
- counters unchanged;
- timestamps unchanged;
- no alert;
- no billing event;
- no outbox row.

13.6 Migration verification

Where applicable verify:

- compile;
- fresh scratch migration;
- bounded UP;
- bounded DOWN when required;
- schema assertions;
- grants;
- restricted-role runtime proof.

migrate:latest does not prove independent shippability of a specific migration.

13.7 Worker/outbox verification

Where applicable verify:

- claim;
- success;
- failure;
- retry;
- backoff;
- concurrency;
- stale-claim recovery;
- already-published behaviour;
- provider idempotency assumptions.

13.8 Live user-facing verification

For user-facing work, browser verification is mandatory unless explicitly justified otherwise.

Milad verifies:

- hierarchy;
- semantics;
- visual consistency;
- information density;
- interaction;
- whether the UX actually feels correct.

Do not substitute curl for UI wiring when UI wiring itself is under test.

For visual verification, prefer the lowest-cost faithful evidence:

1\. reuse the current localhost when it already exposes the required state;

2\. capture screenshots for visual/UX review;

3\. provision additional fixtures, accounts, or disposable runtimes only when the required state cannot be reached safely/reliably or when behavioural mechanics must also be proven.

Do not rebuild an environment merely to obtain a screenshot of a state that is already available in a trustworthy localhost runtime.

Behavioural PASS and visual PASS are separate. A screenshot can prove visual composition; it does not by itself prove state transitions, persistence, authorization, API wiring, or other behavioural contracts.

13.9 Partial verification

If a flow stops before the acceptance boundary:

PARTIAL / NOT VERIFIED

Do not inherit proof from an old location after rewiring a control unless the new wiring has been exercised.

13.10 Correction loop

A VERIFY failure returns to the smallest necessary loop:

VERIFY failure

→ isolate failing fact

→ narrow read-only audit

→ IMPLEMENT correction

→ TARGETED VERIFY

Do not restart the entire issue unless evidence invalidated the original audit/design.

13.11 Exit to WORKFLOW DOCUMENTATION DECISION

Do not advance to WORKFLOW DOCUMENTATION DECISION until:

- requested behaviour passes;
- selected permanent tests pass;
- relevant neighbouring regressions pass;
- required live browser acceptance passes;
- no unresolved acceptance failure remains.

⸻

14. PHASE 7 — WORKFLOW DOCUMENTATION DECISION

Before entering DOC, the engineering lead must explicitly decide whether the current issue introduced or changed any workflow preference, rule, or agent behavior.

14.1 Required decision

For every issue, answer:

- Did this issue change how we work (workflow)?
- Did this issue change what the agent is allowed or expected to do?
- Did this issue introduce a new standing rule or preference?

If the answer to any is YES:

1. Update `docs/agent_directives/engineering_workflow.md` in the same issue/ship.
2. If agent behavior changed, also update `docs/agent_directives/agent_operation_guidelines.md`.
3. These updates must be committed and pushed under the next ship (normally the same commit as the issue’s implementation, unless the issue is documentation-only and the update is itself the issue).
4. Do not rely on chat history or memory for workflow rules.

If the answer to all is NO:

- Explicitly record: `WORKFLOW_DOC_UPDATE_REQUIRED: NO`
- Proceed to DOC.

If YES:

- Explicitly record: `WORKFLOW_DOC_UPDATE_REQUIRED: YES`
- Perform the updates before DOC, or defer them to a dedicated documentation issue only if the engineering lead explicitly approves deferral and records the issue ID.

14.2 Prohibition

Do not proceed to DOC without making and recording this decision.

Failure to make this decision blocks DOC.

14.3 Rationale

Workflow and agent directives are the single source of truth. Keeping them current prevents repeatedly setting the same preferences and ensures every future issue inherits the latest agreed process.

⸻

15. PHASE 8 — DOC

Documentation happens after implementation and verification are accepted.

15.1 Default executor

Normal terminal.

Use deterministic Python for mutation when appropriate.

15.2 Documentation mutation pattern

1. read-only anchor preflight;
2. deterministic mutation;
3. assert unique anchor;
4. refuse duplicate section;
5. write;
6. confirm section exists once;
7. report location;
8. run whitespace/diff checks;
9. verify status.

15.3 Untracked file caveat

git diff and git diff --check do not inspect untracked files.

Before staging a new file, verify its content directly.

After explicit staging, git diff --cached --check becomes authoritative for staged whitespace.

15.4 Documentation content

Capture only verified facts:

- stable contract;
- invariant;
- architecture;
- important reasoning;
- traps future engineers could repeat;
- deliberate exclusions;
- deferred issue IDs;
- verification boundary;
- regression protection.

Distinguish runtime acceptance from automated regression evidence.

Do not document intended behaviour that failed verification.

Prefer one authoritative playbook over redundant updates across many docs.

⸻

16. PHASE 9 — COMMIT & PUSH ON MAIN

Agent involvement ends before staging/commit/push.

16.1 Commit preflight

Before staging:

1. declare exact target filenames;
2. show their status;
3. stage those filenames only;
4. print the full staged file list;
5. compare staged scope against expected scope;
6. run git diff --cached --check;
7. show staged stat;
8. show remaining unstaged files.

Never use:

git add -A

or:

git add .

16.2 Tests ship with the feature

Regression tests belong in the same issue and normally the same intended commit as the feature/fix they protect.

16.3 Generated output

modules/*/dist and packages/*/dist are generated-only and must never be staged or committed.

Before commit, require:

npm run check:generated-artifacts

and prove:

TRACKED_WORKSPACE_DIST=0

A local build may recreate ignored workspace dist; that does not expand commit scope.

For any other generated artifact class that is intentionally version-controlled, follow its explicit owning policy and stage only the complete intended generated set.

16.4 Commit message

Include what is useful:

- issue ID/reference;
- merchant/technical outcome;
- meaningful boundary;
- critical non-goal when necessary.

Do not turn the commit body into the entire playbook.

16.5 Ship-tree proof

Immediately before commit, the verified tree must be the tree intended to ship.

After commit capture:

COMMIT_SHA=<sha>

Push that commit directly to origin/main in normal solo-main mode.

After push require:

LOCAL_SHA=<sha>

REMOTE_SHA=<sha>

LOCAL_SHA  REMOTE_SHA

PUSH_CONFIRMED

A push alone is not issue closure when CI/deploy/certification remain required.

⸻

17. PHASE 10 — CI / DEPLOY

CI is a verification layer, not an instruction to blindly repair anything red.

17.1 CI failure triage — classify first

Every CI failure must be classified before source mutation.

Classification

Meaning

Default action

CURRENT_ISSUE_REGRESSION

Current change broke a relevant invariant

Return to smallest correction loop

STALE_CONTRACT

Test protects retired implementation/behaviour

Audit invariant; update/delete/replace contract

MAINLINE_REGRESSION

Existing main behaviour is genuinely broken

Separate issue/blocker

ENVIRONMENT_FAILURE

Dependency/config/runtime prerequisite failed

Correct environment only

FLAKY_INFRA

Same tree passes/fails nondeterministically

Reproduce and track infra

UNRELATED_ACTIVE_FAILURE

Real but outside current issue

Separate issue; do not contaminate scope

UNKNOWN

Evidence insufficient

Narrow audit

Never change production source merely because CI is red.

17.2 Stale contract rule

For a failing historical contract:

1. identify the invariant;
2. identify the current canonical owner;
3. determine whether behaviour or only ownership changed;
4. update the test to protect the current invariant;
5. update stale documentation if it names retired ownership;
6. avoid restoring retired source merely to satisfy a stale assertion.

17.3 Mainline CI blocker rule

If CI discovers an unrelated active blocker after a direct-main push:

classify blocker

→ create separate blocker issue when appropriate

→ fix directly on main

→ targeted verify

→ commit

→ push

→ CI rerun

Do not create a worktree/PR chain solely to repair a mainline CI blocker.

History may simply become:

A — feature/fix

B — CI contract/infrastructure correction

17.4 Same-tree principle

Direct-main development should keep:

VERIFY_SHA ≈ COMMIT_SHA = PUSH_SHA

Avoid unnecessary synthetic merge trees that were never locally verified.

17.5 Deployment ordering

For consequential runtime changes, deployment should depend on the required CI gate rather than racing it.

If current infrastructure deploys every push to main immediately, the pre-push issue gate becomes release-critical: do not push until all locally selected consequential checks are green. Track CI-before-deploy ordering as infrastructure work rather than reintroducing routine PR/worktree overhead solely to compensate.

17.6 Source-authoritative CI / deploy

CI and deployment must build required workspace dependencies from source in dependency order. They must not rely on pre-existing or committed workspace dist.

Where a targeted workflow bypasses the repository-wide build:deps path, every required prerequisite workspace must be explicit in that workflow.

A missing generated package output in a fresh clone is evidence of a dependency-order/build-contract gap, not a reason to recommit dist.

When simulating fresh-clone artifact state locally, remove both generated workspace dist and stale incremental TypeScript build metadata (*.tsbuildinfo) before judging whether the source-authoritative build is valid.

17.7 CI scope

Fast gates should prioritize:

- TypeScript;
- unit/contract tests;
- architecture checks;
- critical API/DB integration;
- migration smoke;
- commercial/security invariants;
- other high-value targeted contracts.

Deep suites belong on main/nightly/release candidate/pre-submission according to cost and risk.

⸻

18. PHASE 11 — RISK-BASED PRODUCTION CERTIFICATION

Certification level is selected during TEST STRATEGY.

18.1 Levels

NONE

Use for changes with no runtime or release consequence, when explicitly justified.

CI_ONLY

Use for examples such as:

- stale test ownership correction;
- docs-only correction;
- non-runtime architecture contract maintenance.

Do not replay merchant workflows for a test-only change unless another reason requires it.

RUNTIME_SMOKE

Use when runtime wiring changed but deep state verification is unnecessary.

DB_INVARIANT

Use when persistence/state-transition correctness must be certified in deployed runtime.

LIVE_BROWSER

Use for user-facing workflow changes requiring real UI acceptance.

PROVIDER_E2E

Use only when real provider acceptance is part of the contract.

18.2 Production SQL

Before any production repair:

- read-only inspection first;
- narrow tenant/predicate scope;
- no guessed schema;
- mutation only after evidence proves the required repair;
- mutation must fail closed;
- verify exact post-state.

18.3 Issue closure

An issue closes only when every selected gate is complete:

IMPLEMENTATION_ACCEPTED

+ TEST_CONTRACT_SATISFIED

+ TARGETED_REGRESSION_ACCEPTED

+ LIVE/DB/RUNTIME ACCEPTED where required

+ DOC COMPLETE

+ COMMIT COMPLETE

+ PUSH_CONFIRMED

+ CI ACCEPTED where required

+ DEPLOY ACCEPTED where required

+ PRODUCTION_CERTIFICATION ACCEPTED at selected level

Then:

ISSUE CLOSED

→ NEXT ISSUE

⸻

19. FIXTURE STRATEGY

Prefer the smallest deterministic fixture that proves the contract.

Extract reusable fixture builders only when multiple suites genuinely share stable semantics.

Fixtures should:

- use real schema;
- create minimum valid state;
- avoid provider side effects unless required;
- expose meaningful defaults;
- support boundary testing;
- clean up deterministically.

19.1 RLS-safe bootstrap

Respect real tenant protections.

Reuse canonical tenant bootstrap/context paths.

Do not disable RLS globally for test convenience.

Do not use migration-role bypass for application behaviour expected to run as restricted application role.

19.2 Guarded/single-writer tables

If a fixture touches a guarded table:

- prove the guard and sanctioned write path;
- prefer canonical writer;
- use transaction-local fixture mechanisms only when explicitly supported;
- never disable guards globally;
- do not change business semantics merely to satisfy fixture mechanics.

19.3 Thresholds

Test around consequential boundaries where relevant:

limit - 1

limit

limit + 1

Use parameterization only when it improves clarity.

Property/mutation testing remains optional advanced protection for high-value rules.

⸻

20. DATABASE STANDING RULES

20.1 Normal standalone DB queries

Source root .env without printing secrets.

Construct connection material only in-process/local shell where required.

Application behaviour uses the restricted application role.

Every terminal SQL command uses heredoc with:

\pset pager off

<tenant context when required>

...

\q

Mutation commands additionally use:

\set ON_ERROR_STOP on

20.2 Disposable integration DBs

For backend API/DB integration use the canonical disposable harness.

Safety expectations:

- NODE_ENV=test;
- generated DB differs from normal PGDATABASE;
- migration/runtime roles are separated;
- DB administration uses migration role;
- application execution uses restricted role;
- migrations run from empty;
- no implicit global seed;
- cleanup proves exact removal and zero orphans.

20.3 Scratch migration rehearsals

Use privileged migration URL and restricted application URL against the same scratch DB where required.

Create/drop/migrate scratch databases with migration role, never the restricted application role.

20.4 Bounded migration proof

To prove migration N independently:

- use isolated scratch DB;
- apply migrations sequentially only through N;
- assert N recorded;
- assert later migration absent;
- assert schema/grants/runtime behaviour.

Do not use only migrate:latest as proof of independent shippability.

⸻

21. STANDING RULES

1. One issue at a time.
2. One phase at a time.
3. Phase separation is mandatory for material decisions.
4. Normal solo-development work happens directly on main.
5. No branch/worktree/PR by default.
6. Isolation requires an explicit reason.
7. No new issue begins with unexplained dirty main state.
8. Tests are part of the issue they protect.
9. Every issue gets an explicit test-strategy decision.
10. Automated tests are not mandatory for every issue.
11. Skipping automation requires a reason and replacement verification.
12. Protect invariants, not files.
13. Prefer the cheapest test layer that proves the invariant.
14. Add higher-level tests when wiring itself is risky.
15. Meaningful regressions should leave permanent protection where practical.
16. Historical red tests are triaged by current invariant relevance before repair.
17. A red CI job is classified before source mutation.
18. Never restore retired product behaviour merely to satisfy a stale contract.
19. Environment failures are not automatically product failures.
20. Run a small environment preflight once per issue before expensive verification.
21. Use terminal first; use agents when leverage exceeds coordination cost.
22. Keep agent rounds small and decisive.
23. Do not use agents for trivial one/two-file deterministic work when terminal is stronger.
24. Live UI verification is Milad-driven by default.
25. Do not substitute curl for UI wiring when UI wiring is under test.
26. Behavioural PASS does not override visual FAIL.
27. A failed verification returns to the smallest necessary correction loop.
28. Do not rerun the entire repository after every small correction.
29. Use targeted issue gate first; broader release/CI gate second.
30. Write noisy command output to /tmp and surface only decisive evidence.
31. Avoid terminal-killing diagnostic guards.
32. All supplied SQL is heredoc-based with pager off and explicit quit.
33. Production SQL is read-only before repair and mutations are narrow/fail-closed.
34. Ad hoc builds require explicit per-build authorization; canonical commands may own prerequisite build:deps generation.
35. Ad hoc build authorization never becomes standing permission.
36. TypeScript --noEmit is not a build.
37. Never clean/reset unrelated dirty state.
38. Never stage implicitly.
39. Never use git add -A or git add . in issue preflight.
40. New untracked docs/tests require direct pre-stage verification.
41. Tests ship with the feature they protect.
42. Final local verification targets the lineage intended to ship.
43. Push proof requires local SHA  remote SHA and PUSH_CONFIRMED.
44. Push alone does not close an issue when CI/deploy/certification remain.
45. Certification level is risk-based, not ceremonial.
46. Test-only/docs-only changes normally do not require merchant workflow replay.
47. User-facing behavioural changes normally require live browser certification.
48. Transaction-sensitive changes require post-state evidence, not only HTTP status.
49. inventory_movements remains append-only; compensate, never delete.
50. Avoid mocks where safe real local boundaries are practical.
51. Never call live Stripe/Shopify merely to prove an internal state-machine contract.
52. Provider E2E is separate when external acceptance is actually required.
53. Every Jest test has exactly one configured owner.
54. Disposable backend integration uses synchroflow_test_*, never normal development DB.
55. Disposable integration cleanup must be proven.
56. Do not claim exactly-once/idempotency/concurrency guarantees without testing the mechanism.
57. Prefer createApp() + supertest for route integration when process startup is not the contract.
58. Protect contractual payload/state fields, not incidental metadata.
59. Use minimum decisive test cases.
60. Deferred consequential work receives an issue ID and reason.
61. Documentation describes verified contracts, not intended ones.
62. Prefer one authoritative playbook over redundant copies.
63. Merchant vocabulary is intentional; prefer merchant goals over internal object names.
64. For UI consistency, find the canonical pattern before inventing another.
65. One developer does not justify multi-developer coordination machinery by default.
66. Direct-main does not waive CI/deployment safety; consequential pushes require the selected local gate to be green before push.
67. Production deployment should not outrun required CI; pipeline ordering that allows this is infrastructure debt.
68. modules/*/dist and packages/*/dist are generated-only, ignored, and never committed.
69. TRACKED_WORKSPACE_DIST=0 is a repository invariant enforced by npm run check:generated-artifacts.
70. CI/deploy must build workspace dependencies from source and must not rely on committed dist.
71. Dirty-main fast-forward is allowed only after an overlap audit proves explained WIP will be preserved.
72. Use GitHub connector for fast committed-repository reconnaissance when it can reduce manual scanning.
73. GitHub connector findings do not supersede the local dirty worktree; consequential findings are locally confirmed before mutation.
74. Default audit depth is focused: GitHub recon + targeted terminal proof.
75. Escalate to an agent only when multi-file reasoning materially saves effort or local probes are insufficient.
76. Agents are not default scanners.
77. Feed agents established files, invariants, and unanswered questions instead of paying them to rediscover repository context.
78. Separate discovery from proof.
79. For consequential behaviour, prefer static evidence plus executable/runtime evidence where practical.
80. New attention-needing work discovered outside the current issue is routed to an existing GitHub issue or a new bounded issue; it does not drift the active issue.
81. Every issue must make an explicit WORKFLOW DOCUMENTATION DECISION before DOC: determine whether `docs/agent_directives/engineering_workflow.md` and/or `docs/agent_directives/agent_operation_guidelines.md` require updates, and record the decision.

82. Prefer screenshots from an already-running localhost for visual-only acceptance when it faithfully exposes the target state; do not provision accounts, fixtures, or disposable runtimes solely to reproduce visual evidence that is already available.

⸻

22. STARTING A NEW ISSUE

1. Confirm local branch is main.
2. Fetch/verify origin/main alignment.
3. Confirm no unmerged files.
4. Classify any dirty files; require no unexplained dirty state.
5. State issue ID.
6. State one-paragraph problem statement.
7. Run ELI5.
8. Run the small environment preflight relevant to the issue.
9. Enter AUDIT.
10. Use GitHub reconnaissance first when it can cheaply narrow source/issue/commit ownership.
11. Confirm consequential findings with targeted local terminal probes.
12. Judge evidence.
13. Escalate to a bounded agent audit only if material uncertainty remains.
14. Run another narrow audit only for missing facts.
15. Run WORKSHOP only when required.
16. Define stable contracts/invariants.
17. Enter TEST STRATEGY.
18. Classify relevant test layers REQUIRED / OPTIONAL / SKIP.
19. Select production certification level.
20. For confirmed defects, add RED regression first where practical.
21. IMPLEMENT one manageable slice.
22. Add/extend selected tests in the same issue.
23. Run targeted technical checks.
24. VERIFY requested behaviour.
25. Run selected neighbouring regressions.
26. Run browser/DB/runtime verification where selected.
27. If anything fails, use the smallest correction loop.
28. Make WORKFLOW DOCUMENTATION DECISION: update `docs/agent_directives/engineering_workflow.md` and/or `docs/agent_directives/agent_operation_guidelines.md` if required, or explicitly record NO update needed.
29. When accepted, run one DOC pass.
30. Record test completion state.
31. Run generated-artifact ownership guard when workspace/package build state is relevant.
32. Run commit preflight with exact intended files only.
33. COMMIT on main.
34. Capture commit SHA.
35. PUSH main.
36. Confirm local SHA  remote SHA.
37. Require PUSH_CONFIRMED.
38. Observe CI/deploy where required.
39. If CI fails, classify before changing source.
40. Complete selected production certification.
41. Close issue only after all selected gates pass.
42. Begin the next issue.

⸻

23. FINAL ISSUE-CLOSE CHECKLIST

Before an issue may be marked CLOSED:

- main cleanliness/start gate was satisfied;
- ELI5 complete;
- environment preflight completed where relevant;
- AUDIT complete;
- WORKSHOP complete or explicitly unnecessary;
- stable invariants identified;
- TEST STRATEGY decided;
- certification level selected;
- required automated tests added/extended, or explicitly skipped with reason;
- implementation accepted;
- targeted TSC/build checks accepted;
- requested runtime behaviour verified;
- DB invariants verified where relevant;
- migration behaviour verified where relevant;
- worker/concurrency behaviour verified where relevant;
- neighbouring regression suite passes;
- Jest ownership valid when tests were added/moved;
- disposable integration DB cleanup proved when harness used;
- live browser verification accepted where applicable;
- behavioural and visual acceptance both pass where applicable;
- WORKFLOW DOCUMENTATION DECISION made and recorded (update applied or explicit NO);
- documentation describes verified final contract;
- generated workspace artifact ownership valid where relevant (TRACKED_WORKSPACE_DIST=0);
- staged scope exact;
- staged diff check clean;
- commit complete;
- push complete;
- local SHA  remote SHA;
- PUSH_CONFIRMED;
- CI/deploy accepted where selected;
- CI failures, if any, were classified rather than blindly repaired;
- selected production certification completed.

Only then:

ISSUE CLOSED

→ NEXT ISSUE