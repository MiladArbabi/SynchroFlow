# LaSyncro — Buffer Diagnosis Playbook (STOCK-PROTECT-02)

> **Status:** ✅ Implemented, live and verified — 2026-09-11.

This is the canonical reference for Buffer Diagnosis, the read-only
recommendation layer built on top of the STOCK-PROTECT-01 Stock Protection
Policy foundation (`stock-protection-policy-playbook.md`). It exists so
future work does not reintroduce a computed safety-day number dressed up as
more certain than the evidence actually supports.

## 1. Purpose

Buffer Diagnosis answers exactly one question:

> "What `safety_days` should LaSyncro recommend for this variant, why, and
> how confident are we?"

**A recommendation is evidence, not authority.** The approved Stock
Protection Policy (STOCK-PROTECT-01) remains the merchant's own authority
for what actually governs planning. Buffer Diagnosis never mutates it —
see §9.

## 2. Architecture

```
Demand / supplier evidence
        ↓
Buffer Evidence          (stockProtectionBufferEvidence.ts — READ ONLY)
        ↓
Pure Buffer Diagnosis     (stockProtectionBufferDiagnosis.ts — no DB, no I/O)
        ↓
recommended_safety_days
confidence
adjustments
limitations
        ↓
merchant review
        ↓
approved policy — ONLY if the merchant explicitly accepts
  (via the existing upsertStockProtectionPolicy write path, STOCK-PROTECT-01)
```

The evidence layer and the decision layer are deliberately two files: the
evidence layer touches Postgres and canonical Demand output; the decision
layer is a pure function that can be re-run, tested, and reasoned about with
zero side effects.

## 3. V1 Buffer Rules

**Baseline:** 5 days. **Floor:** 5. **Maximum:** 10.

**Demand** (only evaluated when the underlying `demand_confidence` is at
least `medium`; `none`/`low` short-circuits to the baseline with zero
adjustments — see §4):

| Signal | Condition | Adjustment |
|---|---|---|
| Variability (CV) | < 0.50 | +0 |
| Variability (CV) | 0.50 – 1.00 | +1 |
| Variability (CV) | > 1.00 | +2 |
| Lumpiness | >50% zero-demand weeks **and** burst activity | +1 |
| Upward trend | ≥25% **and** `demand_confidence === 'high'` only | +1 |

Demand contribution is capped at **+3** total, regardless of how many of the
above fire together.

**Supplier** (derived only from **fully received** purchase orders — see
§5):

| Signal | Condition | Adjustment |
|---|---|---|
| On-time rate | ≥95% | +0 |
| On-time rate | 85% – 94.9% | +1 |
| On-time rate | <85% | +2 |
| Fill rate | ≥98% | +0 |
| Fill rate | 95% – 97.9% | +1 |
| Fill rate | <95% | +2 |

Supplier contribution is capped at **+2** total.

The merchant-configured planning lead time (`suppliers.lead_time_days`)
never itself adds safety days — it is a separate planning input consumed by
`demandIntelligence.service.ts`, not a buffer-sizing signal here.

When a category's raw signals would exceed its cap, later-evaluated signals
are dropped entirely rather than partially applied — every adjustment that
survives into the response is a complete, fully-explained signal.

## 4. Confidence

Confidence is Buffer Diagnosis's **own** scale
(`insufficient` / `low` / `medium` / `high`) — distinct from, but built on
top of, Demand's existing `demand_confidence` (`high`/`medium`/`low`/`none`).

- **INSUFFICIENT** — `demand_confidence` is `none` or `low`.
- **LOW** — `demand_confidence` is `medium`, **or** `demand_confidence` is
  `high` with absent or thin supplier evidence (no planning supplier, or
  fewer than 3 settled purchase orders).
- **MEDIUM** — `demand_confidence` is `high`, **and** ≥3 fully-received
  supplier POs, with the required evidence available.
- **HIGH** — `demand_confidence` is `high`/recent, **and** ≥15 fully-received
  supplier POs, with populated on-time/fill evidence.

**Risk changes the recommended number of days. Evidence quality changes the
confidence label.** These are independent — two inputs producing the
identical `recommended_safety_days` can carry different `confidence`
values, and the numeric buffer size is never used to infer confidence.

## 5. Evidence Semantics

- `demand_confidence` and the velocity-window selection (30d → 90d → 180d)
  are **reused verbatim** from `demandIntelligence.service.ts`'s
  `computeVariantPlanning` — never recomputed or redefined here.
