### ✅ Products Module (SKU-OS) — **FT2 Audit Freeze**

**Data sufficiency reached. Audit frozen.**
No further scans are required or permitted.

---

## 1. Architectural Integrity (Confirmed)

The Products module **fully conforms** to the FT2 4-layer architecture:

```
Canonical DB
→ Layer 1: Facts
→ Layer 2: Intelligence
→ Layer 3: FTEP
→ Layer 4: FT2 UI
```

Each layer is present, isolated, and enforces its contract without leakage.

---

## 2. Layer-by-Layer Truth Summary

### Layer 1 — Facts

* Source: `canonical_products`
* Outputs: raw counts only (products, SKUs, variants, statuses)
* Null policy:

  * `no rows → all facts = null`
  * `null ≠ 0` explicitly enforced
* No joins, no enrichment, no inference

**Status:** Canonical, conservative, correct

---

### Layer 2 — Intelligence

* Inputs: ProductsFacts only
* Gating rule:

  * Any missing critical fact → **full intelligence = `unknown`**
* Signals:

  * `outcome` (positive / negative / unknown)
  * `catalogHealth`, `skuCoverage`, `variantComplexity`
  * `trend` is structurally static (`unknown`)
* No DB access, no history, no defaults

**Status:** Conservative, correctly gated, partially static by design

---

### Layer 3 — FTEP (Truth Exposure Policy)

* Acts as a **hard downgrade boundary**
* Always exposes:

  * `context.period`
  * `context.productsObserved`
* If `outcome === 'unknown'`:

  * `outcome = null`
  * `trend = null`
  * `signals = null`
* Signals are lossy and non-semantic (`ok / gaps / attention / unknown`)
* No raw facts or intelligence internals ever exposed

**Status:** Strict, loss-preserving, policy-correct

---

### Layer 4 — FT2 UI

* Snapshot hook: read-only, no params, no transformation
* Adapter:

  * Pure
  * Only normalizes `undefined → null`
* Rendering:

  * All fields null-safe
  * `'—'` is the honest visual representation of `null`
  * No inference, no compensation, no formatting logic
* FT1 and FT2 paths are cleanly separated

**Status:** Observational only, policy-aligned

---

## 3. Cross-Surface Alignment Matrix (Final)

| Module   | Fact Exists | Intelligence Active | FTEP Exposes         | FT2 Consumes | UI Shows |
| -------- | ----------- | ------------------- | -------------------- | ------------ | -------- |
| Products | Yes         | Conditional         | Outcome gated → null | Yes          | `—`      |

---

## 4. Gaps Classification

### Intentional Gaps (By Design)

* No exposure when intelligence is `unknown`
* Trend has no signal (no history)
* Analytical UI sections are placeholders
* Raw facts never exposed
* Intelligence internals never exposed

### Accidental Gaps

* **None detected**

All absences are policy-driven and scan-proven.

---

## 5. Safe Future Unlock Points (Observed Only)

*(Not proposals, only factual observations)*

* `trend.direction` (requires historical layer)
* FT2 analytical surfaces (currently unused)
* Additional downgraded signals via FTEP only

---

## 6. Final Audit Verdict

* ✅ Architecture preserved
* ✅ Null semantics are correct and honest
* ✅ No intelligence leakage
* ✅ No UI compensation
* ✅ Products module is **FT2-correct as-is**

**Audit complete. Products module truth is frozen.**
