# LaSyncro — Entity Detail Modal Playbook

> **Scope:** The shared "view and act on one entity without leaving the module" modal pattern — covers the shared shell component, and the per-entity Order, Member, Variant/Product, and Batch consumer status. Created 2026-06-28 out of the original ask: three new large-modal surfaces for Order/Member/Product detail.
> **Companion docs:** `docs/playbooks/cta-deeplink-playbook.md` (deep-link contract — ORD-01/02/03 below are also tracked there), `docs/playbooks/modules-ux-playbook.md` (CTA visual tiers, used by this shell).
> **Status legend:** ✅ done · 🔴 open · 🟡 open, lower priority

---

## 1. The shared shell — ✅ built

`modules/shared/src/ui/EntityDetailModal.tsx`, exported from `@lasyncro/shared/ui`.

Centered `Dialog`, large (`maxWidth="lg"` default), FT2 card-shell tokens (`var(--surface)`, `1px solid var(--rule)`, `borderRadius: '14px'`) rather than MUI's default Paper — chosen deliberately because **no prior large-content-dialog precedent existed anywhere in this codebase** (checked: every existing `<Dialog>` usage found — `ProblemCenterModuleFT2.tsx`, `MembersPage.tsx` — was a small action-form dialog, `maxWidth="sm"`/`"xs"`). This is the first one; don't let a future small-form dialog's sizing be mistaken for precedent here.

Props: `entityId` (drives open state), `onClose`, `title`, `subtitle`, `headerActions`, `isLoading`, `errorMessage`, `children` (body — each consumer supplies its own content), `maxWidth`.

**Each of the three consumers below supplies its own data-fetching and content. The shell has zero entity-specific logic.**


### 1.1 Viewport / overflow contract — ratified 2026-10-02

Entity Detail is an inspection surface, not a document reader.

**Normal desktop contract**

For canonical merchant data at a normal desktop viewport, Entity Detail
consumers should avoid internal vertical scrolling as far as reasonably
possible.

Consumers must first prefer:

- compact information density;
- reduced decorative vertical space;
- responsive reflow;
- compact spatial visualizations;
- concise fact rails;
- dense repeated rows;
- removal of redundant prose.

Do **not** achieve a scroll-free appearance by clipping content or applying
`overflow: hidden` to content that can exceed the available height.

**Fallback contract**

Body scrolling remains an accessibility and resilience fallback when:

- viewport height is genuinely constrained;
- content volume is unusually large;
- localization / accessibility sizing increases content height;
- the complete information cannot reasonably fit without harming usability.

Header identity and footer actions should remain stable framing regions where
the shell supports them.

**Acceptance**

For a canonical reviewer-sized desktop fixture, browser certification should
explicitly check that the modal does not introduce an avoidable internal
vertical scrollbar.

When scrolling is required at constrained heights, all content and actions must
remain reachable.

---

## 2. Orders — ✅ done (2026-06-28)

### 2.1 What already existed, and why neither alone was sufficient

Two pre-existing, never-reconciled pieces:

- **`OrderDetailPanel.tsx`** (`B-02`) — a real `Drawer anchor="right"`, narrow (420px), already stays-in-context (never navigates away). Content: constraint reason + a single "execute recommended action" button via `useOrderDecision`/`useExecuteOrderDecision` (`GET /api/v1/orders/:id/decision`). **Confirmed dead**: `setSelectedOrderId` (the prop that opens it) is called exactly once in `OrdersFT2Page.tsx` — as the *close* handler. Nothing in that file, or in `OrdersModuleFT2.tsx`, ever sets it to a real order ID. This panel has likely never opened in production.
- **`OrderDetailPage.tsx`** — comprehensive, but a full route (`/orders/:orderId`-style navigation away), via `useOrderDetail` (`GET /api/v1/orders/:id`) — line items, payment, fulfillment, tracking, timeline, pack decision history.

**Confirmed via reading both hooks in full: zero field overlap, two genuinely independent endpoints.** Decided: full merge into one modal, firing both queries side by side — no backend changes needed for the merge itself.

**One real fix needed as part of the merge, found while reading `useExecuteOrderDecision`:** its `onSettled` invalidates `['orders','constrained']` and `['order-nexus','ft2']`, but **not** `['order-detail', orderId]`. Without adding that invalidation, executing an action inside the merged modal would update the queue behind it but show a stale fulfillment badge inside the same modal until closed and reopened.

### 2.2 The real open trigger — ORD-03 (see also cta-deeplink-playbook.md)

While looking for where the modal should actually open from, found that **every click handler in `OrdersModuleFT2.tsx`'s critical/watch bands navigates to a dead legacy redirect**, not to anything resolvable:

```ts
onClick={() => navigate(order.constraintType !== null ? '/orders/blocked' : `/fulfillment?order=${order.lasyncro_order_id}`)}
```

Both `/orders/blocked` and `/fulfillment` are confirmed legacy routes that just redirect back to `/orders/flow` (`order-flow-implementation-playbook.md` §5.4) — dead ends. Worse: the constrained branch (`/orders/blocked`) **doesn't pass the order's own ID at all** — every constrained row, regardless of which order was clicked, navigates to the identical string.

**This is the actual entry point the new modal needs.** Fixing ORD-03 — replacing these `navigate()` calls with opening `EntityDetailModal` with the real `order.lasyncro_order_id` — *is* step one of shipping this feature, not a separate cleanup task.

