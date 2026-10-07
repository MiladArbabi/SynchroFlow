# LaSyncro — Sourcing & Reorder Recommendation Playbook

> **Created:** 2026-06-29. **Status:** ✅ Algorithm designed and shipped (§6, 2026-06-30). Tuning & re-routing items tracked in §6b.

## 1. Why Reorder Changed Direction

**Final ownership boundary — locked 2026-08-19.** Demand identifies what needs replenishment and computes the suggested quantity. Its `Source →` handoff opens `/suppliers-portal/sourcing?variantId=X`. Sourcing owns supplier selection, MOQ accumulation/queueing, and PO creation. The former REPL-001 direct Demand → pre-filled PO handoff is retired.

**Amended 2026-09-03 (SOURCING-UX-COGNITIVE-01 Slice 1A).** The generic targeted route above is unchanged. An *order-originated* recovery — a merchant arriving via "Source this item" on a blocked order — may additionally carry `&orderId=<canonical_order_id>`. **`orderId` is context only**: it names which order sent the merchant here and never participates in any calculation. See §13.

A popup-based MOQ check was designed, then abandoned in favor of a **dedicated page** (same architectural shape as Order Flow — a surface that owns a whole class of decisions, fed by deep-links, with live recompute) once it became clear the real need is supplier *comparison and recommendation*, not just a quantity warning.

## 2. Confirmed Facts (ground truth, 2026-06-29)

