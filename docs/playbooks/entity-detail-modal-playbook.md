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

## 2. Orders — in progress

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

### 2.4 Known gap before the Orders modal can use this

`httpGetProblemCenterExceptions`'s `SELECT` needs `oli.lasyncro_order_id` added — the join already exists (`order_line_items as oli`), it's a one-line addition, not a new join. Without it, there's no way to filter "which exceptions belong to this specific order" for the modal's content.

### 2.5 Next steps for Orders (not yet done)

1. Add `lasyncro_order_id` to `httpGetProblemCenterExceptions`'s `SELECT` (§2.4).
2. Fix ORD-03's four `navigate()` calls to open `EntityDetailModal` with the real order ID instead.
3. Inside the modal: merge `useOrderDecision` + `useOrderDetail` + a new "pick exceptions for this order" query (filtering the now-fixed GET response by `lasyncro_order_id`).
4. Add the missing `['order-detail', orderId]` invalidation to `useExecuteOrderDecision`'s `onSettled` (§2.1).
5. Surface `httpResolveException`'s resolve action inside the modal for any pick-exception-blocked order, alongside the existing recommended-action button for other constraint types.
6. Fix ORD-01 separately (unrelated, trivial).

---

## 3. Members — not started

`MemberDetailPage.tsx` is comprehensive (performance, schedule editor, owner-only cost/notes) but route-mounted (`/team/:userId`), no overlay mechanism exists. Task: wrap existing content in `EntityDetailModal`, swap `useParams` for an `entityId` prop, no new data-fetching needed — content is already built.

---

## 4. Products — not started

Zero existing detail page or panel of any kind (confirmed: `find` returned nothing for product/variant detail anywhere in the codebase). Content scope undefined — likely candidates from tonight's other work: stock status (sellable/zeroStock/phantom from `ProductsCatalogPage.tsx`'s existing classification), cost-completeness (currently doesn't exist anywhere — see `cta-deeplink-playbook.md`'s `CATALOG-GAP`), demand/reorder signal (`DemandModuleFT2`'s `reorder_urgency`), recent returns. Needs its own scoping pass before building.