**ORD-01** (Orders' own "View all orders →" → bare `/orders`) and **ORD-02** ("Resolve all →" → `/orders/blocked`) are separate, adjacent buttons in the same file:

- **ORD-02 — ✅ removed**, per explicit product decision: a single aggregate action across structurally different blocking reasons (inventory shortage, address issue, physical pick exception) doesn't make sense as one button. No replacement built — see §2.3 below for why "bulk-create Problem Center tasks" (the original replacement idea) turned out to not apply.
- **ORD-01 — still 🔴 open**, unrelated to the modal work, simple fix (`/orders` → `/orders/flow`), just never circled back to.

### 2.3 ⚠️ THE TRAP — Problem Center has TWO separate resolution domains, don't confuse them again

> **GH-1049 UPDATE — 2026-09-09:** The investigation below is retained as
> historical context, but its conclusion that `pick_exceptions` and
> `problem_center_tasks` are permanently separate is now superseded.
>
> The direct `pick_exceptions` query/resolve routes still exist. However, new
> Pick exception reporting now creates exactly one linked
> `problem_center_tasks` incident server-side in the same transaction, using the
> real `pick_exception_id` as the source identity. This does not mean the two
> resolution APIs have been fully unified; downstream custody and final
> owner/admin disposition remain later work.
>
> Current Pick-stage authority:
> `docs/playbooks/pick_exception_workflow.md`.


This cost significant investigation time tonight and is exactly the kind of thing worth writing down precisely so nobody re-walks the same path.

**The wrong assumption, held for several turns:** that `problem_center_tasks` (the table `ProblemCenterModuleFT2.tsx`/`useProblemCenter.ts` already has a full UI for) was *the* destination for pick-exception escalation — i.e., that fixing the operational-band CTA meant building a "create a `problem_center_tasks` row from a pick exception" write path, possibly via the table's `source_exception_id` field (which exists specifically to reference an exception by ID without an FK).

**Why that looked plausible:** the `problem_center_source` enum includes `'pick'` as a valid value. A live `psql` check confirmed **zero rows have ever had `source='pick'`** — consistent with "this integration was never finished," reinforcing the wrong theory.

**What's actually true, confirmed by reading the route file's own inline comments:**

```ts
// Resolves a pick exception under problem-center domain
router.post('/problem-center/pick-exceptions/:exceptionId/resolve', ..., httpResolveException);

// Resolve a problem_center_tasks row (re_stow / discard / return / write_off)
router.post('/problem-center/:taskId/resolve', ...);
```

**`pick_exceptions` has its own complete, separate, already-correct backend feature** — operating directly on the `pick_exceptions` table, never touching `problem_center_tasks` at all:

| Endpoint | Handler | What it does |
|---|---|---|
| `GET /api/v1/wms/problem-center/pick-exceptions` | `httpGetProblemCenterExceptions` | Lists all pick exceptions for the shop, joined to `order_line_items` for `variant_title`/`sku`. **Does NOT currently select `lasyncro_order_id`** — see gap below. |
| `POST /api/v1/wms/problem-center/pick-exceptions/:exceptionId/resolve` | `httpResolveException` | Marks one exception resolved. Takes only `resolution_note` (free text, required) — **no structured `resolution_action`**, unlike the `problem_center_tasks` resolve endpoint. |

**Both endpoints are fully implemented, fully correct, and have ZERO frontend consumer anywhere** — confirmed via `grep -rln "problem-center/pick-exceptions" apps/frontend/src` returning empty.

> **GH-1238 (2026-10-10):** the resolve endpoint above is retired — it answers `410 PICK_EXCEPTION_DIRECT_RESOLVE_RETIRED` and writes nothing. It closed the exception and its paired Problem Center task from a note alone, without recovery evidence. The list endpoint is unchanged.

**The lesson, stated plainly:** `problem_center_tasks` having `'pick'` in its source enum is a *red herring*, not evidence of intended integration. The two tables (`pick_exceptions`, `problem_center_tasks`) have **always** had fully separate, complete resolve flows — they just happen to share a URL prefix (`/problem-center/`) and similar-sounding names, which is what caused the confusion. **Before assuming any "missing integration" between two tables in this codebase, check for a route file's own inline comments first — they're often more current and more honest than a derived theory.**

### 2.4 — ✅ done

`httpGetProblemCenterExceptions` now takes an optional `?order_id=` query param (`oli.lasyncro_order_id` added to the `SELECT`, existing join reused). Omitted = unchanged shop-wide behavior for the general Problem Center page.

### 2.5 — ✅ all six steps done

What shipped: `EntityDetailModal` for Orders merges `useOrderDecision` (constraint + recommended action, with the "Mark as Resolved" button ported from the now-deleted `OrderDetailPanel.tsx`), `usePickExceptionsForOrder`/`useResolvePickException` (new hook, per-exception audit-trail resolve — does NOT unblock the order, see §2.3), and `useOrderDetail` (line items, total, tracking — title and full content). 
> **GH-1238 (2026-10-10):** `useResolvePickException` is removed. Order Detail still lists Pick exceptions read-only; an open exception offers **Open Problem Center** (`onClose()` then `navigate('/problem-center')`), not a direct Resolve.

ORD-03's four `navigate()` calls in `OrdersModuleFT2.tsx` now call `onOrderClick`, except the constraint-free "Release →" branch, which redirects to `/orders/flow` per explicit product decision (a clean SLA-breached pool order should be released, not inspected). **Superseded 2026-07-01 — see §2.9**: the modal itself now offers in-place resolution for this exact state (constraint-free, unbatched orders), so this note describes the click-to-open behavior only, not the full resolution path. The `['order-detail', orderId]` invalidation was added to `useExecuteOrderDecision`'s `onSettled`. ORD-01 fixed (`/orders` → `/orders/flow`).

### 2.6 Cleanup, and two corrected assumptions

**Self-caught, after the fact:** while adding `onOrderClick` to `OrdersModuleFT2DataProps`, didn't view the full interface first — missed that `onOrderSelect?: (orderId: string) => void` already existed one line above, with an identical signature. Confirmed dead (zero consumers, only the declaration + its compiled `.d.ts`) and removed. Worth stating plainly: this is the exact "two parallel, never-reconciled mechanisms" pattern flagged repeatedly all session — and it happened here because a new prop got added without first viewing the interface it was being added to, the one check that would have caught it immediately.

- **`OrderDetailPanel.tsx` — ✅ deleted.** Confirmed zero importers before removal (its open trigger was dead, as established in §2.1).
- **`OrderDetailPage.tsx` — kept, NOT orphaned.** Before deleting it alongside the Panel, a fresh importer check caught that `LifecycleRouteHost.tsx` mounts it live at `/orders/:orderId` — a real route, not dead code. Worth stating plainly: I'd grouped both files together as "two pre-existing, never-reconciled pieces" in §2.1 without separately verifying each one's importers, and almost deleted a live route on that unverified grouping. **Lesson: "these two look like the same situation" is not the same as "I checked both."** Each file gets its own importer check, every time, no matter how similar two files look from their role description alone.
- This also leaves a real, separate full-page surface sitting at that route — a plausible future "Open full page →" link from inside the modal, not built now, just noting it exists.

### 2.7 Known remaining gap, not fixed

Between the modal opening and `useOrderDetail` resolving, the header title is briefly empty (`modalTitle` starts as `''`, only set once `onTitleReady` fires from inside the body). Not broken, just a brief flash — logged rather than fixed, since `EntityDetailModal`'s header renders before its `children` mount, and the real fix (e.g. a passed-in fallback title from `OrdersModuleFT2`'s already-known `externalOrderId`, if available at click time) is a small but real design decision, not a one-line patch.

