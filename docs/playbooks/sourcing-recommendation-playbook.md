# LaSyncro — Sourcing & Reorder Recommendation Playbook

> **Created:** 2026-06-29. **Status:** ✅ Algorithm designed and shipped (§6, 2026-06-30). Tuning & re-routing items tracked in §6b.

## 1. Why Reorder Changed Direction

Original mechanism (REPL-001, still functional): Demand's reorder signal deep-links to Suppliers Portal, pre-filling one PO line item with `suggested_reorder_qty`. Confirmed gap: zero MOQ enforcement or visibility anywhere in the codebase — `grep -rn "moq"` across the backend only touches the supplier's own stored field, never a submitted quantity.

A popup-based MOQ check was designed, then abandoned in favor of a **dedicated page** (same architectural shape as Order Flow — a surface that owns a whole class of decisions, fed by deep-links, with live recompute) once it became clear the real need is supplier *comparison and recommendation*, not just a quantity warning.

## 2. Confirmed Facts (ground truth, 2026-06-29)

- `suppliers` table already has a full unused scorecard: `on_time_rate`, `fill_rate`, `defect_rate`, `avg_delivery_days`, `moq`, `lead_time_days` — all computed by `supplierRating.service.ts`, **used in zero recommendation/comparison logic anywhere.**
- No stored supplier link exists on `variants`. Supplier lineage is derived *only* from the most recent received PO containing that variant (`demandIntelligence.service.ts`), defaulting lead time to 14 days when no history exists.
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

*Adjacent docs: `SuppliersModule.md` §3 (schema, updated 2026-07-10),
`onboarding-progressive-disclosure-playbook.md` (Loop 2 / Reorder Loop context),
`product-structure.md` §6 (The Three Must-Have Loops).*