- `planning_supplier_id` comes from that same canonical Demand
  supplier-resolution logic (the approved policy's explicit anchor when one
  exists, otherwise the variant's most-recent-PO supplier) — Buffer
  Diagnosis never re-derives supplier selection.
- `lead_time_days` is the merchant-configured planning lead time — a
  separate, already-existing planning input, not evidence gathered here.
- **Schedule variance** (`average_schedule_variance_days` conceptually;
  computed as `actual_delivery_date - expected_delivery_date`, mean across
  settled orders): **positive = late, negative = early.** It is a
  lateness/earliness signal, never a stand-in for `lead_time_days`.
- `suppliers.total_pos` is **never** used as confidence/sample-size
  authority — it increments on a different condition than the population
  the rate fields are computed over. The settled-PO sample size is always
  derived live from `purchase_orders` rows.
- **Only fully `received` purchase orders count as settled supplier
  evidence.** An order still awaiting the remainder of its shipment does
  not qualify — its first delivery date measures "was the first shipment on
  time," not "did the order complete on time," and its fill ratio is a
  moving snapshot, not a final observation.
- The WMS-receive-exception-derived quality signal is excluded from general
  V1 Buffer Diagnosis supplier-risk evidence — its population (orders that
  went through a WMS receive session) is a strict, silently narrower subset
  of the settled-PO population used for on-time/fill evidence, and mixing
  the two would overstate evidence for suppliers never received via that
  path.

## 6. Reason Codes

Exact, stable vocabulary — every non-zero adjustment carries exactly one:

- `demand_variability`
- `demand_lumpiness`
- `demand_upward_trend`
- `supplier_lateness`
- `supplier_fill_risk`

## 7. Limitations

Exact vocabulary:

- `insufficient_demand_history`
- `no_planning_supplier`
- `no_configured_lead_time`
- `insufficient_supplier_history`
- `supplier_metrics_unavailable`

**Limitations do not automatically add safety days.** They explain why
confidence is lower or why a signal could not be evaluated at all —
`no_planning_supplier` and `no_configured_lead_time` in particular describe
supplier-*identity* gaps that reduce evidence quality without ever
contributing an adjustment themselves. When no planning supplier is
resolved at all, that limitation alone is emitted — it subsumes (and never
co-occurs with) the narrower supplier-evidence limitations, which would
otherwise be redundant.

## 8. API

```
GET /api/v1/modules/demand/stock-protection-recommendation/:variantId
```

Protected by the identical `authenticateToken → requireFt2 →
requireCapability('demand.forecasting')` chain as the existing
`GET /api/v1/modules/demand/stock-protection-policy/:variantId` route
(STOCK-PROTECT-01). Response:

```json
{
  "recommended_safety_days": 6,
  "baseline_safety_days": 5,
  "confidence": "medium",
  "adjustments": [ /* { category, reason_code, delta_days, explanation } */ ],
  "evidence": { "demand": { /* ... */ }, "supplier": { /* ... */ } },
  "limitations": [ /* ... */ ],
  "generated_at": "2026-09-11T00:00:00.000Z"
}
```

**Read-only.** Recalculated fresh on every request.

## 9. Policy Authority Boundary

A recommendation MUST NOT:

- mutate `stock_protection_policies`
- create `stock_protection_policy_transitions`
- change the policy's `version`
- read `recommendation_snapshot` as current planning authority

The recommendation endpoint delegates entirely to
`stockProtectionBufferEvidence.ts` (read-only) and
`stockProtectionBufferDiagnosis.ts` (pure, no I/O of any kind). Neither file
imports or calls `upsertStockProtectionPolicy` — the ONE place authorized to
mutate approved-policy state remains `stockProtectionPolicy.service.ts`,
unchanged by this work.

## 10. Deferred (explicitly out of scope for V1)

- Seasonality modeling
- Historical stockout learning
- Ignored-recommendation learning (no durable "merchant dismissed this"
  signal exists anywhere in the schema yet)
- Defect-rate-based protection sizing
- Per-location / per-warehouse protection (STOCK-PROTECT-07)
- A statistical service-level / Z-score model
- Ever lowering a recommendation below the 5-day floor

## 11. Test Contract

| Layer | File | Protects |
|---|---|---|
| Unit | `tests/unit/inventory/stock-protection-buffer-diagnosis.test.ts` | Pure decision rule: baseline/floor/cap, every threshold boundary, category caps, confidence tiers, exact reason-code vocabulary, limitation semantics, purity |
| Integration | `tests/integration/inventory/stock-protection-buffer-evidence.contract.test.ts` | Settled supplier evidence: only `received` POs count, `total_pos` is never the sample denominator, schedule variance vs. lead time, read-only reads |
| Integration | `tests/integration/inventory/stock-protection-recommendation-api.contract.test.ts` | Read-only API contract: auth, tenant boundary, full explanation shape, insufficient-history default, zero mutation of approved-policy state |
| Architecture/static | `tests/contract/stock-protection-buffer-boundary.contract.test.ts` | Structural boundary: no policy/transition writes, no `recommendation_snapshot` read-back, canonical Demand reuse, exclusion of `total_pos`/`avg_delivery_days`-as-lead-time/`defect_rate`/`partially_received` from settled evidence |

No new migration was required for STOCK-PROTECT-02 — it reads existing
tables only. No worker, outbox, UI, or provider-integration test is
required; this slice is backend read-path only.

---

*Adjacent docs: `stock-protection-policy-playbook.md` (STOCK-PROTECT-01 —
the approved-policy authority this recommendation layer reads from but
never writes to), `sourcing-recommendation-playbook.md` §14 (supplier
lead-time authority), `DemandModule.md` (Demand module structure —
predates both STOCK-PROTECT-01 and -02 and should not be treated as current
without re-verifying against `demandIntelligence.service.ts`).*