---


### 2.10 ORD-UX-DETAIL-01 — consistent inspect-before-act affordance (verified locally 2026-09-01)

**Problem:** Critical orders did not expose a consistent inspection path. Customer and inventory rows disguised inspection behind action-labelled CTAs (`Fix address`, `Resolve stock`) that only opened the order modal, while SLA-only rows exposed `Prioritize` with no independent way to inspect the order first.

**Locked interaction contract:**

- Every individual Critical order exposes an independent inspection affordance.
- Inspection opens `EntityDetailModal` for that exact `lasyncro_order_id`.
- The order identity/details area is the accessible inspection control; the whole row is not clickable.
- The control exposes a compact Tier-2-style `View →` ghost cue.
- Customer, inventory, and operational Critical rows do not show misleading row-level remediation CTAs when those CTAs merely open the same modal.
- Actual remediation remains inside `OrderDetailModalBody`.
- SLA-only rows retain a separate `Prioritize →` action; inspection and prioritization remain independent.
- Existing Watch `View →` behaviour remains unchanged.

**Layout contract:**

- Constrained Critical rows use a compact two-column layout: identity/inspection + value.
- SLA-only rows retain a third column for the real `Prioritize →` action.
- `View →` and order value share the same visual baseline.
- The ghost cue uses existing scheme-aware tokens (`var(--surface)`, `var(--accent)`, `var(--accent-border)`) rather than hardcoded light/dark colours.

**Accessibility:** the identity block is a real button with a meaningful accessible label (`View order #… details`) and keyboard focus treatment.

**Regression protection:**

- `tests/unit/ui/order-nexus/OrdersModuleFT2.critical-order-inspection.test.tsx`
  - 7/7 passing after implementation.
  - Covers customer, inventory, operational, and SLA-only inspection.
  - Protects independent SLA prioritization.
  - Protects removal of misleading constrained-row CTAs.
  - Protects existing Watch inspection.
- Combined SLA/Watch + ORD-DETAIL verification: 8/8 passing.
- Jest ownership: `UNOWNED=0`, `MULTI_OWNED=0`.

**Runtime acceptance:** locally browser-verified in both light and dark modes on 2026-09-01. Behavioural and visual acceptance passed. Production certification remains pending commit/deploy.

**Deliberate exclusions / deferred issues:**

- `ORD-UX-CTA-02` — broader Orders/global CTA-system audit and workshop; current orange filled/ghost doctrine may be visually too heavy.
- `ORD-UX-CONTRAST-03` — Critical group parent/child hierarchy loses contrast in dark mode.
- Decision Engine recommendation usefulness is separate work and was not changed here.

## 3. Members — not started

`MemberDetailPage.tsx` is comprehensive (performance, schedule editor, owner-only cost/notes) but route-mounted (`/team/:userId`), no overlay mechanism exists. Task: wrap existing content in `EntityDetailModal`, swap `useParams` for an `entityId` prop, no new data-fetching needed — content is already built.

---

## 4. Variant / Product — ✅ Variant entity modal shipped (2026-09-12)

The canonical Variant entity surface is now shared by Catalog deep links and
Ops Console Global Search.

Components:

- `VariantDetailModalHost` — reusable host. Input is `variantId`; authority is
  canonical `useProductsCatalog()` data; output is `EntityDetailModal` with
  `VariantDetailModalBody`.