- `suppliers` table already has a full unused scorecard: `on_time_rate`, `fill_rate`, `defect_rate`, `avg_delivery_days`, `moq`, `lead_time_days` — all computed by `supplierRating.service.ts`, **used in zero recommendation/comparison logic anywhere.**
- No stored supplier link exists on `variants`. Supplier lineage is derived *only* from the most recent received PO containing that variant (`demandIntelligence.service.ts`), defaulting lead time to 14 days when no history exists. **Superseded 2026-09-11 (STOCK-PROTECT-01, §14):** this is now the fallback used only when no approved Stock Protection Policy exists for the variant. When one exists, its explicit `planning_supplier_id` is authoritative and is never overridden by a newer PO.
- Multi-supplier-per-variant query returned 0 rows in current data (no variant has >1 historical supplier yet) — does not rule out future need; dataset is tiny (3 of 17 variants have any order history at all).
- **Decision: no `default_supplier_id` FK.** Locking a single default would regress the flexibility the data model already implicitly allows (each PO's supplier is independent of the variant). The recommendation page must compute fresh each time, ranking a variant's full supplier history, never assuming "last used = correct again."
- `purchase_orders.status` enum: `draft, ordered, confirmed, in_production, shipped, partially_received, received, cancelled`. `draft` maps directly onto "to be ordered" tracking — no new field needed.
- "Never-ordered-before, now reordered" counter: recommended as **persistent, derived live** via `MIN(poli.created_at)` grouped by variant (same technique as `customerLtv.service.ts`'s `first_order_at`) — not a stored counter that could drift. UI placement (candidate: Demand's pulse card, which already shows `critical_reorder_count`/`warning_reorder_count`) is suggested, **not locked.**
- "Total products to be ordered" — `ModuleTab.count` already supports a badge on the new Purchasing tab. Exact scope (global vs. per-supplier) was raised but not reconfirmed after the pivot to a dedicated page — **open, settle when designing the algorithm.**

## 3. Structural Plumbing (confirmed mechanical, not yet executed)

Three files, three small additions — routing is not the hard part:

- `apps/frontend/src/runtime/navBootstrap.ts` — new sidenav child under Purchasing (`id: 'suppliers'` duplicate between parent and child also needs fixing in this same edit, per explicit decision).
- `apps/frontend/src/pages/ft2-pages/purchasingSubTabs.ts` — new `ModuleTab` entry (can carry the count badge from §2).
- `apps/frontend/src/pages/ft2-pages/SuppliersPortalPage.tsx` — new `<Route>` + new `view` value passed to `SuppliersPortalModuleFT2`. **Not yet confirmed:** whether `view`'s prop type is a strict union needing a code change to extend, or already permissive — pending verification.

Tab/page name used as a placeholder throughout tonight's discussion ("Sourcing") — **not yet confirmed as final**, decide before implementation.

## 4. Not Yet Designed

The actual recommendation logic: how `on_time_rate` / `fill_rate` / `defect_rate` / `avg_delivery_days` / `moq` / `lead_time_days` combine into a single "this supplier fits this product" signal. This is the next workshop.

## 5. Update — 2026-06-29, plumbing shipped

§3's structural plumbing is done, not just confirmed mechanical: `navBootstrap.ts`, `purchasingSubTabs.ts`, `SuppliersPortalPage.tsx`, and `SuppliersPortalModuleFT2.tsx` (type widened to `'pos' | 'suppliers' | 'sourcing'`, three-way branch replacing the old binary ternary) all updated and verified live. Tab name "Sourcing" is final. The placeholder view (`PurchasingSourcingView`) renders "Sourcing recommendations are coming soon" — §4's algorithm is still the only thing standing between this tab and a real feature.

## 6. Final Design — 2026-06-30, grounded in a real trigger

§4's open question is now answered, designed backward from a **real,
concrete trigger** instead of abstractly: the "Acknowledge Stock Issue"
decision-execution path (`resolve_inventory_block.handler.ts`, live and
verified tonight) already fires a real `stockout_risk` alert with
exactly the inputs Sourcing needs — `entity_id` (the short variant),
`entity_type: 'variant'`, and a `message` containing the precise unit
shortfall. This is the actual real-world starting point for every
Sourcing recommendation; the page is designed to answer the question
this alert poses, not a hypothetical one.

**✅ Fixed, 2026-06-30 (confirmed in code 2026-07-01):** `stockout_risk`
now routes to `/suppliers-portal/sourcing?variantId=X` in both
`AlertsPage.tsx` and `TopnavbarContent.tsx` — the `/demand` routing
described above is no longer accurate, this line is kept for history.

### 6a. Two-branch recommendation logic

Every Sourcing recommendation falls into exactly one of two cases —
**no third case, no silent gap**:

**Branch A — variant has PO history.**

1. Find every supplier who has ever shipped this variant, via
   `purchase_order_line_items.lasyncro_variant_id → purchase_orders.supplier_id`
   (confirmed real FK relationship, not inferred).
2. Pull each candidate's live scorecard — `on_time_rate`, `fill_rate`,
   `defect_rate`, `avg_delivery_days`, `moq`, `lead_time_days` — all
   already computed by `supplierRating.service.ts`, currently unused
   anywhere. This design is their first real consumer.
3. Hard filter: exclude any supplier whose `moq` exceeds the alert's
   needed quantity (a supplier requiring 500 units when 12 are needed
   is not a real option for this stockout — surface it only if no
   other candidate exists, clearly labeled "exceeds MOQ").
4. Rank survivors by a simple weighted composite of on_time_rate,
   fill_rate (higher better), defect_rate (lower better) — exact
   weights are a tuning decision, not an architectural one; ship with
   equal weighting, adjust from real usage data.
5. Render ranked list, each row → pre-filled "Create PO" (qty = exact
   shortfall from the alert, supplier pre-selected) — mirrors the
   existing REPL-001 deep-link pattern (§1), same UX family.

**Branch B — variant has zero PO history (the question this session
raised).** Resolved by the 2026-06-29 workshop, not newly decided
tonight — re-stated here for implementation:

- **No `default_supplier_id` ever** — confirmed twice (workshop +
  tonight, independently, same conclusion). A variant's supplier is
  never a stored property; it is always derived fresh from real order
  history, because the schema already allows (and operators may
  deliberately use) different suppliers for the same variant across
  different orders — different MOQ, different lead time, different
  reason each time. Locking a default would be a real regression.
- These variants render in a **visually distinct "Never ordered
  before" group**, not silently dropped from the page and not mixed
  into the ranked list above (a 0-history variant has no real ranking
  signal — pretending otherwise would be the exact kind of implicit,
  unverified inference the constraint-system's explicit-data principle
  warns against, per the original workshop reasoning).
- Each row's action is **"Assign a supplier →"**, linking to the
  existing Suppliers tab — not a dead end, a real next step.
- **Live count, not stored**: `MIN(purchase_order_line_items.created_at)
  GROUP BY lasyncro_variant_id`, same proven technique as
  `customerLtv.service.ts`'s `first_order_at` — variants with zero
  matching rows are the "never ordered" set. No new column, no drift
  risk, matches the workshop's explicit decision.
- **Badge placement**: surfaced on the Purchasing tab itself
  (`ModuleTab.count`, already supports this — confirmed mechanical in
  §3) AND as the group header count on the Sourcing page itself. The
  workshop left exact placement open; this locks it to "both," since
  the tab badge answers "is there anything to look at" and the
  in-page group header answers "how many, specifically, right here."

### 6b. What ships in v1 vs. explicitly deferred

**v1 (this design, ready to build):**

- Branch A ranking (equal-weighted composite, MOQ hard filter)
- Branch B empty-state group with live count + assign-supplier action
- Pre-filled Create PO action from either branch

**Explicitly deferred, not silently dropped:**

- Tuning the composite weights from real usage data (stated above)
- Re-routing the `stockout_risk` alert from `/demand` to Sourcing
  (separate, small, tracked fix)
- Multi-supplier-per-variant tie-breaking logic beyond the simple
  composite — current dataset has zero variants with >1 historical
  supplier (§2), so this can't be meaningfully designed or tested yet;
  revisit once real multi-sourcing data exists.

## 7. Supplier-Product Preference System — 2026-07-10

> **Status:** Design approved. Implementation pending.
> **Unblocks:** ISS-SR-03, ISS-SR-04, ISS-SR-05, ISS-SR-06.
> **Prerequisite for:** MOQ accumulation system (§8, not yet written).

---

### 7.1 Design Principle

**Preference is advice, not law.**

The §2 and §6a decision to reject a hard `default_supplier_id` FK stands. But
deriving supplier *only* from PO history fails the never-ordered case and forces
repetitive decisions on merchants with stable supplier relationships. The robust
middle: a preference layer that *informs ranking but never bypasses it*.

A preference pins the preferred supplier to the top of the ranked list with a
"Preferred" badge — scorecard-ranked alternatives remain visible below. The
merchant sees their explicit choice AND the data. If a preferred supplier's defect
rate climbs, it shows every time. The system informs without overriding.

**No auto-selection. Ever.** A preference pre-selects the supplier in the Create PO
dialog. No PO is created toward a supplier without a human click. This is enforced
in UI and must never be relaxed in the backend.

---

### 7.2 Three-Tier Supplier Resolution

Every sourcing recommendation resolves through this cascade:

```
Tier 1 — Explicit preference      (merchant said so)
         ↓ if none found
Tier 2 — PO history + scorecard   (data says so, Branch A logic §6a)
         ↓ if no PO history
Tier 3 — Never ordered            (nobody knows yet → assign flow)
```

Tier precedence is strict. A variant with a Tier 1 preference still shows Tier 2
candidates below it — the preference doesn't *hide* alternatives, it *orders* them.
Tier 3 variants are always in a visually distinct group (see §6a, Branch B), never
mixed into the ranked list.

---

### 7.3 Schema — `supplier_product_preferences`

```sql
CREATE TABLE supplier_product_preferences (
  id            UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       INTEGER       NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  supplier_id   INTEGER       NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  -- Scope: what this preference applies to.
  -- 'variant'      → lasyncro_variant_id
  -- 'product'      → lasyncro_product_id
  -- 'product_type' → Shopify product_type string (e.g. "Knitwear")
  scope_type    TEXT          NOT NULL CHECK (scope_type IN ('variant', 'product', 'product_type')),
  scope_id      TEXT          NOT NULL,

  -- Priority within the same scope: 1 = primary, 2 = backup, etc.
  -- Allows "primary supplier + fallback supplier" per product without
  -- a new table — the merchant never needs to think about this as a
  -- concept, just as "first choice" and "backup".
  priority      SMALLINT      NOT NULL DEFAULT 1 CHECK (priority > 0),

  -- Merchant's own reasoning — free text, never structured.
  -- Conditions engine (min qty, price breaks, seasonal rules) is
  -- explicitly deferred — see §7.5.
  note          TEXT,

  created_by    INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

  -- One row per supplier+scope combination per shop.
  -- Multiple priorities (primary/backup) are allowed on the same scope.
  UNIQUE (shop_id, scope_type, scope_id, supplier_id)
);

-- RLS: tenant isolation
CREATE POLICY supplier_product_preferences_tenant_isolation
  ON supplier_product_preferences
  USING (shop_id = current_setting('app.current_tenant')::integer);

ALTER TABLE supplier_product_preferences ENABLE ROW LEVEL SECURITY;
```

**Resolution specificity rule (enforced in backend resolver, not DB):**
`variant` beats `product` beats `product_type`. Most specific scope wins.
When two rows share scope and scope_id, lower `priority` number wins (1 before 2).

---

### 7.4 Scope Types — ICP Coverage

| Scope | Use case | Example |
|---|---|---|
| `product_type` | Micro merchant, one supplier per category | "All knitwear → Wool & Co" — one rule covers 40 variants |
| `product` | Growing merchant, mixed sourcing | "Wool Sweater → Wool & Co, Linen Shirt → Linen House" |
| `variant` | Complex merchant, per-colorway sourcing | "WOOL-NVY → Factory A, WOOL-RED → Factory B (different dye supplier)" |

The merchant never needs to understand "scope" as a concept. The UI presents it as:

- "Apply to this variant only"
- "Apply to all variants of this product"
- "Apply to all [product type] products"

A radio group at assignment time — three options, plain language, no jargon.

---

### 7.5 What This Deliberately Does NOT Do (v1)

These are explicit deferrals, not oversights:

**No conditions engine.** Min qty triggers, price break tiers, seasonal supplier
switching — this is ERP territory. SMBs will not maintain a conditions config surface.
The `note` field carries merchant reasoning as free text. Structured conditions only
if usage data proves demand.

**No auto-PO creation.** The preference pre-selects; the human always confirms.
This is a hard product constraint, not a UX nicety — incorrect POs destroy supplier
relationships and waste capital.

**No multi-currency preference weighting.** Supplier ranking (§6a) uses operational
scorecards (on_time, fill, defect). Price comparison across currencies requires
exchange rate snapshots and adds a config surface. Deferred.

**No conditional routing.** "Use Wool & Co unless MOQ not met, then use Linen House"
requires reading the MOQ accumulator state during preference resolution. The MOQ
system (§8) must be designed and built first; conditional routing is a v2 feature
once both systems are live and stable.

---

### 7.6 How Preference Resolution Changes the Sourcing Page

**ISS-SR-06 (browse mode):** The Sourcing page gains a default state when reached
directly (no `?variantId` param). Instead of the current "No active stockout selected"
empty state, it shows:

- A "Preferences" section listing all existing `supplier_product_preferences` rows,
  grouped by scope_type, with edit/remove inline actions.
- The "Never ordered before" group below (Branch B, §6a).

This makes Sourcing a useful surface at all times, not just when reached from an alert.

**ISS-SR-03 (dead CTA fixed):** "Assign a supplier →" in the never-ordered group
opens an inline assignment drawer. The drawer shows the supplier list, the three scope
options (variant / product / product_type), an optional `note` field, and a
priority selector (Primary / Backup). On save, it writes a `supplier_product_preferences`
row and moves the variant out of the "Never ordered" group.

---

### 7.7 API Contracts (new endpoints required)

```
GET    /api/v1/suppliers/preferences
       → { preferences: PreferenceRow[] }
       Reads all preferences for the shop, grouped by scope_type.

POST   /api/v1/suppliers/preferences
       body: { supplier_id, scope_type, scope_id, priority?, note? }
       → { preference: PreferenceRow }

PATCH  /api/v1/suppliers/preferences/:id
       body: { priority?, note? }
       → { preference: PreferenceRow }

DELETE /api/v1/suppliers/preferences/:id
       → 204

GET    /api/v1/suppliers/sourcing-recommendations/:variantId
       (existing — extend to include preference tier in response)
       Add to each recommendation: { preference_tier: 1 | 2 | 3, is_preferred: boolean }
```

---

### 7.8 Preference Resolution in the Recommendation Endpoint

Extend `httpGetSourcingRecommendations` (§6a) with a pre-step:

```
1. Resolve preference for variantId:
   a. Look up supplier_product_preferences WHERE scope_type='variant' AND scope_id=variantId
   b. If none, look up WHERE scope_type='product' AND scope_id=(product of variant)
   c. If none, look up WHERE scope_type='product_type' AND scope_id=(product_type of variant)
   d. If none → no preference, proceed to Tier 2 as today

2. If preference found:
   - Add { is_preferred: true, preference_tier: 1, priority: row.priority } to that supplier's
     recommendation object
   - Sort: preferred suppliers first (by priority ASC), then scorecard-ranked remainder

3. Response shape unchanged — is_preferred is additive, not a breaking change.
```

---

### 7.9 MOQ Accumulation — Dependency Note

The MOQ accumulation system (§8, not yet designed) depends on this preference system
being in place first. When a reorder request is raised for a variant, the accumulator
needs to know *which supplier* to route it to before it can group requests toward that
supplier's MOQ threshold. Preference resolution (§7.2) answers that question.

**Build order is therefore fixed:**

1. `supplier_product_preferences` table + preference endpoints (§7.7) ← this design
2. Assignment UI on Sourcing page (ISS-SR-03, ISS-SR-06)
3. MOQ accumulation system (§8)
4. Reorder request → accumulator → PO portal flow

Do not start §8 until §7 endpoints and UI are live and verified.

---

## §8 MOQ Accumulation System — Design Draft

### 8.1 Design Principle

The accumulator is a **staging area between intent and commitment**. A merchant knows they need to reorder a variant but can't justify a PO yet — MOQ isn't met, or they want to bundle multiple variants into one shipment. The accumulator holds those requests, groups them by resolved supplier, and shows MOQ progress so the merchant knows exactly when to pull the trigger.

**Supplier is locked at queue time, not at convert time.** If a preference changes after a request is queued, the request keeps its original supplier. Silent re-routing between queue and PO creation would be a trust violation — the merchant selected a supplier deliberately.

**MOQ is advisory, not blocking.** "Create PO anyway →" is always available. The system informs; the merchant decides. Same principle as the existing `exceeds_moq` pattern in §6a.

---

### 8.2 Entry Points (Decision 1C)

**Alert-driven:** `stockout_risk` alert deep-links to Sourcing with `?variantId=X&needed=N`. The recommendation row gains an "Add to queue →" button alongside "Create PO →". Needed qty is pre-filled from the alert param. Supplier is pre-resolved via §7 Tier 1 preference, or merchant picks from the ranked Tier 2 list.

**Manual:** Merchant visits Sourcing directly (no alert). Any recommendation row or never-ordered variant can be queued. Supplier must be selected before queuing — never-ordered variants with no preference go through the existing "Assign a supplier →" flow (§7, ISS-SR-03) first.

**Supplier required at queue time in both cases.** A request without a supplier cannot be created — there is nothing to accumulate toward.

---

### 8.3 Schema — `reorder_requests`

```sql
CREATE TABLE reorder_requests (
  id                    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id               INTEGER       NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  -- The variant being requested — string ID, matches lasyncro_variant_id convention
  lasyncro_variant_id   TEXT          NOT NULL,

  -- Resolved supplier — locked at queue time, never re-resolved
  supplier_id           INTEGER       NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,

  -- Quantity the merchant wants to order for this variant
  qty_requested         INTEGER       NOT NULL CHECK (qty_requested > 0),

  -- How this request was created
  source                TEXT          NOT NULL CHECK (source IN ('alert', 'manual')),

  -- Lifecycle
  -- pending   → in accumulator, not yet on a PO
  -- converted → PO was created, request fulfilled
  -- dismissed → merchant removed it without converting
  status                TEXT          NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'converted', 'dismissed')),

  -- Set when status → converted. Soft reference — text to avoid FK type dependency.
  converted_po_id       TEXT,
  converted_at          TIMESTAMPTZ,

  created_by            INTEGER       REFERENCES users(id) ON DELETE SET NULL,
  created_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

-- RLS: tenant isolation
CREATE POLICY reorder_requests_tenant_isolation
  ON reorder_requests
  USING (shop_id = current_setting('app.current_tenant')::integer);

ALTER TABLE reorder_requests ENABLE ROW LEVEL SECURITY;

-- Primary query pattern: all pending for a shop, grouped by supplier
CREATE INDEX reorder_requests_shop_supplier_status_idx
  ON reorder_requests (shop_id, supplier_id, status);

-- Secondary: check existing pending requests per variant
CREATE INDEX reorder_requests_shop_variant_status_idx
  ON reorder_requests (shop_id, lasyncro_variant_id, status);
```

**No unique constraint on `(shop_id, supplier_id, lasyncro_variant_id)`** — multiple alerts for the same variant are allowed as separate rows. The API groups them by variant+supplier in the response. This preserves per-request traceability (which alert triggered which request).

---

### 8.4 API Contracts

```
GET    /api/v1/suppliers/reorder-requests
       → { by_supplier: SupplierAccumulation[] }

       SupplierAccumulation: {
         supplier_id:    number
         supplier_name:  string
         moq:            number | null
         total_qty:      number          -- sum of all pending qty for this supplier
         moq_met:        boolean         -- total_qty >= moq (false if moq is null)
         requests: [{
           id:                   string
           lasyncro_variant_id:  string
           sku:                  string | null
           title:                string | null
           qty_requested:        number
           source:               'alert' | 'manual'
           created_at:           string
         }]
       }

POST   /api/v1/suppliers/reorder-requests
       body: { lasyncro_variant_id, supplier_id, qty_requested, source }
       → { request: ReorderRequest }
       -- 400 if supplier not active or not belonging to shop
       -- 400 if variant not found in shop's catalog

DELETE /api/v1/suppliers/reorder-requests/:id
       → 204
       -- 404 if not found or wrong shop
       -- 400 if status !== 'pending'

POST   /api/v1/suppliers/reorder-requests/convert
       body: { supplier_id, expected_delivery_date?, notes? }
       → { po_id: string }
       -- Finds all pending requests for supplier_id in this shop
       -- Creates PO via existing httpCreatePurchaseOrder logic (reuse, not duplicate)
       -- Line items: one per unique lasyncro_variant_id, qty = sum of requests for that variant
       -- Marks all converted requests: status='converted', converted_po_id, converted_at
       -- 400 if no pending requests found for this supplier
```

---

### 8.5 How This Changes the Sourcing Page (Decision 3A)

The main decision card gains a **Pending Reorders section** between Preferences and Never Ordered. It only renders when `by_supplier.length > 0`.

```
PENDING REORDERS · 2 suppliers

┌─────────────────────────────────────────────────┐
│ Wool & Co                                       │
│ ████████░░  80 / 100 units MOQ                 │
│ WOOL-NVY-M  10u · WOOL-RED-L  15u · +3 more   │
│                          [Create PO →]          │
├─────────────────────────────────────────────────┤
│ Linen House                                     │
│ ███░░░░░░░  30 / 100 units MOQ  (MOQ not met)  │
│ LINEN-GRY-S  25u · LINEN-NVY-M  5u            │
│   [Create PO anyway →]          [Remove all]   │
└─────────────────────────────────────────────────┘
```

MOQ progress bar: `var(--accent)` fill when met, `var(--ink-3)` when not. "Create PO →" is Tier 1 (filled accent) when MOQ is met; "Create PO anyway →" is Tier 2 (ghost) when not — same pattern as §6a `exceeds_moq`.

Pulse card gains a third row: **Queued for reorder** showing total pending request count.

Recommendation rows (when `activeVariantId` is set) gain a secondary "Add to queue →" ghost button alongside "Create PO →", only when a preferred or ranked supplier is available.

---

### 8.6 What This Deliberately Does NOT Do (v1)

**No auto-convert.** MOQ being met never automatically creates a PO. Always a human click.

**No qty editing after queue.** Remove the request and re-add with the correct qty. Keeps the audit trail clean — no silent mutations.

**No cross-supplier accumulation.** Requests for the same variant but different suppliers are tracked independently. Merging would require re-routing logic that belongs in a future conditional routing feature (§7.5).

**No alert linkage FK.** `source` field records provenance as `'alert'` or `'manual'` without a hard FK to the alerts table. Avoids coupling the accumulator lifecycle to alert deletion.

---

### 8.7 Build Order

1. `reorder_requests` migration
2. `reorderRequests.controller.ts` — GET, POST, DELETE, convert
3. Wire routes into `suppliers.routes.ts`
4. Sourcing view: Pending Reorders section + "Add to queue →" on rec rows
5. Pulse card: Queued for reorder stat row

Do not start step 3 until step 2 endpoints are verified via curl. Do not start step 4 until step 3 is confirmed routing correctly.

---

## 9. Post-Sprint Workshop Findings — 2026-07-11

> **Status:** Gaps identified, ranked, and approved for implementation.
> **Context:** Full Suppliers Portal module review after completing §7 + §8.
> **ICP:** SMB commerce, 1–20 operators, own-warehouse fulfillment, high SKU complexity,
> $100K–$50M revenue, suffering from data fragmentation + daily firefighting.

### 9.1 What Shipped (Loop 2 at ~85%)

The Reorder Loop is now structurally complete end-to-end:
Stockout alert → Sourcing (ranked supplier) → Preference assignment → MOQ accumulator → Convert → Draft PO → Mark as sent → Receive via WMS → Sellable

Specifically shipped in this sprint:
- Three-tier supplier preference resolution (§7) — explicit → scorecard → never-ordered
- MOQ accumulation system (§8) — queue, group by supplier, convert to PO
- Never-ordered assign flow with scope selector (variant / product / product_type)
- Preference CRUD endpoints + browse mode on Sourcing default state
- Ranked recommendations with dual-path CTAs (Create PO / Add to queue)
- 3 onboarding spotlights with plain-language copy (§17 of onboarding playbook)
- PO first-line description preview in collapsed accordion rows
- Supplier MOQ + lead-time inline nudges with deep-link to Edit dialog
- Never-ordered data quality: `product_title` label, `has_sku` flag + "No SKU" nudge
- Dark mode fix: PO progress track pending nodes now use `var(--bg-3)` / `var(--ink-3)`

### 9.2 Gaps to Reach 100% (ranked by impact)

#### Gap 1 — Signal → accumulator not wired 🔴
**What's missing:** `stockout_risk` alert carries `?variantId=X&needed=N` in its deep-link.
`neededQty` is read from the URL param in `PurchasingSourcingView` but "Add to queue →"
on recommendation rows doesn't pre-fill with the alert's qty — it defaults to 1.
The merchant still has to manually type the right quantity.

**Why it matters:** The accumulator was designed to receive real shortfall quantities from
the demand signal. Without this wiring, the "no Excel step" promise breaks — the merchant
must cross-reference the alert to know how much to queue.

**Fix:** In `handleAddToQueue`, use `neededQty` (already computed from `?needed=` param)
as `qty_requested` instead of hardcoding 1. One-line change; already staged in the
`PurchasingSourcingView` state.

**Approved for implementation: next.**

---

#### Gap 2 — PO send is manual re-entry 🔴
**What's missing:** "Mark as sent" transitions status to `ordered` but the merchant still
re-types the PO into an email or WhatsApp message to actually notify the supplier.
This is the exact Excel-chaos / double-entry problem laSyncro claims to eliminate.
It sits in the middle of the core loop — every draft PO from the accumulator hits this wall.

**Fix (v1 — highest leverage, smallest scope):**
A "Send to supplier" action on draft POs that:
1. Generates a clean, human-readable PO summary (supplier name, line items, quantities,
   expected delivery date, notes).
2. Pre-fills a `mailto:` link addressed to `supplier.contact_email` with the PO as the
   email body — one click opens the merchant's own email client, ready to send.
3. Transitions status to `ordered` on click (same as "Mark as sent" today).

No backend email infrastructure needed for v1 — `mailto:` is a browser primitive.
The merchant sends from their own email account, maintaining the supplier relationship.
A future v2 can add SMTP/SendGrid for in-app sending once the pattern is validated.

**Approved for implementation: after Gap 1.**

---

#### Gap 3 — "Lifetime POs: 0" vs "6 open POs" contradiction 🟡
**What's missing:** `total_pos` in the suppliers query only counts received/completed POs.
The "open POs" badge counts active POs. When a supplier has 6 open POs but 0 received,
the UI shows contradictory data — trust-destroying for a data-integrity product.

**Fix:** Either rename the label to "Completed POs" (accurate to what it counts) or
change the count to include all non-cancelled POs. Needs a one-line query audit first.

**Approved for implementation: after Gap 2.**

---

### 9.3 Deferred (not this sprint)

- **Spend visibility per supplier** — total spend this quarter per supplier. Requires
  Finances module integration; that module is frozen pending product content decision.
- **Supplier portal / confirmation flow** — supplier receives and confirms PO via a link.
  Depends on Gap 2 (send flow) being live and validated first.
- **Conditional routing in accumulator** — "use Wool & Co unless MOQ not met, then use
  Linen House." Requires MOQ system (§8) to be live and stable; deferred per §7.5.

### 9.4 Gap 1 — Closed 2026-07-11

Signal→accumulator wiring confirmed working end-to-end:
- `?needed=N` URL param read into `neededQty` state in `PurchasingSourcingView`
- `handleAddToQueue` passes `neededQty` as `qty_requested` — real shortfall qty from alert flows into accumulator
- "Add to queue →" button: idle → adding (disabled) → "Added ✓" green flash (1.5s) → idle — eliminates ghost clicks
- Scorecard row: only populated fields rendered inline; "No order history yet" shown when all scorecard fields null
- Ghost-click root cause: zero visual feedback on async action; fixed with per-supplier `queueButtonState` map

---


---

## 10. Sprint 1 — Trust and Readiness (2026-08-18)

> Eleven issues closed. Verified against the commit log, not reconstructed.
> `git log --grep="SRC-"` is the chronological record; this section states the
> contracts that survived.

### 10.1 PO readiness gates (SRC-01a/b)

`reorder_requests` holds a shortfall **level**, not a running total: qty = MAX,
not `+=`. Enforced by migration `0151_unique_pending_reorder_request` (partial
unique index).

`GET /reorder-requests` returns per supplier group:

gates: { moq_met, lead_time_set, all_lines_have_sku }
po_ready: moq_met && lead_time_set && all_lines_have_sku


**Gate severity is not uniform.** Lead time and SKU coverage are HARD — convert
rejects 422. MOQ is SOFT — overridable via `override_moq: true` in the body,
which stamps the override on the PO notes. `po_ready` drives the UI button;
convert re-checks server-side and does not trust it.

### 10.2 Dates are calendar days (SRC-02, SRC-04)

A type parser is registered for Postgres OID 1082, returning raw `YYYY-MM-DD`
strings across all 10 DATE columns. Before this, `String(dateObject).slice(0,10)`
produced `"Wed Aug 12"` — a string that never compares less than `todayStr`,
which meant **no PO had ever reported overdue days**.

*Invariant: DATE columns are calendar days. Never convert them to instants, and
never compare them as strings without confirming the parser is in play.*

### 10.3 Shortfall is server-derived (SRC-03)

`?needed=` was a dead URL parameter — no writer existed anywhere in the codebase.
Replaced with a server-computed shortfall returned alongside `shortfall_basis`,
so the number's provenance is always visible. This also repaired `exceeds_moq`,
which guarded on `neededQty > 0`.

### 10.4 Shop timezone (SRC-05a/b/c, SRC-07)

Migration `0152_add_shop_timezone_source`. `shopClock.service.ts` interprets CPT
and shift windows in the shop's own timezone; the morning brief fires at 5am
local per shop rather than on one server clock. SRC-07 scoped the brief
resolver's own tenant reads.

### 10.5 The MOQ gap is reported, not hidden (SRC-06, SRC-09)

"445 more units to reach their minimum" is actionable. "Exceeds MOQ" reads as a
rejection and pushed merchants away from the supplier they should queue to. MOQ
progress is coloured by live status with a legend.

### 10.6 SRC-11 — the statistical trust audit

Not a defect audit. `demandIntelligence` was read-only and dashboard-facing, and
the question was whether its numbers could drive a purchase order.

Production measurement found `no_velocity` for **88% of the catalogue** under a
fixed 30-day window — too short for long-tail SKUs. The window became adaptive:

| Window | Chosen when | Confidence |
|---|---|---|
| 30d | `events30d >= 3` | `high` |
| 90d | `events90d >= 3` | `medium` |
| 180d | otherwise | `medium` if `events180d >= 3`, else `low` |
| — | `events180d === 0` | `none` |

An **event** is `COUNT(DISTINCT lasyncro_order_id) FILTER (WHERE fulfilled_quantity > 0)`.
`MIN_FULFILLMENT_EVENTS = 3`.

*This is the gate that decides whether the preventive path runs at all. A variant
with `demand_confidence: 'none'` produces `suggested_reorder_qty: null`, and the
Sourcing ladder falls back to the reactive number.*

### 10.7 Still open from Sprint 1

**SRC-08** (worker health) and **SRC-10** (stale chunk) were registered and never
shipped — no commits exist for either. They remain open.

### 10.8 The recurring defect shape

Five separate defects this sprint were **guards that read correctly and were dead
on execution**. All five surfaced by running the code, not reading it. Two more of
the same shape appeared in Sprint 2 and one in Sprint 3, both in freshly written
code. Treat a correct-looking guard as unverified until a run proves it fires.


---

## 11. Sprint 2 — Wiring the Preventive Signal (2026-08-19)

> Commits `38eb72c8`, `ef91142e`, `888c088f`, `57f41d6b` (SRC-12); `559002ef` (SRC-17).

### 11.1 The defect SRC-12 closed

Two subsystems answered "how much should I order," and **only the weaker one was
wired to the surface that creates POs**:

| | Sourcing (before) | Demand Intelligence |
|---|---|---|
| Quantity | `open_demand − available` | velocity × coverage − stock − inbound |
| Timing | after customers are already waiting | before the stockout |
| Fed | the accumulator and the PO | a dashboard |

The reactive number only moves once an order is already blocked. That is the fire,
not the warning.

### 11.2 `computeVariantPlanning` — the contract

```ts
computeVariantPlanning(
  trx: Knex.Transaction,
  shopId: number,
  variantIds?: string[]
): Promise<DemandVelocity[]>
```

**Invariants, all deliberate:**

- **Writes nothing.** Alert reconciliation stays in `computeDemandIntelligence` so
  a read-path caller (Sourcing) cannot trigger write side-effects.
- **Caller owns the transaction and the tenant scope.** It runs RLS-protected
  queries and does not set `app.current_tenant` itself.
- **Variant-filterable**, so Sourcing can plan one variant without a catalogue scan.
- **One copy of the formula.** Sourcing calls this function rather than
  reimplementing it or making an internal HTTP call to the Growth-gated route.

### 11.3 The coverage formula

targetCoverageDays = supplier_lead_time_days + SYSTEM_SAFETY_DAYS(5)
+ SYSTEM_PURCHASING_CYCLE_DAYS(7)

suggested_reorder_qty = max(0, ceil(
velocityPerDay × targetCoverageDays

openDemand
− available
− reliableInbound
))

Null when `velocityPerDay === 0` or `targetCoverageDays === null` (no lead time).
Both safety and cycle days are explicit system defaults until configurable
SKU/supplier/shop policy fields exist. `target_coverage_days` is exposed through
the full stack so the UI states real coverage rather than duplicating constants.

### 11.4 The quantity ladder

Sourcing resolves a quantity **and a named basis**, so the operator always sees
which number they are acting on. There is never a silent substitution.

| Basis | Condition | Quantity |
|---|---|---|
| `reactive` | no planning row, or velocity+lead time present but no usable suggestion, with open demand | `neededQty` |
| `preventive` | suggestion > 0 | `max(suggested, neededQty)` |
| `reactive_no_history` | `demand_confidence === 'none'`, open demand exists | `neededQty` |
| `no_signal` | `demand_confidence === 'none'` or zero suggestion, no open demand | `neededQty` |
| `reactive_no_lead_time` | no supplier lead time, open demand exists | `neededQty` |
| `planning_data_required` | no supplier lead time, no open demand | `neededQty` |

**`queue_qty = max(suggested, shortfall)` — never queue less than customers are
already waiting for.** `units_to_moq` measures against `queue_qty`, not the
reactive shortfall, so MOQ progress describes the quantity that will be queued.

**Ladder ordering is load-bearing.** `demand_confidence === 'none'` must be tested
BEFORE missing lead time. A variant with no sales history also has no PO history
and therefore no lead time; testing lead time first made the no-history branch
unreachable for exactly the variants it describes. This was found by execution
after passing review — the second instance of §10.8's shape.

### 11.5 SRC-17 — dev seed fulfilled demand

`dev_seed.ts` marked orders fulfilled while leaving `fulfilled_quantity` at 0.
Since demand means units that shipped, every seeded variant had zero velocity.
Fixed by hoisting `isFulfilled` before the revenue-unit insert and using
`orderDate` rather than `now` so events spread across 28 days. Both seeded
suppliers gained lead time and MOQ (Wool & Co 10d/50, Linen House 21d/100).

> **This did not achieve its stated outcome.** See §12.5 — `order_fulfillment_status`
> is empty on freshly seeded databases, and the demand history query INNER JOINs it.
> Local velocity is still zero. SRC-17 fixed one of two prerequisites.


---

## 12. Sprint 3 — SRC-18, the Zero-Units Alert (2026-08-19)

> Commits `b4371f1e`, `f9ff0603`, `84a5155f`, `4bd57106`.
> Registered as one issue ("stockout produces reorder 0 units"); the audit found
> **four separate defects**, only one of which was the registered one.

### 12.1 SRC-18a — inbound was ETA-blind

`reliable_inbound` filtered on `po.status IN ('ordered','confirmed','in_production')`
and nothing else, then was subtracted in full. `expected_delivery_date` has existed
on `purchase_orders` since migration `0095` and was never read.

A time-bounded question — how much do I need for the next N days — was answered with
an unbounded quantity. **A PO landing in 90 days suppressed a reorder needed in 20.**

The inbound query is now detailed rather than grouped, carrying `days_out` per line,
and the per-variant loop sums only lines with `days_out <= targetCoverageDays`.

*Why not window it in SQL: `targetCoverageDays` depends on the variant's own supplier
lead time. It is not one horizon, it is one per variant.*

**Null `days_out` counts as IN window.** The manual PO path writes
`expected_delivery_date ?? null` while the reorder-conversion path derives one, so
nulls are real POs. Excluding them would drop committed stock and inflate suggestions.
Consequence: this change can only ever subtract LESS inbound than before — it can
raise a suggestion, never suppress one that fires today.

Negative `days_out` (overdue, unreceived) also stays in window. Overdue is not absent.

### 12.2 SRC-18b — a zero forecast wearing a forecast's name

The ladder tested `suggestedQty !== null` first. `0 !== null` is true, so a zero
suggestion took the `preventive` branch and reached the operator as **0 units with a
basis asserting a forecast was made** — on a number meaning "do not order."
Indistinguishable from a real recommendation, in the one structure built specifically
to never substitute silently.

Now gated on `suggestedQty > 0`; zero falls to the existing tail.

**Accepted tradeoff (decision B2):** `no_signal` now covers both "no data to forecast
with" and "forecast ran, coverage already met." The UI cannot distinguish them and so
cannot say "already on order — nothing to queue." A dedicated `covered_by_inbound`
basis was considered and deliberately not taken. Open as a copy question.

### 12.3 SRC-18c/d — two writers on one alert key

`demand:stockout_risk:{variantId}` had two writers with different numbers and
different semantics; last write won the row.

| | `demandIntelligence` | `resolve_inventory_block` handler |
|---|---|---|
| Message | forecast, net of inbound | `order_qty − available`, ignores inbound |
| Trigger | someone opens Demand/Products/aha | operator resolves a block |
| Lifecycle | reconciled every run | never resolved |

The handler's message could **tell a merchant to reorder units already on an open PO.**

Fixed by making the handler call `computeVariantPlanning` and emit through the new
`emitStockoutAlerts`, so both paths publish one message from one set of numbers.

**`emitStockoutAlerts(trx, shopId, variants, reconcile = true)`.** The sweep resolves
every active `source: 'demand'` alert absent from `variants`, which is only sound for
a caller holding the full catalogue. The handler knows one order's variants and passes
`false` — sweeping there would deactivate every other variant's stockout alert in the
shop. **That was SRC-18d**, and it resolves as a consequence of the single-writer fix.

**Behaviour change (accepted):** only variants the planner marks `critical` alert. A
partial shortage (5 held, 10 needed) is an order-allocation problem the order-block UI
already surfaces, not a reorder signal.

**There is no scheduled demand run.** `computeDemandIntelligence` has four callers,
all request-driven: the Demand module, the Products operator view, and two aha
endpoints. An alert written by the handler is reconciled only when a merchant next
opens one of those screens.

### 12.4 Verification status — read this before trusting a number

| Issue | Verified how |
|---|---|
| 18c/d | **Executed.** Drained a local variant, invoked the handler, confirmed demand-format message with `category`/`audience` populated, one row, and a sentinel alert left untouched proving `reconcile=false`. |
| 18b | `tsc` and code reading only. |
| 18a | `tsc`, plus DB-level confirmation that `expected_delivery_date - CURRENT_DATE` returns `integer`, not an OID 1082 string. |

**Neither 18a nor 18b was exercised by data.** Both need a variant with velocity;
18a additionally needs a distant-ETA PO. All production and local PO lines currently
land inside any plausible window, so 18a moves no number that exists today. Blocked by
§12.5.

One correction worth carrying: 18c's verification proved the **routing**, not the
arithmetic. The `reorder 1 unit` observed came from open demand minus availability —
`velocityPerDay` was 0 throughout, because of §12.5.

### 12.5 SEED-VELOCITY-01 — open, cause unidentified

**`order_fulfillment_status` has zero rows on a database seeded the same day.**

The demand history query INNER JOINs that table and filters on
`ofs.fulfilled_at >= window180Start`. With no rows, **every variant is dropped from
the history map** and returns `demand_confidence: 'none'`. The preventive reorder path
is unreachable locally, catalogue-wide.

Evidence gathered:

- The insert at `dev_seed.ts:1028` is unconditional, in the same loop and the same
  transaction as the `orders` and `order_revenue_units` inserts, which produced 15
  rows each
- The projection-writer bypass is set at both line 37 and 1027, the setting name
  matches `enforce_projection_writer_order_fulfillment_status` exactly, and that guard
  **raises** rather than skipping — a failed bypass would have crashed the seed
- No truncate, no delete, one transaction for the whole seed
- `fulfilled_quantity` is correct (SRC-17 landed), so the seed did reach that line

**Next step:** run the seed with output captured and check whether line 1067's
`[DEV_SEED] Created 15 orders with revenue units and fulfillment status` prints.

*Blocks: SRC-18a and SRC-18b verification, SRC-13.*

### 12.6 SEED-LEDGER-01 — open

`inventory_movements` has zero rows for seeded variants; `inventory_truth` is written
directly. Consequences: `npm run rebuild -w apps/backend` cannot restore local
inventory, any test perturbing stock leaves permanent drift, and the event-sourced
inventory path cannot be exercised locally at all. May share a cause with §12.5.

*If you drain stock for a fixture, restore it with
`available_quantity = on_hand_quantity - reserved_quantity - committed_quantity`.
The rebuild will not do it for you.*

### 12.7 SRC-18e — open

The alert answers "how much to reorder" while the operator is looking at "how much to
unblock this order." Both correct, different questions, one surface. In the verified
run the alert read `reorder 1 unit` on an order needing 3.

### 12.8 Interaction worth watching

18a can only raise suggestions; 18b stopped zeros from claiming to be forecasts.
Together they move the system toward suggesting more reordering. Correct where inbound
genuinely arrives late, but on a catalogue where merchants leave ETAs distant or unset
it may read as over-ordering. No evidence either way yet — `n=3` in production.


## 13. SOURCING-UX-COGNITIVE-01 — Targeted Recovery Foundation

*Slice 1A. CLOSED / VERIFIED / DEPLOYED 2026-09-03. Slice 1B (§13.12–13.18),
Slice 2, the Unified Sourcing Worklist (§13.19–13.21), and Slice 2B, its
post-live-UX worklist-alignment correction (§13.22–13.24), are also CLOSED /
VERIFIED. There is no Slice 3. The umbrella issue SOURCING-UX-COGNITIVE-01 is
therefore **CLOSED / VERIFIED** — see §13.10.*

The Sourcing screen was designed as a portfolio surface. When a merchant arrived
from a blocked order they met that portfolio surface unchanged: ranked
suppliers, a bare shortfall number, and a page that could not name the product
they had come to rescue. Slice 1A gives that arrival its own shape. It changes
what the merchant *understands*, not what they can *do* — see §13.8.

### 13.1 Two Sourcing modes

| Mode | Entry | Surface |
|---|---|---|
| **Generic** | `/suppliers-portal/sourcing` — no `variantId` | Level 1 — the Unified Sourcing Worklist (§13.19). Unchanged by Slice 1A; replaced by Slice 2 — see the historical note below. |
| **Targeted** | `/suppliers-portal/sourcing?variantId=<canonical_variant_id>` | Level 2 detail — recovery for one variant. |
| **Targeted, order-originated** | `…?variantId=<canonical_variant_id>&orderId=<canonical_order_id>` | Same Level 2 detail, plus the context of which order sent the merchant. |

*Historical (pre-Slice-2, superseded 2026-09-03): generic mode rendered
Supplier Preferences administration, Never Ordered Before, and Sourcing Pulse
directly, with no worklist, filtering, or categorization. That markup is no
longer reachable in generic mode — see §13.19–13.20.*

`variantId` is the canonical sourcing subject. `orderId` is the canonical
internal `orders.lasyncro_order_id` — never an external Shopify id or a display
order number, neither of which can be matched against canonical order state.

Targeted entry bypasses the Level 1 Unified Sourcing Worklist: the merchant
already knows which product is in trouble. See §13.11 for the ratified two-level
architecture that replaced the earlier three-level model.

### 13.2 Targeted response contract

`GET /api/v1/suppliers/sourcing-recommendations/:variantId`

Every pre-existing field is preserved — `variant_id`, `shortfall`,
`shortfall_basis`, `suggested_reorder_qty`, `queue_qty`, `quantity_basis`,
`planning_context`, `recommendations`, `has_preference`. Slice 1A is purely
additive:

| Field | Meaning |
|---|---|
| `image_url` | Variant image, or `null`. Never a fabricated fallback. |
| `product_title` | Product title of the requested canonical variant. |
| `variant_title` | Variant title. |
| `sku` | Variant SKU, or `null`. |
| `open_demand` | Aggregate outstanding demand for the variant. |
| `available` | Summed available inventory truth. |
| `committed_inbound` | Remaining units already bought — see §13.4. |
| `short_now` | See §13.3. |
| `still_to_source` | See §13.3. |
| `blocking_orders` | Canonical orders waiting on this variant — see §13.5. |
| `originating_order_id` | Echoed context — see §13.5. |

Status semantics (§13.7 covers how the UI renders each):

- **404** — unknown or non-tenant-owned target. A broken deep link is not the
  same fact as a product nobody has ordered from yet, and must not be told to
  the merchant as though it were.
- **200 with `recommendations: []`** — a real variant with no supplier history.
  Still a valid targeted result: identity and purchasing truth render normally.

### 13.3 Purchasing truth

```
short_now       = max(0, open_demand - available)
still_to_source = max(0, open_demand - available - committed_inbound)
```

**Short now** is the current customer-demand gap *before* counting anything
already purchased. **Still to source** is what remains unsecured *after*
committed inbound, and is the number the merchant actually acts on.

They are deliberately distinct. Collapsing them tells a merchant who already has
stock on the way to buy it a second time. Both are clamped at zero so an
oversell (negative availability) or an over-receipt cannot produce a negative
requirement.

Every one of these numbers is computed server-side. The UI displays them; it
never recomputes them.

### 13.4 Committed inbound

Units already bought from a supplier and not yet received.

**Included** — remaining quantities from purchase orders in these five statuses:

`ordered` · `confirmed` · `in_production` · `shipped` · `partially_received`

**Excluded**, each for its own reason:

- `draft` — not yet placed with anyone, so nothing is coming;
- `received` — already landed, so it lives in inventory truth, not inbound;
- `cancelled` — never arriving.

For a partially received line:

```
remaining = max(quantity_ordered - quantity_received, 0)
```

Clamped so an over-receipt cannot subtract phantom units from the requirement.
A line ordered 5 / received 3 contributes **2**, never 5.

`reorder_requests` are **not** committed inbound. A pending request is buying
intent pooled toward a supplier's MOQ (§8) — no supplier commitment, no ETA.

This is the **merchant-facing** "what is already coming" set. It is
intentionally *not* demandIntelligence's narrower, ETA-windowed "reliable future
inbound", which answers a planning question. Two questions, two definitions,
both canonical, kept apart deliberately. Do not merge them, and prefer the term
**committed inbound** over "confirmed inbound", which implies the single
`confirmed` PO status rather than the five-status set.

The aggregate is computed in its own query, never joined onto demand or
inventory: a variant with three open POs and two inventory rows would otherwise
multiply through a many-to-many join and inflate both sides.

### 13.5 Blocking and originating orders

`blocking_orders` is derived server-side from canonical order state — orders for
this variant with positive outstanding demand — and carries the canonical
internal `order_id`, the external/display identifier where one exists, and the
outstanding units. A fully fulfilled order for the same variant blocks nothing
and does not appear.

`originating_order_id` is echoed **only** when the supplied `orderId` is
genuinely one of those server-derived blocking orders. An unrelated same-tenant
`orderId` yields `null` and is not injected into `blocking_orders`.

This matters beyond tidiness: without the allow-list, the parameter would let a
caller have the server confirm arbitrary order ids — a read widening dressed up
as UX context.

`orderId` is read only after every derived number is already fixed. It must not
affect `open_demand`, `available`, `committed_inbound`, `short_now`,
`still_to_source`, or blocking-order derivation.

### 13.6 Targeted information hierarchy

In targeted mode the surface sequences the decision:

1. **Identity** — image or stable placeholder, product title, variant title,
   SKU. What am I looking at?
2. **Purchasing truth** — still to source (visually dominant), with open demand,
   available, inbound and short now supporting it. How many must I actually buy?
3. **Blocking / originating context** — how many orders are waiting, and which
   one sent me here.
4. **Supplier candidates and existing supplier mechanics** — ranking, MOQ, Add
   to queue, Create PO. All unchanged by Slice 1A.

Portfolio-only content is **suppressed** while a target is active: Never Ordered
Before, Sourcing Pulse, and the generic Supplier Preferences administration
block. Each is backlog about *other* products and competed with a single urgent
recovery. Suppression is scoped to targeted mode only — Slice 1A left generic
mode preserving all three exactly as before. Slice 2 (§13.19–13.20)
subsequently replaced generic mode's own default content with the Unified
Sourcing Worklist; that later change does not alter targeted-mode suppression
described here.

Suppression stops at the portfolio boundary: supplier candidates for the target
are never suppressed. They are the answer to the merchant's question.

### 13.7 Target load states

Exactly three mutually-exclusive states: `ok` · `not_found` · `error`.

| Situation | Renders | Must NOT render |
|---|---|---|
| **404** | explicit not-found state | no-history state; generic load-error |
| **200, valid target, zero recommendations** | targeted identity + purchasing truth, plus "No supplier history for this product yet." | not-found; load-error |
| **non-404 fetch failure** | explicit load-error state | not-found; no-history state |

Held as one value rather than parallel booleans precisely because they are
mutually exclusive. The failure this prevents: a 404 that also cleared
recommendations satisfied the legacy "no supplier history" gate, so a broken
deep link told the merchant something false about their own catalogue.

### 13.8 Read versus action boundary

Opening targeted sourcing is a **read**. It must not create a PO, queue a
reorder request, assign a supplier, alter inventory, receive stock, or resolve
an order constraint.

Slice 1A therefore does **not** resolve the blocked order and does not make
inbound stock immediately fulfillable. It changes what the merchant understands
on arrival. Targeted recovery *actions* and state transitions are Slice 1B.

Supplier ranking and MOQ mechanics are untouched by this slice.

### 13.9 Verification

Automated (2026-09-03):

| Gate | Result |
|---|---|
| Backend targeted integration | 15/15 PASS |
| Frontend targeted Sourcing | 10/10 PASS |
| Orders sourcing-entry regression | 3/3 PASS |
| Backend TypeScript | 0 errors |
| Frontend TypeScript | 0 target errors (19 unrelated baseline errors) |
| suppliers-portal build | PASS |
| Test ownership | UNOWNED=0, MULTI_OWNED=0 |
| Disposable integration DB | created → migrated → runtime OK → dropped, ORPHAN_DB_COUNT=0 |

Generated artifacts changed, exactly four:
`modules/suppliers-portal/dist/ui/pages/SuppliersPortalModuleFT2.{d.ts,d.ts.map,js,js.map}`

Live browser — **LB-SRC-01 through LB-SRC-12 PASS**. Journey: order **#800001**
(canonical `eea5bc08-d706-0ff9-62e9-cd08f9c05d4d`) → "Source this item" →
variant `cb3592bc-1951-4c0b-aa39-306c5d6ef0dd` (QA Products / QA Shirt /
QA-SHIRT-S). Targeted values shown: Available 0 · Open demand 1 · Inbound 10 ·
Short now 1 · Still to source 0 — a fixture where inbound fully covers the gap,
which is exactly the case that makes the short-now/still-to-source distinction
legible. Also observed: the neutral image placeholder (this variant has no
image), the originating/blocking order 800001, QA Test Supplier, and both Add to
queue and Create PO still present. Suppressed as specified: Never Ordered
Before, Sourcing Pulse, generic Supplier Preferences administration. Generic
mode at `/suppliers-portal/sourcing` was separately verified to preserve all
three. Runtime module resolution was proven worktree-local rather than resolving
to the main repository's package.

**Production certification.** Commit
`41060ca8d3292e70796186bb2dbdef61620642bf`, local HEAD equal to `origin/main`:
`https://app.lasyncro.com/health` → HTTP 200 and `https://app.lasyncro.com/` →
HTTP 200; CI — UI modules SUCCESS; CI / RLS Security Boundary SUCCESS; Fly
Deploy SUCCESS. The Fly workflow included successful privileged migrations,
privileged credential rejection on the runtime role, and runtime deployment.
Worktree clean after certification. Slice 1A is therefore **CLOSED / VERIFIED /
DEPLOYED**.

### 13.10 SOURCING-UX-COGNITIVE-01 delivery status

| Slice | Scope | Status |
|---|---|---|
| 1A | Targeted recovery foundation (Level 2 understanding) | **CLOSED / VERIFIED / DEPLOYED 2026-09-03** |
| 1B | Targeted recovery actions and state transitions (Level 2) | **CLOSED / VERIFIED 2026-09-03** |
| 2 | **Unified Sourcing Worklist** (Level 1) — portfolio awareness, categories, filters, sorting, search, actionable SKU/variant list, using laSyncro's familiar operational-list conventions | **CLOSED / VERIFIED 2026-09-03** |
| 2B | Worklist UX alignment + contextual row actions — post-live-UX correction to Slice 2 (modules-UX-playbook token/CTA alignment, zero-state MOQ panel, category-conditional row actions, revised `needs_supplier` copy) | **CLOSED / VERIFIED 2026-09-03** |

There is **no Slice 3**. The earlier roadmap's separate "L1 Sourcing overview"
slice was removed on 2026-09-03 when the architecture was reduced to two levels
— see §13.11.

With every slice closed and no Slice 3, the umbrella issue
**SOURCING-UX-COGNITIVE-01 is CLOSED / VERIFIED**. Slice 2's contract, data
model, architecture and automated evidence are recorded in §13.19–13.21; Slice
2B's additive correction is recorded in §13.22–13.24.

Open cognitive-load follow-up, carried forward and **not resolved**: the
existing large "Your best supplier, ranked automatically" coachmark visually
competes with purchasing truth in targeted mode. It was not a Slice 1A blocker
and was not addressed.

### 13.11 Sourcing architecture — two levels

*Ratified 2026-09-03. Supersedes the three-level model (L1 Sourcing Overview /
L2 Variant-SKU Worklist / L3 Detail) recorded earlier in this section. The
former L1 and L2 are **merged**; there is **no separate Sourcing Overview
screen**.*

| Level | Surface | Answers |
|---|---|---|
| **Level 1** | Unified Sourcing Worklist | *Where do I need to act?* |
| **Level 2** | Product / Variant Sourcing Detail | *How do I resolve this exact SKU?* |

> The unified worklist tells me where to act.
>
> The detail tells me how to act.

**Level 1 — Unified Sourcing Worklist.** Portfolio awareness, prioritization,
categorization, filtering, sorting, search, and the actionable variant/SKU list,
all on one surface. What the former L1 and L2 were each meant to provide is
delivered here. Portfolio-level information is expressed *through the working
list itself* — summary and filter controls, categories, counts, sorting,
status-based grouping — not on a separate screen the merchant must pass through
first.

**Level 2 — Product / Variant Sourcing Detail.** The complete sourcing decision
for one canonical variant/SKU. Slice 1A implemented the foundation of this level
(§13.1–13.8); Slice 1B added its targeted actions and state transitions
(§13.12–13.17).

**Order-originated recovery.** Orders → *Source this item* → Product/Variant
Sourcing Detail, **bypassing the Unified Sourcing Worklist**. The Slice 1A route
semantics are unchanged: `variantId` is the sourcing subject, `orderId` is
optional context only (§13.1, §13.5).

#### Lean-screen principle

When portfolio summary and operational work concern the same underlying objects,
prefer:

> summary → **filter / sort / categorize the working surface**

over:

> summary → **navigate to another overview or worklist screen**

The goal is less navigation, less duplicated information, lower cognitive load,
and less onboarding effort. "One screen" does **not** mean "show every field at
once" — the worklist stays lean and uses progressive disclosure.

#### Cross-module UX consistency

The Unified Sourcing Worklist should reuse laSyncro's established operational
list conventions, in particular the interaction grammar already used in Order
Flow:

> categorize → filter → scan → select → act

Reuse where it fits: category/group headings with counts, compact operational
rows, search and filter controls near the list, urgency or priority shown
in-row, consistent action placement, collapsible categories. The requirement is
**shared interaction grammar, not an identical screen structure** — Sourcing is
not required to copy Order Flow's three-column layout.

#### Worklist / Detail boundary

The worklist tells the merchant **where** to act; the detail level tells them
**how**. The worklist stays compact. Candidate row-level information: product /
variant / SKU identity, a small image, the primary attention reason, still to
source, available and inbound, blocked-order count, supplier readiness,
purchasing state, and one contextual action such as *Review →*.

Supplier ranking, MOQ detail, supplier alternatives, PO mechanics and other
decision-heavy content belong at the Detail level. Exact visual implementation
beyond this is not yet ratified and is deliberately not specified here.

#### Status model

Four orthogonal internal dimensions are preserved — **attention**, **supplier
readiness**, **purchasing stage**, **coverage**. They must **not** be collapsed
into a single flattened canonical status field.

Merchant-facing categories are *derived* from those dimensions. Examples
discussed: Needs action · Ready to order · Needs supplier · Covered by inbound ·
Queued. These are worklist and categorization concepts, **not** a newly
persisted status enum.

Nothing in §13.11 changes the Slice 1A purchasing semantics in §13.3–13.5.

### 13.12 Slice 1B workflow model

*Targeted recovery actions and state transitions. CLOSED / VERIFIED 2026-09-03.*

The purchasing lifecycle keeps intent, prepared work, committed supply and
fulfillment capacity distinct:

- a **reorder request** is intent;
- a **draft PO** is prepared purchasing work;
- `ordered`, `confirmed`, `in_production`, `shipped` and
  `partially_received` POs are **committed inbound**;
- **pickable inventory** is fulfillment capacity.

Slice 1B adds four workflow fields for the current tenant and canonical variant:

```
pending_queue_qty = pending reorder quantity
draft_po_qty      = remaining quantity on draft PO lines
in_purchasing     = pending_queue_qty + draft_po_qty
unplanned         = max(0, still_to_source - in_purchasing)
```

Queue and draft quantities describe purchasing workflow; they are **not
committed inbound**. These fields do not redefine the Slice 1A supply truth in
§13.3–13.4.

### 13.13 Dominant action state model

Targeted Detail exposes **one dominant next action for the SKU's current
state**:

| State | Condition | Action |
|---|---|---|
| **Covered by inbound** | `still_to_source = 0` and committed inbound exists | **View inbound**; no new purchase action |
| **Draft coverage** | Draft purchasing work covers the remaining need | **Review draft PO** |
| **Queue coverage** | Pending queue covers the remaining need | **Review queue** |
| **Needs supplier** | No usable supplier | **Assign supplier** |
| **Below MOQ** | Purchasing is still required and supplier MOQ favours accumulation | **Add to queue** primary; **Order now instead** secondary |
| **Ready to purchase** | MOQ is satisfied or there is no MOQ | **Prepare PO** primary; **Add to queue** secondary |

Creating a draft PO, sending a PO, or receiving stock does not automatically
clear a blocked order. Fulfillment becomes possible only when enough inventory
becomes pickable.

### 13.14 Targeted assignment and PO continuity

Targeted supplier assignment stays on the same targeted URL and in the same
context. It preserves `variantId` and the originating `orderId`, then refetches
the same targeted recommendation; it does not navigate to Supplier Settings.

The targeted **Prepare PO** handoff preserves the exact selected supplier,
canonical variant linkage, an identity-bearing product description, and an
editable targeted purchase quantity. The edited quantity passes through to the
PO dialog. The operation creates a **draft PO** and does not automatically
transition it to `ordered`.

### 13.15 Targeted media and decision composition

The desktop Detail composition is **MEDIA + DECISION**.

When the canonical Shopify-synced variant has `image_url`, the Detail renders
prominent, contained product media using the same Shopify-synced image data
already used elsewhere in laSyncro. The image aids SKU recognition and is not
unnecessarily cropped. When `image_url` is absent, there is no large blank
media panel: a compact product placeholder renders and the decision region
expands into the available space.

Targeted Sourcing must reuse the merchant's Shopify-synced catalog image data.
It must never substitute a synthetic or generated image, an unrelated SKU
image, a stock or decorative image, or an independent Sourcing-specific image
source. No new product-featured-image fallback is established here.

The decision region answers three questions in order:

1. **What is this?** Product, variant and SKU.
2. **What is the purchasing truth?** Still to source, open demand, available,
   committed inbound, short now, and blocking/originating order context.
3. **What should I do next?** The dominant state-driven action.

For a new purchasing state, quantity belongs with the Next Action area. For
continuation or non-purchasing states — View inbound, Review draft, Review
queue, Assign supplier — no editable purchasing quantity is shown.

### 13.16 Slice 1B live-browser evidence

| Check | Result |
|---|---|
| LB-SRC-1B-10 | **PASS functionally.** View inbound reaches the existing Open POs surface. |
| LB-SRC-1B-11 | **AUTOMATED contract PASS.** Live visual certification was N/A because the local QA catalog contains no Shopify-synced image-bearing fixture. This is not a blocker: image rendering has automated protection, laSyncro already syncs Shopify variant images and uses them in existing product-selection/PO workflows, and unrelated visual evidence was deliberately not fabricated. |
| LB-SRC-1B-12 | **PASS.** The no-image target uses the compact fallback. |
| LB-SRC-1B-13 | **PASS.** Desktop truth/action composition uses width meaningfully. |
| LB-SRC-1B-14 | **PASS.** Covered-by-inbound exposes no purchasing quantity. |
| LB-SRC-1B-15 | **PASS.** Live purchasing fixture showed still to source 5, open demand 15, available 0, inbound 10 and unplanned 5. Quantity began at 5; the merchant edited it to 9; the Prepare PO dialog preserved QA Test Supplier, `QA Products · QA Shirt · QA-SHIRT-S`, and quantity 9. |

The LB-SRC-1B-15 temporary QA mutation was fully restored: order quantity
`15 → 1`, fulfilled quantity remained `0`, and the variant image
remained/restored `NULL`.

**Follow-up — SRC-INBOUND-CONTEXT-01 | P2 UX | OPEN.** View inbound currently
loses variant-specific context after navigation. Future behaviour should
preserve variant context; identify, highlight or filter all contributing open
POs; and auto-expand only when a single relevant PO is unambiguous. This was
not implemented in Slice 1B.

### 13.17 Slice 1B automated evidence

| Gate | Result |
|---|---|
| Slice 1B backend targeted integration | 21/21 PASS |
| Slice 1B frontend action/media | 19/19 PASS |
| Slice 1A targeted regression | 10/10 PASS |
| Orders → Sourcing entry | 3/3 PASS |
| Backend TypeScript | 0 target errors |
| Frontend TypeScript | 19 pre-existing baseline errors; 0 target-related errors |
| Jest ownership | backend-legacy 133; backend-integration 35; contract 10; frontend 129; UNOWNED=0; MULTI_OWNED=0 |
| Disposable integration DB | ORPHAN_DB_COUNT=0 |
| Generated suppliers-portal runtime contract | PASS |

The repository-wide frontend TypeScript check is not clean; the 19 errors are
the recorded pre-existing baseline.

### 13.18 Preserved open and parked work

Slice 2, the Unified Sourcing Worklist, and Slice 2B, its post-live-UX
correction, are both CLOSED / VERIFIED — see §13.19–13.24. There is no Slice
3. The following adjacent issues retain their existing states and are **not**
closed or redefined by Slice 1B, Slice 2, or Slice 2B:

- `BUILD-02` | P1 | **CLOSED 2026-09-18 via #1140** — workspace `dist`
  is generated-only and untracked. Package/module outputs are produced by
  explicit workspace builds (`build:deps` or the owning workspace build), and
  CI/repository guards prevent generated `dist` from being committed again;
- `TEST-ORDER-NEXUS-MODULEENTRY-01` | P2 | OPEN;
- `INV-ACTION-ARCH-01` | **COMPLETED / VERIFIED 2026-09-06** — see
  `docs/playbooks/decision-engine-playbook.md` §11.6;
- `ORD-FIXTURE-INVMULTI-01` | P2 | OPEN;
- `SRC-INBOUND-CONTEXT-01` | P2 | OPEN — targeted **View inbound** still does
  not preserve variant context or identify/highlight the contributing open
  POs after navigation (§13.16). Not addressed by Slice 2 or Slice 2B: Slice
  2B's `covered_inbound` worklist action (§13.23) reuses the exact same
  context-free navigation and explicitly does not claim to fix this.

### 13.19 Slice 2 — Unified Sourcing Worklist: data model and request contract

*CLOSED / VERIFIED 2026-09-03.*

`GET /api/v1/suppliers/sourcing-worklist` is the set-wise, portfolio-wide
Level 1 read model — distinct from, and not a replacement for, the per-variant
targeted endpoint in §13.2. Response envelope:

```
{ summary, items, page, page_size, total }
```

`summary` carries one count per category, computed across the complete
search-and-facet-filtered universe — **before** pagination and **independent
of** which category (if any) is currently selected, so selecting one category
never hides the others' counts. `total` is likewise the pre-pagination count;
`items` is the current page only. Default `page=1`, `page_size=50`.

**Categories** — five, mutually exclusive, derived per request, never
persisted as a stored status:

`needs_supplier` · `needs_purchase` · `in_purchasing` · `covered_inbound` ·
`plan_ahead`

**Category precedence** (exclusive; evaluated top-down):

```
if unplanned > 0:
  no usable supplier -> needs_supplier
  usable supplier    -> needs_purchase

else if in_purchasing > 0:
  -> in_purchasing

else if short_now > 0 && still_to_source == 0 && committed_inbound > 0:
  -> covered_inbound

else if canonical planning signal requires replenishment:
  no usable supplier -> needs_supplier
  usable supplier    -> plan_ahead

else:
  exclude from the worklist entirely
```

Reactive need (the first three branches) always outranks preventive planning
(`plan_ahead`) — a variant already mid-workflow or genuinely short is never
demoted to a "plan ahead" nudge. `covered_inbound` is counted in `summary` and
retrievable via an explicit `category`/`coverage` filter, but is **excluded
from the default immediate-action item list** — a merchant scanning the
default view is not shown SKUs that are already fully covered by stock on the
way.

**Supply truth** — unchanged from Slice 1A (§13.3–13.4), reused verbatim, not
recomputed with different semantics:

```
short_now       = max(0, open_demand - available)
committed_inbound = remaining qty from ordered/confirmed/in_production/
                     shipped/partially_received POs only (draft, received,
                     cancelled excluded)
still_to_source = max(0, open_demand - available - committed_inbound)
```

**Purchasing workflow** — unchanged from Slice 1B (§13.12), reused verbatim:

```
pending_queue_qty
draft_po_qty
in_purchasing = pending_queue_qty + draft_po_qty
unplanned     = max(0, still_to_source - in_purchasing)
```

Queue and draft quantities remain workflow, never committed supply — they do
not add to `committed_inbound` and do not reduce `still_to_source`.

**Supplier readiness** — three independent booleans per item, none of them a
proxy for another:

| Field | Meaning |
|---|---|
| `has_preference` | A saved `supplier_product_preferences` row resolves for this variant/product/product-type. |
| `has_supplier_history` | Any `purchase_order_line_items` row exists for this variant, any supplier, any status. |
| `has_usable_supplier` | An **active** supplier has PO-line history for this variant. |

A usable supplier does **not** require a saved preference (§7.8 preference
resolution is a ranking concern at Level 2, not a Level 1 eligibility gate).
`has_supplier_history` and the `needs_supplier` category are **not** the same
thing: a variant can reach `in_purchasing` purely through a pending
`reorder_requests` row with zero PO-line history at all — `no_history` in the
filter below is deliberately broader than the `needs_supplier` category.

**Request parameters** — all server-owned (filtering, search, sorting and
pagination are never done client-side):

| Param | Values |
|---|---|
| `q` | substring match against product title, variant title, SKU |
| `category` | one worklist category, or `all` |
| `supplier_readiness` | `ready` (`has_usable_supplier`) · `needs_supplier` (category is exactly `needs_supplier`) · `no_history` (`has_supplier_history` is false) |
| `purchasing_stage` | `not_started` (`pending_queue_qty=0 && draft_po_qty=0 && committed_inbound=0`) · `queued` (`pending_queue_qty>0`) · `draft` (`draft_po_qty>0`) · `committed` (`committed_inbound>0`) |
| `coverage` | `short` (`still_to_source>0`) · `covered_inbound` (`short_now>0 && still_to_source==0 && committed_inbound>0`) |
| `sort` | `action_priority` (category precedence, then reactive: oldest-demand → largest-still_to_source; preventive: urgency → soonest-stockout; stable variant-id tie-break) · `oldest_demand` · `still_to_source` (largest first) · `stockout_soonest` (lowest `days_of_stock_remaining` first) · `product_az` |
| `page`, `page_size` | pagination; default `1` / `50` |

Filters compose by AND; none of them widen or narrow `summary`'s category
independence.

**Planning** — `plan_ahead` and the item facts `planning_urgency`,
`days_of_stock_remaining`, `suggested_reorder_qty` reuse the existing
`computeVariantPlanning` read model (§11.2) unchanged, called once for the
whole shop catalogue. **No second reorder/urgency formula was introduced.**

**Verified planning-eligibility caveat.** `computeVariantPlanning`'s
catalogue query is an inner join starting from `inventory_truth` — a variant
with **zero** `inventory_truth` rows never enters its output at all, and so
can never trigger the canonical planning signal, regardless of demand
history. This differs from the Slice 1A/1B shortfall math (§13.3), where
*absence* of an `inventory_truth` row is treated as available = 0. For the
worklist's `plan_ahead`/no-usable-supplier branch to be reachable, the
variant must carry an **explicit** `inventory_truth` row (even at
`available_quantity = 0`) — absence is not equivalent to zero for planning
eligibility. This was discovered during automated VERIFY (three RED-phase
fixture assertions initially failed against it) and confirmed by inspecting
`computeVariantPlanning`'s source; no change was made to
`computeVariantPlanning` itself.

### 13.20 Slice 2 — architecture, tenant safety, and Level 1/Level 2 wiring

*CLOSED / VERIFIED 2026-09-03.*

**Set-wise, not per-variant.** `httpGetSourcingWorklist` never calls the
targeted per-variant resolver (§13.2) in a loop. Every fact — open demand,
availability, committed inbound, draft/queue workflow, supplier
history/usability, preferences, and the one whole-catalogue
`computeVariantPlanning` call — is one grouped query across the shop,
combined in memory by `lasyncro_variant_id`. Multi-location inventory
(`inventory_truth`, summed across every `location_code`) and multi-supplier PO
history both collapse to exactly one row per canonical variant; there is no
demand × inventory × PO join multiplication.

**Tenant scoping.** Every query is explicitly `shop_id`-scoped in addition to
`SET LOCAL app.current_tenant`, matching the targeted endpoint's existing
pattern. Cross-tenant rows contribute zero to both `items` and `summary`.

**Read-only.** The entire handler runs SELECT-only inside a transaction; a
`GET` never creates, updates, or deletes a purchase order, reorder request,
preference, supplier, or inventory row.

**Generic frontend wiring.** `/suppliers-portal/sourcing` with no `variantId`
now renders the Unified Sourcing Worklist (`data-testid="sourcing-worklist"`)
instead of the pre-Slice-2 generic content described in §13.1's historical
note. Generic mode fetches only the new worklist endpoint
(`onFetchSourcingWorklist`) and makes **zero** calls to the targeted
per-variant `onFetchSourcingRecommendations` — the two fetches are disjoint by
construction.

**Worklist row contract.** Each row shows Shopify-synced `image_url` or a
compact placeholder, product/variant/SKU identity, exactly one primary reason
line (state-appropriate, e.g. "N still to source · N orders waiting", "N
inbound · customer shortage covered", "Stockout projected in N days" — never
the Level 2 five-number truth grid), and, as shipped at Slice 2, exactly one
action, **Review**. Supplier ranking, MOQ detail, supplier alternatives,
editable PO quantity and other decision-heavy content stay at Level 2, per the
boundary ratified in §13.11.

*Superseded 2026-09-03 by Slice 2B (§13.22–13.24): a live-UX pass found that
"exactly one action, Review" everywhere was itself a cognitive-load gap for
`needs_supplier` rows, and the row's own reason copy could read as
self-contradictory. The row-action model, and the one-primary-reason-line
statement above (reason CONTENT branching, not the "exactly one line"
structure) were revised there — see §13.22–13.24 for current behaviour.*

**Review → Level 2, same instance.** Review navigates to
`/suppliers-portal/sourcing?variantId=<canonical variant id>` — never a
fabricated `orderId`. The same mounted `SuppliersPortalModuleFT2` instance
transitions into targeted Level 2 without a remount: `activeVariantId` is kept
synchronized with the URL's `variantId` via an effect, correcting an earlier
defect where it only took its initial value at mount and never reacted to
same-instance navigation.

**Supplier settings — secondary, not deleted.** Supplier Preferences
administration no longer renders inline/always-visible in generic mode. It
remains fully functional, reachable behind a secondary "Supplier settings"
entry point, collapsed by default.

**MOQ grouped purchasing — preserved, the one approved row-level exception.**
The supplier-grouped reorder-request accumulator (§8) remains available from
the worklist, grouped by supplier rather than per-SKU, not duplicating the
full MOQ reasoning already at Level 2. As shipped at Slice 2 this panel
rendered unconditionally, including a literal "0 suppliers pooling MOQ" state
— corrected in Slice 2B (§13.22) to render only when non-empty.

**Empty state.** An empty worklist renders a coherent "nothing needs sourcing
right now" state. The pre-Slice-2 "Select a stockout alert to see ranked
supplier options" placeholder is no longer the generic-mode default; that
markup and Sourcing Pulse/Never Ordered Before still exist in
`SuppliersPortalModuleFT2.tsx` but are unreachable from generic mode — they
were left as dead code rather than deleted, since targeted mode's own JSX was
required to stay byte-for-byte unchanged (see verification below).

### 13.21 Slice 2 — automated verification evidence

| Gate | Result |
|---|---|
| Backend worklist integration (`sourcing-worklist-contract.test.ts`) | 26/26 PASS |
| Backend targeted regression (`sourcing-targeted-contract.test.ts`) | 21/21 PASS |
| Backend combined | 47/47 PASS |
| Frontend worklist (`SourcingWorklist.test.tsx`) | 14/14 PASS |
| Slice 1A frontend targeted regression | 10/10 PASS |
| Slice 1B frontend actions/media regression | 19/19 PASS |
| Orders → Sourcing entry regression | 3/3 PASS |
| Frontend combined | 46/46 PASS |
| Backend TypeScript | 0 errors |
| Frontend TypeScript | 0 target errors (19 pre-existing baseline errors, unrelated files) |
| suppliers-portal module build | PASS |
| Generated dist parity | PASS — exactly `SuppliersPortalModuleFT2.{js,js.map,d.ts,d.ts.map}` regenerated, byte-identical on rebuild, no hand-edits, runtime resolves to this worktree |
| Test ownership | backend-legacy 133 · backend-integration 36 · contract 10 · frontend 130 · UNOWNED=0 · MULTI_OWNED=0 |
| Disposable integration DB | created → migrated → runtime OK → dropped, ORPHAN_DB_COUNT=0 |

Targeted Level 2 (§13.1–13.18) was proven byte-for-byte unchanged: the
generic-mode worklist branch is an early return added before the existing
targeted JSX, which was not modified. Live-browser certification was not
separately re-run for Slice 2; automated evidence above is what closes it.

### 13.22 Slice 2B — worklist UX alignment and contextual row actions

*CLOSED / VERIFIED 2026-09-03. Additive correction on top of the already-CLOSED
Slice 2 above — Slice 2's own numbers in §13.19–13.21 are preserved
unchanged as the historical record of what Slice 2 itself verified.*

**Why 2B existed.** A live-browser UX review performed after Slice 2's
automated verification (§13.21) found the shipped worklist visually
inconsistent with laSyncro's established FT2/modules-UX-playbook patterns and
the Order Flow reference surface, plus one genuine cognitive-load gap: a
`needs_supplier` row forced a Review-then-Assign-supplier round trip through
Level 2 even though the worklist already held every fact needed to assign a
supplier directly. This was **not** a defect in Slice 2's *automated*
contracts — every Slice 2 gate had passed — it was found by *looking at the
running surface*, which the audit-then-workshop-then-red-then-implement
sequence below exists to catch.

**Zero MOQ panel.** The supplier-grouped reorder-queue panel (§13.20) now
renders **nothing at all** when `reorderRequests.length === 0` — no
replacement empty card, no "0 suppliers pooling MOQ" text. When non-empty, the
existing supplier-grouped accumulation and Convert-to-PO behaviour is
unchanged.

**Worklist control hierarchy.** Category/count controls now precede
search/filter controls in DOM order (previously reversed), matching the
"categorize → filter → scan → select → act" grammar in §13.11:

```
title + Supplier settings
→ category/count controls
→ search
→ filters + sort
→ worklist rows
→ pagination footer
→ MOQ grouped purchasing (only when non-empty)
```

**modules-ux-playbook.md alignment.** The category-count controls, search
input, filter/sort controls, and pagination were re-styled to match existing
canonical patterns rather than raw/default MUI or native-looking controls:

- category counts use the same token-styled pill pattern as Order Flow's
  filter chips (`var(--accent)`/`var(--accent-ghost)`/`var(--rule)` border and
  background, active vs. inactive state) instead of MUI `<Chip
  color="primary">`, which rendered MUI's default palette color rather than
  laSyncro's accent;
- the three filter `<select>`s and the sort `<select>` remain native
  `<select>` elements (no new component/library introduced) but now carry
  shared token styling (`var(--rule)` border, `var(--surface)` background,
  `var(--ink)` text) instead of unstyled browser defaults;
- pagination was replaced with the canonical `modules-ux-playbook.md` §6
  footer structure — "X–Y of Z" range, a page-size control (10/25/50/100),
  Previous/Next, and numbered pages when more than one page exists — in place
  of an ad hoc Previous/Next-only pair. Changing page size resets to page 1
  and refetches the server worklist with the new `page_size`;
- every CTA in the worklist now follows the existing Tier 1 (filled accent —
  commits/resolves) / Tier 2 (ghost pill — navigates) doctrine from
  `modules-ux-playbook.md` §2: **Assign supplier** and **Convert to PO** are
  Tier 1; **Review**, **Review queue**, **Review draft PO**, **View inbound**,
  and **Supplier settings** are Tier 2. No control in the worklist uses raw
  MUI `color="primary"` or an unstyled `variant="contained"`/`"outlined"`
  Button.

No new design system, component library, or CSS token was introduced —
every value above is an existing laSyncro token or an existing canonical
pattern already used elsewhere (Order Flow, the shared pagination standard).

### 13.23 Slice 2B — revised Level 1 action model

*CLOSED / VERIFIED 2026-09-03.*

**Updated Level 1 / Level 2 principle**, extending §13.11's boundary: Level 1
may perform a deterministic, low-context action when every fact the action
needs is already present on the worklist item — it does not need a new
server fetch to decide or execute it. Level 2 continues to own everything
that genuinely needs richer context:

- ranked supplier selection and supplier alternatives;
- detailed MOQ reasoning;
- editable purchasing quantity;
- Prepare PO built from a ranked recommendation;
- individual blocking-order and PO/inbound detail.

**Row action per category** (supersedes the Slice 2 "exactly one action,
Review" statement in §13.20 for `needs_supplier`; every other category still
carries exactly one action, just not always the same label):

| Category | Action(s) |
|---|---|
| `needs_supplier` | **Assign supplier** (Tier 1, primary) + **Review** (Tier 2, secondary) |
| `needs_purchase` | **Review** only |
| `in_purchasing` | `draft_po_qty > 0` → **Review draft PO**; else `pending_queue_qty > 0` → **Review queue**; draft wins when both are nonzero (matches Level 2's existing `targetedAction` precedence exactly) |
| `covered_inbound` | **View inbound** |
| `plan_ahead` | **Review** only |

`needs_purchase` and `plan_ahead` deliberately do **not** expose Prepare PO —
that action needs a ranked supplier recommendation, which the worklist must
never fetch (SRC-WL-UI-14/§13.20 "zero calls to the targeted per-variant
endpoint"). "Review queue"/"Review draft PO"/"View inbound" reuse Level 2's
existing `/suppliers-portal` navigation destination for those same three
`targetedAction` kinds — no new route was introduced.

**Assign-supplier architecture.** Assigning directly from a `needs_supplier`
row reuses the **same** `AssignSupplierDialog` component, the same
`onCreatePreference` submission path, and the same underlying
`handleAssignSave` handler already used by targeted mode (§13.14) and the
"Never Ordered Before" list — no parallel assignment implementation exists.
The dialog target is built from fields the worklist item already carries
(`lasyncro_variant_id`, `variant_title`/`product_title`, `sku`); `product_id`
and `product_type` are unknown at Level 1, exactly as they already are when
assigning from targeted mode, so the dialog degrades to "apply to this
variant only" scope — no new backend field was added.

A successful Level 1 assignment **refetches the worklist from the server**
(a dedicated refresh key, parallel to targeted mode's existing
`targetRefreshKey`) rather than mutating the row's category locally. The
row's new category — `needs_purchase`, `plan_ahead`, or excluded from the
current filtered view entirely — is decided by the server's next response,
the same as every other worklist state change. Currently-selected
category/search/filter/sort/page state is preserved across that refetch.
Assigning from Level 1 still makes zero calls to the targeted per-variant
recommendation endpoint.

**`needs_supplier` reason copy.** Slice 2 (§13.19) used one reason template
for `needs_supplier` regardless of which category-precedence branch produced
it, which could literally read "0 still to source · no supplier on file" for
a row reached through the *preventive* planning branch — technically correct
per the precedence algorithm, but confusing: it reads as "nothing is needed"
on a row the system is actively flagging. The copy now branches on which
branch produced the category:

```
unplanned > 0 (reactive):
  "<N> still to source · no supplier assigned"

unplanned == 0, days_of_stock_remaining known (preventive):
  "Stockout projected in <N> days · no supplier assigned"

unplanned == 0, days_of_stock_remaining unknown (preventive fallback):
  "Replenishment due · no supplier assigned"
```

A planning-driven `needs_supplier` row never displays "0 still to source"
again. No backend fact was added — `days_of_stock_remaining` was already
part of the worklist response (§13.19), reused here exactly as `plan_ahead`'s
own reason copy already used it.

### 13.24 Slice 2B — automated verification evidence

| Gate | Result |
|---|---|
| Backend worklist integration (`sourcing-worklist-contract.test.ts`) | 26/26 PASS |
| Backend targeted regression (`sourcing-targeted-contract.test.ts`) | 21/21 PASS |
| Backend combined | 47/47 PASS |
| Frontend worklist (`SourcingWorklist.test.tsx`, grown from 14 to 29 cases for 2B) | 29/29 PASS |
| Slice 1A frontend targeted regression | 10/10 PASS |
| Slice 1B frontend actions/media regression | 19/19 PASS |
| Orders → Sourcing entry regression | 3/3 PASS |
| Frontend combined | 61/61 PASS |
| Backend TypeScript | 0 errors |
| Frontend TypeScript | 0 target errors (19 pre-existing baseline errors, unrelated files) |
| suppliers-portal module build | PASS |
| Generated dist parity | PASS — exactly `SuppliersPortalModuleFT2.{js,js.map,d.ts,d.ts.map}` regenerated, byte-stable across repeated rebuilds, no hand-edits, runtime resolves to this worktree |
| Test ownership | backend-legacy 133 · backend-integration 36 · contract 10 · frontend 130 · UNOWNED=0 · MULTI_OWNED=0 |
| Disposable integration DB | created → migrated → runtime OK → dropped, ORPHAN_DB_COUNT=0 |

Targeted Level 2 was proven byte-for-byte unchanged again for 2B (same method
as §13.21: the generic worklist branch is an early return before the
untouched targeted JSX).

**Live-browser verification: PASS — MANUAL, performed by Milad**, on
`/suppliers-portal/sourcing` in both light and dark mode. Confirmed visually:
the MOQ/reorder-queue panel absent (zero-state suppression), category counts
preceding search/filter controls, token-aligned category-chip/filter/CTA
treatment, a `needs_supplier` row showing both **Assign supplier** and
**Review**, the revised preventive reason copy (observed: "Stockout projected
in 0 days · no supplier assigned"), the canonical pagination footer, and the
**Supplier settings** secondary entry. This is manual visual verification by
a human operator, not an automated pixel/color/browser test — no automated
browser tooling was run for Slice 2B; automated coverage remains the RTL/Jest
evidence in the table above. Not independently re-verified by this pass:
every category's row state, every pagination state, the assignment submit
path end-to-end, and responsive/mobile layouts — those remain covered only by
the automated tests above where such coverage exists (e.g. the assignment
submit path is covered by SRC-WL-2B-07/08 in the automated suite, not by this
manual pass).

---

## 14. STOCK-PROTECT-01 — supplier-authority supersession (2026-09-11)

✅ Implemented, live and verified. Full detail lives in the dedicated
`stock-protection-policy-playbook.md` — this section exists only to correct
§2's ground truth, which predates it.

The "most recent received PO" supplier-lineage rule described in §2 is now
the **fallback path only**, used exactly when no approved Stock Protection
Policy exists for a variant, or an approved policy has no explicit supplier
anchor. When an approved policy sets `planning_supplier_id`, that supplier
is authoritative for planning lead time and is never silently overridden by
a newer PO from a different supplier. If the anchored supplier becomes
invalid or inactive, planning surfaces `planning_data_required` rather than
substituting another supplier.

This does not change anything else in this playbook: the two-branch
recommendation logic (§6a), category precedence, and the canonical planning
signal (`computeVariantPlanning`) are unchanged — only one of that
formula's inputs (supplier lead time) now has an authoritative override.

---

*Adjacent docs: `SuppliersModule.md` §3 (schema, updated 2026-07-10),
`onboarding-progressive-disclosure-playbook.md` (Loop 2 / Reorder Loop context),
`product-structure.md` §6 (The Three Must-Have Loops),
`stock-protection-policy-playbook.md` (STOCK-PROTECT-01, full detail).*
