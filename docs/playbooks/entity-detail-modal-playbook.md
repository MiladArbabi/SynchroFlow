# LaSyncro — Entity Detail Modal Playbook

> **Scope:** The shared "view and act on one entity without leaving the module" modal pattern — covers the shared shell component, and the per-entity (Orders, Members, Products) consumer status. Created 2026-06-28 out of the original ask: three new large-modal surfaces for Order/Member/Product detail.
> **Companion docs:** `docs/playbooks/cta-deeplink-playbook.md` (deep-link contract — ORD-01/02/03 below are also tracked there), `docs/playbooks/modules-ux-playbook.md` (CTA visual tiers, used by this shell).
> **Status legend:** ✅ done · 🔴 open · 🟡 open, lower priority

---

## 1. The shared shell — ✅ built

`modules/shared/src/ui/EntityDetailModal.tsx`, exported from `@lasyncro/shared/ui`.

Centered `Dialog`, large (`maxWidth="lg"` default), FT2 card-shell tokens (`var(--surface)`, `1px solid var(--rule)`, `borderRadius: '14px'`) rather than MUI's default Paper — chosen deliberately because **no prior large-content-dialog precedent existed anywhere in this codebase** (checked: every existing `<Dialog>` usage found — `ProblemCenterModuleFT2.tsx`, `MembersPage.tsx` — was a small action-form dialog, `maxWidth="sm"`/`"xs"`). This is the first one; don't let a future small-form dialog's sizing be mistaken for precedent here.

Props: `entityId` (drives open state), `onClose`, `title`, `subtitle`, `headerActions`, `isLoading`, `errorMessage`, `children` (body — each consumer supplies its own content), `maxWidth`.

**Each of the three consumers below supplies its own data-fetching and content. The shell has zero entity-specific logic.**

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

**The lesson, stated plainly:** `problem_center_tasks` having `'pick'` in its source enum is a *red herring*, not evidence of intended integration. The two tables (`pick_exceptions`, `problem_center_tasks`) have **always** had fully separate, complete resolve flows — they just happen to share a URL prefix (`/problem-center/`) and similar-sounding names, which is what caused the confusion. **Before assuming any "missing integration" between two tables in this codebase, check for a route file's own inline comments first — they're often more current and more honest than a derived theory.**

### 2.4 — ✅ done

`httpGetProblemCenterExceptions` now takes an optional `?order_id=` query param (`oli.lasyncro_order_id` added to the `SELECT`, existing join reused). Omitted = unchanged shop-wide behavior for the general Problem Center page.

### 2.5 — ✅ all six steps done

What shipped: `EntityDetailModal` for Orders merges `useOrderDecision` (constraint + recommended action, with the "Mark as Resolved" button ported from the now-deleted `OrderDetailPanel.tsx`), `usePickExceptionsForOrder`/`useResolvePickException` (new hook, per-exception audit-trail resolve — does NOT unblock the order, see §2.3), and `useOrderDetail` (line items, total, tracking — title and full content). 
ORD-03's four `navigate()` calls in `OrdersModuleFT2.tsx` now call `onOrderClick`, except the constraint-free "Release →" branch, which redirects to `/orders/flow` per explicit product decision (a clean SLA-breached pool order should be released, not inspected). **Superseded 2026-07-01 — see §2.9**: the modal itself now offers in-place resolution for this exact state (constraint-free, unbatched orders), so this note describes the click-to-open behavior only, not the full resolution path. The `['order-detail', orderId]` invalidation was added to `useExecuteOrderDecision`'s `onSettled`. ORD-01 fixed (`/orders` → `/orders/flow`).

### 2.6 Cleanup, and two corrected assumptions

**Self-caught, after the fact:** while adding `onOrderClick` to `OrdersModuleFT2DataProps`, didn't view the full interface first — missed that `onOrderSelect?: (orderId: string) => void` already existed one line above, with an identical signature. Confirmed dead (zero consumers, only the declaration + its compiled `.d.ts`) and removed. Worth stating plainly: this is the exact "two parallel, never-reconciled mechanisms" pattern flagged repeatedly all session — and it happened here because a new prop got added without first viewing the interface it was being added to, the one check that would have caught it immediately.

- **`OrderDetailPanel.tsx` — ✅ deleted.** Confirmed zero importers before removal (its open trigger was dead, as established in §2.1).
- **`OrderDetailPage.tsx` — kept, NOT orphaned.** Before deleting it alongside the Panel, a fresh importer check caught that `LifecycleRouteHost.tsx` mounts it live at `/orders/:orderId` — a real route, not dead code. Worth stating plainly: I'd grouped both files together as "two pre-existing, never-reconciled pieces" in §2.1 without separately verifying each one's importers, and almost deleted a live route on that unverified grouping. **Lesson: "these two look like the same situation" is not the same as "I checked both."** Each file gets its own importer check, every time, no matter how similar two files look from their role description alone.
- This also leaves a real, separate full-page surface sitting at that route — a plausible future "Open full page →" link from inside the modal, not built now, just noting it exists.

### 2.7 Known remaining gap, not fixed

Between the modal opening and `useOrderDetail` resolving, the header title is briefly empty (`modalTitle` starts as `''`, only set once `onTitleReady` fires from inside the body). Not broken, just a brief flash — logged rather than fixed, since `EntityDetailModal`'s header renders before its `children` mount, and the real fix (e.g. a passed-in fallback title from `OrdersModuleFT2`'s already-known `externalOrderId`, if available at click time) is a small but real design decision, not a one-line patch.

---

## 3. Members — not started

`MemberDetailPage.tsx` is comprehensive (performance, schedule editor, owner-only cost/notes) but route-mounted (`/team/:userId`), no overlay mechanism exists. Task: wrap existing content in `EntityDetailModal`, swap `useParams` for an `entityId` prop, no new data-fetching needed — content is already built.

---

## 4. Products — not started

Zero existing detail page or panel of any kind (confirmed: `find` returned nothing for product/variant detail anywhere in the codebase). Content scope undefined — likely candidates from tonight's other work: stock status (sellable/zeroStock/phantom from `ProductsCatalogPage.tsx`'s existing classification), cost-completeness (currently doesn't exist anywhere — see `cta-deeplink-playbook.md`'s `CATALOG-GAP`), demand/reorder signal (`DemandModuleFT2`'s `reorder_urgency`), recent returns. Needs its own scoping pass before building.

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

**NOTE, per explicit instruction (2026-07-01):** this codebase's docs are known to run stale in places — this conversation's approvals are the current source of truth where they conflict with anything written earlier in this file, including §2.5's now-superseded line above.