- `VariantDetailModalBody` — variant identity, catalog inventory facts, and
  additive spatial context.

Entry points:

- Ops Console Variant/Product result opens `VariantDetailModalHost` in place.
- `/inventory/catalog?variant=<id>` opens the same host. Closing from Catalog
  removes only `variant=` and preserves unrelated query params.

Search metadata is discovery-only. Search result label, SKU/meta, or status
must not become detail authority.

### Variant spatial contract

Inventory facts remain available as ordinary Variant detail. Spatial context is
an additive enhancement.

Spatial acquisition requires resolved access to both:

- `inventory.live_map`
- `warehouse.floor_planning`

Denied or unresolved map access must not break Variant detail. The body uses the
authoritative variant stocked-bin endpoint and real merchant floor geometry. It
does not synthesize bins. Empty, partial, unpositioned, or unmapped locations
remain truthful textual evidence.

## 5. Batch — ✅ compact Pick footprint shipped (2026-09-12)

Batch Detail now includes a compact read-only Pick footprint.

Spatial contract:

- authoritative focus comes from batch line-item `location_code` values;
- geometry comes from the real warehouse floor;
- `IsometricCanvas` is read-only, compact, no controls, no pan;
- no live-picker, current-location, fake path, or fake route claim;
- floor acquisition is gated by `warehouse.floor_planning`;
- unpositioned/unmapped locations remain textual evidence.

Default modal layout is compact and scroll-free at normal desktop sizes. Large
member-order lists default to the first four orders with explicit expansion;
orders are never silently discarded.

Batch to Order navigation continues to open canonical Order Detail.

## 6. Order spatial boundary

Order Detail's Warehouse Status is a workflow-stage visualization, not physical
spatial truth.

Do not reinterpret it as a bin, exact current location, picker position, or
live warehouse position signal. It remains stage/status context for the order
workflow.

### 2.8 Resolved-state bug + design pivot — ✅ shipped (2026-07-01)

**Root-cause fix, not a patch on the symptom:** rather than trusting `decision.status`/`isSuccess` (proven unreliable — both branches of `resolve_inventory_block.handler.ts` mark `decision_execution_queue` as `'success'` identically), the modal now reads ground truth directly: `hasActiveInventoryConstraint = constraints.some(c => c.constraint_type === 'inventory')`, sourced from the same `constraints[]` array the Issue section already renders. If still present after refetch → still short, shows "Go to sourcing." If gone → real success banner. Required adding `['orders','decision', orderId]` to `useExecuteOrderDecision`'s `onSettled` invalidation list (previously missing — the array would never have refreshed).

**Shipped, matching the locked design:**

- Stacked, independently-colored alert cards per active constraint type (severity: inventory/operational = critical, customer = warning), reusing the icon+color+label pattern from `AlertsModule.md`'s `BellAlertRow` — decision made in favor of the compact pattern, not the full `AlertCard`.
- "Go to sourcing" replaces "Acknowledge Stock Issue" as the inventory-block CTA — direct link to `/suppliers-portal/sourcing`, clean redirect, no confirmation step.
- Similar-orders inline list (same constraint type + block type), navigable in-modal via `selectedOrderId` swap — no new routing needed.
- Timeline capped at 3 visible entries, "Show N more" expansion.
- Alternate actions (`decision.actions[]` beyond the recommended one) surfaced under "Other options."
- Real `order_warehouse_status` join added to `getOrderDetailsById` — pipeline status pill now shows one of three honest states in priority order: **Blocked** (active constraint) → **real warehouse stage** (`order_warehouse_status.status`, if a pick-batch row exists) → **"In pool"** (no constraint, no batch row yet — order genuinely just hasn't been released).

**Second bug found during live verification, not designed for — real, separate, now fixed:** `httpGetOrderDecision` had no `status` filter (unlike the execute controller, which correctly filters to `pending`/`in_progress`) — so a resolved-but-stale `decisions` row could be served as "current" even after `order_constraints` had already cleared via an unrelated path. Fixed with a matching `whereIn('status', ['pending','in_progress'])`, plus a cross-check inside the same transaction: if the recommended action's constraint type has zero active rows in `order_constraints`, the decision is treated as stale and `null` is returned instead. This closes the gap for *any* future write path that clears a constraint without updating `decisions` — not just the ones we know about today.

DF-04 dependency is now moot — see `demand-velocity-reorder-playbook.md` §6, shipped same session.

See also `docs/playbooks/sla_threshold_unification_2026_07_01.md` for the SLA/aging threshold bugs found during the same verification pass — unrelated to the modal itself, but surfaced by it.

### 2.9 Order Detail redesign (in progress, 2026-07-01) — target design + audit findings

**Trigger:** a target design was produced via claude.ai/design ("LaSyncro Order Details Modal") — customer card, itemized line items with images, multi-stage timeline, three-button footer (Release to floor / Open in Shopify / Print pick list). Full audit run against it before any code changes; findings below are why the shipped scope differs from the mockup.

**Scope decision:** confirmed via `grep` that `EntityDetailModal` has exactly one real render site (`OrdersFT2Page.tsx`) — the `OrdersModuleFT2.tsx` hit was a stale comment, not a second consumer. No fork needed; `OrderDetailModalBody` (the children passed into the shell) is the only file in scope for this redesign.

**Data audit findings (live DB + live endpoint verification, not assumption):**

- **Customer PII (VO-07) — structurally thin, not a bug.** `customers.email`/`first_name`/`last_name` confirmed 0/2 populated in dev; the upsert at `orders.create.ts` only ever writes `external_customer_id` (hashed). Per Shopify's Protected Customer Data scope, this is expected and typically will not improve for most merchants — **do not build the customer card assuming name/email will be present.** Decision: use `orders.shipping_name`/`shipping_city`/etc. (reliably populated) as the customer-facing identity instead of `customers` table fields.
- **Timeline (VO-02) — data model doesn't support the mockup's 4 stages.** Live DB has exactly two `order_fulfillment_history.status` values ever recorded: `pending`, `fulfilled`. No `order_placed`/`payment_captured`/`stock_reserved`/`in_release_pool` events exist. Render only real timeline entries; do not hardcode stages that aren't backed by data.
- **"Open in Shopify" / "Print pick list" (VO-04) — no backend exists for either.** Deferred, out of scope for this pass.
- **Line item images (VO-08)** — `image_url` null on live sample orders; needs a placeholder fallback whenever this is built, not yet handled.

**Bugs found and fixed as a byproduct of this audit (unrelated to the redesign itself, but blocking verification):**

- **VO-01 (shipped):** `getOrderDetailsById`'s return object omitted `orders.shipping_*` fields despite them being selected and populated — added a `shipping: {...}` block to the response. `useOrderDetail.ts`'s `OrderDetail` interface updated to match (`OrderShipping` type added).
- **VO-09 (shipped, higher severity than VO-01):** `httpGetOrderDetails` (and, unfixed, its siblings `httpGetAllOrders`/`httpGetOrderProfitability` — see below) called the service layer against the global `db` client with **no `SET LOCAL "app.current_tenant"` and no transaction wrap**, unlike every other orders controller (`orders.constrained.controller.ts` etc.). Under RLS with `orders`' strict policy (no NULL/0 bypass, unlike `shops`), this silently returned 404/empty for every request regardless of a correct `shop_id` in the WHERE clause. Confirmed live: order existed, shop_id matched, still 404'd; fixed by wrapping `getOrderDetailsById` in `db.transaction()` + `SET LOCAL`, pattern copied from the constrained-orders controller.
- **VO-10 (not a bug, logged as a process note):** my first pass at the "Prioritize" button used ad-hoc styling instead of consulting `modules-ux-playbook.md` first — that playbook already documents a `--confirm-ghost`/`--confirm-ink` state pattern (§10) specifically for this exact button's confirmed state, and §8's `--accent-ink` correction for on-accent text. Fixed to match documented pattern exactly. **Lesson restated for next engineer:** check the relevant playbook *before* writing UI code, not after — this file existed with the exact answer the whole time.

**Shipped this session (2026-07-01):**

- "Go to order flow →" — confirmed live, functional (pre-existing fromprior session, verified working via screenshot).
- **"Prioritize" button** — new, primary action in the constraint-free/unbatched footer state. Reuses the exact same `onPriorityFlag` mutation as ORDM-02's list-row Prioritize action (bulk-set-priority endpoint) — not a new/parallel implementation. Explicit product decision: **kept alongside** "Go to order flow," not a replacement — Prioritize (primary, filled accent) + Go to order flow (secondary, ghost pill), both always available together, not a fallback relationship.
- **Fulfillment safety — ORD-CTA-01B (2026-08-19):** Order Detail must never expose `proceed_fulfillment` as an actionable CTA. That action performs a real Shopify fulfillment and would bypass laSyncro's operational sequence. A healthy pool order remains **Prioritize + Go to order flow** only; fulfillment continues through **release → pick → pack → ship**.

**Shipped this session (2026-07-02) — visual pass against target design, live-verified via screenshots:**

- **Modal width** — `EntityDetailModal`'s `maxWidth` prop set to `"md"` at the Orders call site (was defaulting to `"lg"`, read as a wide rectangle vs. target's more square proportions).
- **Two-column top section** — items list (left) / customer identity + order summary (right), replacing the old single-column flat stack. Customer block renders from `order.shipping.*` (VO-01/VO-07 — NOT `customers.email`/`first_name`, which is structurally blank for most merchants per Shopify PCD scope). No "Returning · Nth order" badge — would require a join on a key we've confirmed is usually blank, not worth building on it.
- **Summary block** — Subtotal/Tax/Total now rendered from real `orders.subtotal_price`/`total_tax` (VO-11, newly selected — existed on the table, was never returned by the API). **No Shipping line** — deliberately omitted, see GH-1032 (derived `total - subtotal - tax` was flagged live as unreliable, not backed by real carrier data; do not re-add without a carrier-data audit first).
- **`EntityDetailModal` shared shell — new `footerActions` slot** (2026-07-02): the shell previously had no footer concept at all; CTAs lived inside the scrollable `children` body. Added a dedicated `footerActions?: ReactNode` prop + fixed footer region below `DialogContent`, styled `--bg-2` to match the header (both now visually frame the `--surface`-toned body, per target design — was uniformly `--surface` throughout). **This is a shared-shell change — affects Members/Products too if/when they adopt this modal, not just Orders.** Orders' Prioritize/Go-to-order-flow buttons were lifted out of `OrderDetailModalBody`'s JSX into a `useMemo`-computed `footerContent`, sent up via a new `onFooterReady` callback (same lift pattern as the existing `onTitleReady`/`onSubtitleReady`, but memoized + effect-driven since footer content depends on multiple pieces of local state — constraint status, `isPrioritizing`, `prioritized` — not a fire-once value).
- **CTA sizing** — Prioritize/Go to order flow changed from `fullWidth` stretched-to-fill to compact, equal-width (`minWidth: 140`, `flex: '0 1 auto'`), matching target's button proportions.
- **Timeline row** — timestamp moved from stacked-under-label to right-aligned, connected to the label via a dotted leader (`borderBottom: '1px dotted var(--rule)'` filling the flex gap) to close the empty-space gap flagged live, rather than leaving raw `justifyContent: 'space-between'` whitespace.

**Two self-caught process notes from this pass, worth restating for the next engineer:**

- Two separate `str_replace` applications silently landed partial (the `useEffect` firing `onFooterReady`, and the destructured `onFooterReady` param) — both caught only via live TS errors after the fact, not before. **Lesson: after any multi-part diff, grep for every distinct piece separately** (type declaration, destructured param, and usage are three different grep targets, not one) rather than trusting a single confirmation grep that only checked one of them.
- Item images (VO-08) still render as a bordered placeholder box, not a real image — `image_url` is null on all live sample orders. Not fixed this pass, still open.

**Shipped (2026-07-02) — VO-02 timeline stages:**
Query-side merge in `getOrderDetailsById` (Option 1, explicit product decision — Option 2's write-path fix logged separately as GH-1034, deferred). Combines real `order_fulfillment_history` rows with two other real, already-populated timestamps that live on separate tables for legitimate architectural reasons: `orders.paid_at` (→ synthetic `payment_captured` event) and `order_warehouse_status.status_updated_at` (→ synthetic `in_release_pool` event, only present once an order leaves the pool). Sorted chronologically, read-only, no schema changes. `captured_at`/`settlement_at` remain confirmed dead (0/26 populated, no writer anywhere) — not used.

Frontend: raw status codes were leaking into the UI unlabeled (`'pending'` rendering as literally "pending" — flagged live as unclear to SMB operators of any skill level). Added `formatTimelineEventLabel()` — an explicit label map (`pending → 'Order placed'`, `payment_captured → 'Payment captured'`, etc.) with a safe raw-string fallback for any future unmapped status, replacing the old `event.status.replace(/_/g, ' ')` inline formatting. **Any new status introduced anywhere upstream (history table, or a new synthetic event) must get a case added here** — this is now the single place timeline vocabulary is translated to plain English.

**Not yet started (open):**

- VO-04 (Open in Shopify / Print pick list — no backend exists for either)
- VO-12 (warehouse/location subline — no `warehouses` table with name/city exists; dropped from header rather than fabricated)
- GH-1032 (shipping cost — needs real carrier-rate data audit, see `shop_carrier_settings`)
- GH-1034 (make `order_fulfillment_history` the single source of truth for timeline events, replacing today's query-side merge — deferred, touches `pickBatch.service.ts`'s write path)
- GH-1033 (separate thread: `integrations.sync_status` never updates on successful sync, health pill stuck on "Syncing" — confirmed unrelated to this modal's timeline, audited and ruled out as a shared-engine candidate)

**NOTE, per explicit instruction (2026-07-01):** this codebase's docs are known to run stale in places — this conversation's approvals are the current source of truth where they conflict with anything written earlier in thisfile, including §2.5's now-superseded line above.


### GH #1053 — scroll-free Order Detail contract (2026-09-07)

**Requirement:** essential Order Detail context, blockers, recommended action,
and primary CTA must fit at normal desktop sizes without internal vertical
scrolling. Smaller supported viewport heights may scroll, but the footer CTA
must remain immediately visible and stable.

**Shipped structure:**

- The opening body uses three information planes:
  **Order contents + customer**, **Summary**, and
  **Issue + Warehouse Status**.
- Remediation moved out of the scrollable body into
  `EntityDetailModal.footerActions`.
- Footer-left owns **Recommended action + CTA**. The existing healthy-pool
  state remains **Prioritize + Go to order flow**.
- Footer-right owns **Latest activity**, limited to the two newest available
  timeline events. Activity no longer consumes body height and has no
  expandable "Show more" state.
- **Similar Orders** was removed from the opening Order Detail modal.
- Warehouse Status uses the shared compact isometric primitive driven only by
  canonical order warehouse stage/status. It does **not** claim an exact or
  live physical location. A blocked order with no warehouse-stage row renders
  as **Blocked / Order pool** rather than fabricating a warehouse location.
- Existing blocker ownership remains unchanged: customer/address correction,
  returned-package handling, target-specific inventory sourcing, and generic
  executable actions preserve their existing domain routes and precedence.
- `proceed_fulfillment` remains unavailable from Order Detail.

**Runtime-stability correction discovered during live verification:**

Two React parent/child publication loops were found and corrected rather than
suppressed:

1. Subtitle publication depended on the referential identity of the currency
   formatter. Order Detail now derives the semantic subtitle string first and
   republishes only when that string changes.
2. Footer publication could loop because Order Detail consumers supplied a new
   inline `onClose` callback on each parent render. `OrderFlowPage`,
   `OrdersFT2Page`, and `OrdersOutboundPage` now each create one stable
   `useCallback` close handler and pass that same handler to both
   `EntityDetailModal` and `OrderDetailModalBody`.

The permanent regression contract verifies stable close-callback wiring at
those consumer boundaries rather than teaching the child to ignore arbitrary
callback churn.

**Verification evidence:**

- Targeted Order Detail Jest matrix: **4 suites / 39 tests passed**.
- Frontend TypeScript: **19 pre-existing global baseline errors;
  0 errors in the four GH #1053 production files**.
- Normal desktop live browser at **1378 × 676**:
  `DialogContent clientHeight=298`, `scrollHeight=298`,
  therefore **scroll-free**; footer visible; `Review return` CTA visible;
  Activity absent from body; Latest activity present in footer;
  Similar Orders absent.
- Reduced-height live browser at **1381 × 501**:
  body `clientHeight=265`, `scrollHeight=298` and therefore scrolls as allowed;
  footer remains visible and `Review return` CTA remains visible.
- Repeated opening/closing and switching across blocked orders no longer
  produced the previously observed **Maximum update depth exceeded** loop.

**Explicit follow-ups, not part of GH #1053:**

- **GH #1054** — improve Order Detail dark-mode contrast/hierarchy.
- **GH #1055** — evolve Warehouse Status toward the Overview-style embedded
  2.5D/isometric treatment with minimal text and no nested-card framing.
- **GH #1056** — audit pick-exception blocking semantics and isolate Returns
  reviewer fixtures from generic Order Flow seed orders.

## 2.10 Outbound module audit fixes (2026-07-04)

**ISS-01 — `StatusBadge`'s `alpha('var(--ink-4)', ...)` MUI crash
(`OrderDetailPage.tsx`, the full-page route, NOT the modal).** `alpha()`
requires a resolvable color format (hex/rgb/hsl) — a raw CSS custom-
property string throws `MUI: Unsupported "var(--ink-4)" color`. Triggered
whenever `statusBadgeColor()` returns `'default'` (any order status
outside `fulfilled`/`partially_fulfilled`/`processing`/`cancelled`).
Fixed narrowly: `default: theme.palette.mode === 'dark' ? '#5A5F6E' :
'#9CA3AF'` (the literal values `--ink-4` already resolves to per mode,
confirmed against `themes/index.tsx`). **Scope decision, explicit:** did
NOT extract these into a shared `tokens.ts` file or wire up
`utils/colorUtils.ts`'s `withAlpha()` — that function's CSS-var branch
turned out to be dead code (no `--*Channel` variables exist anywhere for
it to consume; `extendPaletteWithChannels()` is defined but called
nowhere). Wiring that up properly (adding `--ink-NChannel` RGB-triplet
vars) was scoped as a separate, larger task and deliberately deferred —
logged as ISS-02, still open. This file (`OrderDetailPage.tsx`) is
distinct from `OrderDetailModalBody.tsx` and has no `StatusBadge`
equivalent in the modal — confirmed via grep, not assumed from the two
files' similar role.

**ISS-05 — Outbound never migrated to `EntityDetailModal`.**
`OrdersOutboundPage.tsx` had 4 separate `navigate(\`/orders/${id}\`)` calls
(the full-page route from §2.6 above — correctly *kept*, not orphaned,
but Outbound was simply never wired to the modal pattern when Overview/
Order Flow were). Fixed to match `OrdersFT2Page.tsx`'s pattern exactly:
`selectedOrderId`/`modalTitle`/`modalSubtitle`/`modalFooter` state +
`useBulkSetPriority`-backed `onPriorityFlag` + `<EntityDetailModal>` /
`<OrderDetailModalBody>` render block, same shape, same props. No new
pattern invented — this closes the gap noted in §2.6 ("a plausible
future 'Open full page →' link from inside the modal") in the opposite
direction: the full page stays live at its route for anyone who lands
there directly (e.g. a bookmarked/shared URL), but in-app clicks now
correctly open the modal like everywhere else in Orders.

**ISS-07b — stale "In pool" pipeline status + contradicting body text
for fulfilled orders with no `order_warehouse_status` row.** Confirmed
live: 10/10 seeded "shipped" orders have `order_fulfillment_status.status
= 'fulfilled'` but zero `order_warehouse_status` row — legitimate for
any order fulfilled outside LaSyncro's own pick/pack pipeline (Shopify-
side fulfillment, pre-existing history, or seed data mimicking that
shape; confirmed via write-path audit: `shipConfirmation.service.ts`
writes both tables correctly for orders that go through the real
pipeline, `orderFulfillmentIngestion.service.ts` — a Shopify-sync path —
only ever touches `order_fulfillment_status`, by design). The bug was
purely in the modal's display logic: `formatWarehouseStatus(null)`
falls back to a hardcoded `'In pool'` string, and the pipeline-label
derivation (§2.8's documented `Blocked → real warehouse stage → In pool`
priority) was missing a tier — never checked `order.fulfillment.status`
at all, despite that field already being fetched and returned by
`getOrderDetailsById` (no backend/type change needed, just unread data).

Fixed: added `isFulfilled = order?.fulfillment?.status === 'fulfilled'`,
inserted as a new tier between Blocked and the warehouse-stage fallback:
`Blocked → Fulfilled → real warehouse stage → In pool`. Pill color reuses
the existing `--confirm-ghost`/`--confirm-ink` tokens (§10,
`modules-ux-playbook.md`) — correct fit per that section's own scope
rule ("confirmed/persisted state ONLY... nothing left to click"), not a
new color invented for this. Second rendering site fixed in the same
pass: the "No open issues... waiting to be released into a pick batch"
info box (separate from the pill, same root cause) was gated on
`!hasAnyActiveConstraint && !order?.warehouseStatus` with no fulfillment
check either — added `&& !isFulfilled` to the same condition, reusing
the one new variable rather than deriving it twice.

**Loading spinner flicker, appears/disappears repeatedly while modal
stays open (GitHub issue #1037) — root cause found and fixed.** Initial
hypothesis (window-focus refetching, `refetchOnWindowFocus: true` in
`main.tsx`) was wrong — `staleTime: 30_000` added to all three modal
hooks (`useOrderDecision`, `useOrderDetail`, `usePickExceptionsForOrder`)
did NOT resolve it, confirmed live. Real mechanism, found via Network
tab: `useOrderDecision`'s `GET /orders/:id/decision` 404s for any order
with no active decision (confirmed as *intentional* API behavior per
that controller's own doc comment — "404 if no decision exists for this
order," not a failure). The global React Query default (`retry: 3`,
`main.tsx`) retried this guaranteed-permanent 404 three times per fetch
regardless, and `LifecycleProvider.tsx`'s two independent 3-second
`setInterval` polls (`loadReadiness`/`pollLifecycle`, both only stop once
`phase === 'FT2_READY'`) were driving a steady stream of re-renders/
refetches for this to compound against — matching the "appears and
disappears regularly" symptom exactly.

**Fix:** added a targeted `retry` function to `useOrderDecision` only —
`retry: (failureCount, err) => err?.response?.status === 404 ? false :
failureCount < 2` — never retries a 404, retries genuine failures
(5xx/network) up to twice. Deliberately did NOT touch the query's
`queryFn`/error-catching — `OrderDetailModalBody.tsx` already has its
own correct `is404`/`isRealError` handling (added 2026-07-01, see that
section) that depends on the 404 surfacing as a real `isError` state;
converting it to a caught `null` return would have silently broken that
existing, working logic. Confirmed live post-fix: modal opens
immediately, no flicker, no unnecessary retry storm.

Do **not** reuse `2.10`; that number already exists later in this playbook. Add the following dated section immediately after the existing Order Detail redesign material and before the later unrelated modal audit sections.

```md
### Order Detail customer-block resolution — BL-16 / BL-16-UX, 2026-08-08

**Status:** local implementation and functional verification complete; commit/deployment handled separately.

#### BL-16 — constraint truth must survive missing decision enrichment

The Order Detail modal must derive blocked state and supported blocker-specific resolution from `constraints[]`, not solely from `decision.recommended_action`.

Confirmed failure mode:

```text
order_constraints:
  customer / incomplete_address = active

decision:
  null

Before BL-16, the modal could render the Address Issue but expose no correction path because ShippingAddressForm was gated by:

recommended_action.type === resolve_customer_block

That was incorrect. A missing decision does not invalidate an active canonical constraint.

The corrected gate is the active canonical blocker:

constraint_type = customer
block_type = incomplete_address
is_active = true

The existing PATCH /api/v1/orders/:orderId/shipping-address path remains the only address correction mechanism. No fake recommended_action is synthesized and the generic /execute path is not used for a decision-null customer blocker.

BL-16-UX-01 — focused shipping-address child dialog

The old inline address form was replaced with a focused child dialog launched by the Tier-1 Correct shipping address CTA.

Interaction contract:

Order Detail remains open
→ Correct shipping address
→ child dialog opens
→ existing partial address is prefilled
→ address1 / city / ZIP / country code are required
→ Cancel closes only the child dialog
→ Save address uses the existing PATCH mutation
→ child dialog closes after persisted save
→ parent Order Detail remains open

The child dialog follows modules-ux-playbook.md:

design tokens only;
var(--surface) content;
var(--bg-3) framing;
1px solid var(--rule) borders;
Tier-1 CTA uses var(--accent) + var(--accent-ink);
actionable CTA radius 6px;
no local fontFamily.
BL-16-UX-02 — asynchronous resolution must remain visible

Saving the corrected address and resolving the customer constraint are intentionally separate facts.

useUpdateShippingAddress does not optimistically remove the blocker. PATCH success confirms only that the corrected address persisted; normal reconciliation still owns constraint resolution.

The shipped transition is therefore:

Save address
→ Saving…
→ PATCH succeeds
→ child dialog closes
→ Correct shipping address collapses out
→ Address updated — rechecking order… appears
→ canonical Address Issue remains visible while still active
→ refreshed constraint state confirms resolution
→ rechecking state collapses out
→ next real recommendation appears

For the controlled multi-constraint order #800003, the next recommendation was Go To Sourcing because the independent inventory:oversell constraint remained active.

The transition uses the established Collapse timeout={180} pattern. The rechecking state uses --confirm-ghost, --confirm-border, and --confirm-ink. It ends from refreshed canonical constraint state, not from an arbitrary timer.

Functional verification — #800003

Controlled test order:

#800003
1 QA Street
Stockholm
ZIP intentionally removed
SE

Verified behavior:

Order Detail showed both Address Issue / incomplete address and Out of Stock / oversell.
No address fields were rendered inline.
Correct shipping address opened the focused child dialog.
Existing address fields were prefilled and ZIP was blank.
Save remained disabled until ZIP was entered.
Saving 111 22 persisted the address through the supported mutation.
Parent Order Detail remained open.
Address updated — rechecking order… covered the asynchronous reconciliation interval.
The customer Address Issue disappeared only after canonical re-evaluation.
Inventory oversell remained and the next real action became Go To Sourcing.

Product invariant:

The UI may optimistically acknowledge that a mutation succeeded, but it must never optimistically claim that a canonical blocker has resolved.

This belongs in this playbook because its existing Order Detail section already establishes that active constraints—not decision execution success—are the modal’s ground truth. :contentReference[oaicite:5]{index=5}
