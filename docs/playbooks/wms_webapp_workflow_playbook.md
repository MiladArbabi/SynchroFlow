# LaSyncro WMS — Webapp Workflow Playbook

**Version:** 1.0  
**Date:** May 31, 2026  
**Status:** ✅ Live — derived from Receive workflow UI simulation and audit  
**Scope:** All WMS workflows on the webapp (Stow, Pick, Pack/Ship)  
**Authority:** This document is the engineering and UX contract for all webapp WMS workflow surfaces.  
Every workflow built after Receive MUST be audited against this playbook before shipping.

---

## 1. The Mandatory Session Structure

Every WMS workflow on the webapp MUST follow this four-phase structure. No exceptions.

```
Brief → Inspect → Summary → Done
```

| Phase | Purpose | Required elements |
|-------|---------|-------------------|
| **Brief** | Orient the operator before work begins | Job summary (supplier/batch/order info), expected counts, mode selector if applicable, single CTA to start |
| **Inspect** | The active work phase | Progress indicator, item identity, action surface, exception reporting, mode toggle |
| **Summary** | Review before committing | Per-line/per-item breakdown (expected vs actual), total row, warnings for shortfalls, single CTA to close/confirm |
| **Done** | Confirmation + next step | Success state, what was created (stow tasks, fulfillment status, etc.), navigation back to Operations |

**Rationale:** Without Brief, operators enter work blind. Without Summary, operators commit without reviewing. Both were missing in the initial Receive implementation and caused data integrity issues (0-qty accepts).

---

## 2. Scan Input — Desktop vs Mobile

### The Rule

**NEVER use `BarcodeScanSurface` (camera component) on the webapp.** It is mobile-only.

### Webapp scan input pattern — `ScanInput`

All barcode/location/product scanning on the webapp uses a text `TextField` with these properties:

```tsx
<TextField
  inputRef={scanInputRef}          // always ref for programmatic focus
  fullWidth
  size="small"
  type="text"
  placeholder="Scan barcode or type and press Enter"
  disabled={scanProcessing}
  value={scanInputValue}
  onChange={(e) => setScanInputValue(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === 'Enter') {
      const val = scanInputValue.trim();
      if (val) { void handleScan(val); setScanInputValue(''); }
    }
  }}
  helperText="Scanner auto-submits · manual entry: press Enter or tap Scan"
  autoComplete="off"
/>
{scanInputValue.trim() && (
  <Button onClick={() => { void handleScan(scanInputValue.trim()); setScanInputValue(''); }}
    sx={{ bgcolor: 'var(--accent)', borderRadius: '6px', fontWeight: 600 }}>
    Scan
  </Button>
)}
```

### Behaviour rules

- **Enter-to-submit is primary** — USB/BT scanners send Enter automatically. Never change this.
- **Inline Scan button** appears only when input has a value — gives manual typists a visible submit target
- **Auto-focus on mount** — `useEffect` focuses `scanInputRef.current` when entering scan phase
- **Re-focus after error** — `useEffect` on `scanError` state refocuses input after React re-renders
- **Re-focus after success** — `setTimeout(() => scanInputRef.current?.focus(), 50)` after state updates
- **Clear input after submit** — always `setScanInputValue('')` after processing

### Focus re-focus pattern (copy exactly)

```tsx
// Auto-focus on phase enter
useEffect(() => {
  if (phase === 'scan_active') scanInputRef.current?.focus();
}, [phase]);

// Re-focus after error (Alert render steals focus)
useEffect(() => {
  if (phase === 'scan_active') setTimeout(() => scanInputRef.current?.focus(), 50);
}, [scanError, phase]);
```

---

## 3. Exception Handling — Shortfall Modal Pattern

When an operator reports fewer units than expected, the system MUST force full exception accounting before allowing confirmation. This pattern was established in Receive and MUST be replicated in Stow and Pick.

### The shortfall modal contract

```
accepted < expected
  → shortfall modal opens (cannot be bypassed)
  → operator selects exception type
  → operator enters qty (always blank — never pre-filled)
  → onReportException called → Problem Center called
  → remainingShortfall decremented
  → if remaining > 0: loop (operator reports next chunk)
  → if remaining = 0: submit inspection → advance
```

### Exception types (standard set — do not modify without updating all workflows)

```typescript
type ExceptionType =
  | 'defect'            // unit physically damaged
  | 'packaging_damage'  // unit OK, packaging damaged
  | 'wrong_item'        // item doesn't match expected variant
  | 'wrong_variant'     // correct product, wrong size/colour
  | 'wrong_quantity'    // quantity doesn't match label
  | 'barcode_mismatch'  // scanned barcode doesn't match expected SKU (notes required)
  | 'other';            // catch-all (notes required)
```

### Miscount escape hatch — strict rules

- Shows as a ghost pill button (NOT a filled button) — `var(--accent-border)` outline
- ONLY visible before any exception has been committed in the current shortfall
- DISAPPEARS once first exception is reported — prevents orphaned PROB tasks
- Accepts full expected quantity, files no exception

### Problem Center — always called on exception

Every exception report MUST call two endpoints in sequence:

1. `POST /api/v1/suppliers/receive-jobs/:jobId/exception` (or workflow equivalent)
2. `POST /api/v1/wms/problem-center` with `{ lasyncro_variant_id, quantity, exception_type, source }`

Never report an exception without creating a Problem Center task.

---

## 4. UX Standards — WMS Workflow Surfaces

These rules are in addition to the global UX playbook (`docs/playbooks/modules-ux-playbook.md`).

### CTA hierarchy in workflow sessions

| CTA | Style | When |
|-----|-------|------|
| Primary action (Confirm, Close, Ship) | Filled accent — `var(--accent)`, `borderRadius: '6px'`, `fontWeight: 600` | One per screen maximum |
| Mode toggle (Switch to scan, Switch to count) | Ghost pill — `var(--accent-border)` border, accent text | Inline in session header |
| Escape hatch (I miscounted, Cancel) | Ghost pill — smaller, subdued | Bottom-left of modal, never prominent |
| Danger action (Cancel PO, Report Problem) | Outlined warning/error | Always secondary to primary |

### CTA label standards

| Situation | Label |
|-----------|-------|
| Confirming one item in count mode | `Confirm Batch` |
| Confirming last item in count mode | `Confirm & Finish` |
| Finishing scan mode (go to summary) | `Finish & Review` |
| Closing session and writing to DB | `Close & Create Stow Tasks` / `Close & Confirm` |
| Submitting an exception | `Confirm Exception` |

### Confirm button disabled states

- **Count mode:** disabled when `totalCounted === 0`
- **Scan mode:** never disabled — shows "Finish & Review" which gates at `confirmedLines.size === lines.length`
- **Exception modal:** disabled when no exception type selected OR qty field empty

### Progress indicators

Every inspect phase MUST show:

- Linear progress bar (top of screen) showing `currentIndex / total` as percentage
- Text label: `Variant N of M — SupplierName` or `Task N of M`
- Per-item progress in scan mode: `N / expected` chip per line

---

## 5. Session Persistence — Refresh Recovery

### The rule

Active sessions MUST survive page refresh. Operators work in warehouses with unreliable connectivity and accidental refreshes.

### Implementation pattern

**Step 1 — Keep session ID in URL while active:**

```tsx
// Keep ?receiveJobId= (or ?batchId=, ?stowTaskId=) in URL while session active
// Only clean param when session completes via onSessionExit
onSessionExit={() => setSearchParams({}, { replace: true })}
```

**Step 2 — Restore confirmed state from backend on re-entry:**

```tsx
// On session mount, initialise confirmed state from backend-persisted data
const initialConfirmedLines = new Set<string>();
for (const line of lines) {
  if (line.inspection_complete) initialConfirmedLines.add(line.receive_job_line_id);
}
const hasPartialProgress = initialConfirmedLines.size > 0;
```

**Step 3 — Persist mode in sessionStorage:**

```tsx
// Persist inspect mode — survives refresh within same tab
const storedMode = sessionStorage.getItem(`receive-mode-${jobId}`);
// Set on mode change: sessionStorage.setItem(`receive-mode-${jobId}`, mode)
```

**Step 4 — Skip brief screen on resume:**

```tsx
const [sessionPhase, setSessionPhase] = useState<SessionPhase>(
  hasPartialProgress || storedMode ? 'inspect' : 'brief'
);
```

**Step 5 — Show resume banner when mid-progress is lost:**
Mid-scan progress (not yet confirmed to backend) cannot be restored. Show an info Alert:
> "Session resumed — fully confirmed items are restored. Any partial progress must be re-done."

### What survives refresh

| State | Survives? | How |
|-------|-----------|-----|
| Fully confirmed lines (inspection_complete = true) | ✅ Yes | Restored from backend |
| Partially scanned lines (count < expected) | ❌ No | Pure React state — not persisted |
| Session mode (count/scan) | ✅ Yes | sessionStorage |
| Session phase (brief/inspect/summary) | ✅ Partial | Inferred from confirmed state |

---

## 6. Form Input Standards

### Numeric fields

- **Qty fields:** `type="number"`, validate on change, show inline error `helperText` when invalid
- **Cost/price fields:** `type="text"`, `inputMode="decimal"`, regex `/^\d*\.?\d{0,2}$/` on change, auto-format to 2 decimal places on blur, `$` start adornment
- **Never block input silently** — always show a `helperText` error when input is rejected

### Dropdown with search (variant autocomplete)

- Clear `variantOptions` on `onBlur` with 150ms delay (allows click on dropdown option to register first)
- `variantOptions` must be per-line-item scoped OR cleared between line interactions to prevent overlay blocking adjacent fields
- Always validate that a variant is selected before allowing form submission — free-text without variant link must be blocked with a named error

### Linked vs unlinked items

- PO line items MUST be linked to a Shopify variant (`lasyncro_variant_id` non-null)
- Free-text entries (no variant) must be blocked at form submit with error: `"[description] is not linked to a Shopify product. Search and select it from the dropdown, or create it in Shopify first."`
- Tooltip on unlinked field: link to `https://admin.shopify.com/store/products/new` + "Then re-sync."

---

## 7. Scan Mode — Free-Scan Pattern

For workflows with multiple items (receive, pick), use **free-scan** rather than per-item scan:

```
Operator scans any item in the batch
  → barcode resolved via POST /api/v1/wms/barcode/resolve
  → matched to correct PO/batch line
  → count incremented on matched line
  → green flash on matched line row (150ms rgba(34,197,94,0.15) → transparent)
  → auto-confirms line when count = expected
  → all other lines remain active
```

### Green flash pattern

```tsx
const [flashLine, setFlashLine] = useState<string | null>(null);

// On successful scan increment:
setFlashLine(matchedLine.id);
setTimeout(() => { setFlashLine(null); scanInputRef.current?.focus(); }, 600);

// In render:
sx={{
  bgcolor: flashLine === line.id ? 'rgba(34,197,94,0.15)' : 'transparent',
  transition: 'background-color 0.4s ease',
}}
```

### 409 handling on auto-confirm

When a line reaches expected count and `onInspectLine` is called, a 409 means it was already confirmed in a prior session. Treat as success:

```tsx
try {
  await onInspectLine({ ... });
} catch (err: any) {
  if (err?.response?.status !== 409) throw err;
  // 409 = already confirmed — continue
}
```

### Overcount dialog

When scan count exceeds expected qty, pause and confirm:

- "You've already scanned N of N expected. Add another?"
- Yes → increment and continue
- No → dismiss, refocus input

---

## 8. Barcode Architecture

### Barcode namespace reservation (WM-46)

| Prefix | Namespace | Table | Notes |
|--------|-----------|-------|-------|
| `LSU-{8hex}` | Unit barcode | `inventory_units` | Generated at receive batch-confirm. Immutable. |
| `LSO-{8hex}` | Order invoice | `orders.wms_barcode` | Generated at batch release (WM-34). |
| Raw EAN/UPC/Shopify | Legacy variant | `external_product_identity_map` | Accepted while `legacy_barcode_fallback_enabled = true`. |

### Dual-namespace resolver (WM-46)

`barcodeResolution.service.ts` routes by prefix before any lookup:

1. `LSU-` prefix → unit barcode path → `inventory_units.lasyncro_unit_id`
2. `LSO-` prefix → invoice barcode path (WM-34, existing logic unchanged)
3. Known EAN/UPC/Shopify → legacy path, gated by `shop_wms_settings.legacy_barcode_fallback_enabled`
4. Unknown → reject with clear error — never silent failure

### Unit barcode generation (WM-46)

- **At receive batch-confirm:** `batchConfirmUnits` creates one `inventory_units` row per accepted unit
- **ID format:** `LSU-{SHA256(shop_id:receive_job_line_id:receive_sequence)[0:8]}` — deterministic, 12 chars, fits 50×25mm thermal label
- **Class A (has EAN/UPC):** `shopify_barcode` stored alongside for reprint disambiguation
- **Class B (no barcode):** anchored by receive_job_line_id + receive_sequence only
- **Reprint:** retrieval not regeneration — same inputs always produce same ID

### Progressive labelling + legacy sunset

- `legacy_barcode_fallback_enabled` defaults `true` — new shops accept both namespaces
- `coverage_sunset_threshold` defaults `100` — auto-disables legacy path at 100% coverage
- `GET /wms/coverage` returns `labelled_units`, `total_active_units`, `coverage_pct`
- Settings → Warehouse → Unit Label Coverage shows live metric

### Test store barcodes (dev only)

| SKU | Shopify barcode | LSU- format |
|-----|----------------|-------------|
| sku-hosted-1 | TEST-003 | LSU-{8hex} per unit |
| sku-managed-1 | — (Class B) | LSU-{8hex} per unit |

### Full architecture reference

See `docs/blueprints/unit_barcode_architecture.md` for locked decisions, data model, invariants, and implementation register.

---

## 9. Workflow-Specific Contracts

### Receive

- **Brief:** supplier name, variant table, mode selector (Count / Scan), Start button
- **Inspect (count):** one variant per screen, +/− counter, Set All shortcut, shortfall modal on confirm
- **Inspect (scan):** free-scan all lines simultaneously, per-line progress chips, green flash on hit
- **Summary:** per-line expected vs accepted table, total row, warning if shortfall, Close & Create Stow Tasks
- **Session key:** `?receiveJobId=` in URL · `receive-mode-{jobId}` in sessionStorage

### Stow *(next to audit)*

- **Brief:** stow task summary (SKU, qty, source), assigned location if known, Start button
- **Inspect:** location scan/type → product scan/type → qty confirm → shortfall modal
- **Summary:** location confirmed, qty placed, exceptions logged
- **Session key:** `?stowTaskId=` in URL
- **Known gap:** `ScanInput` already implemented. Brief + Summary screens need adding.

### Pick *(complete — June 1, 2026)*

- **Brief:** batch summary (line item count, total units), optimized route instruction, Start Picking CTA
- **Inspect:** single-item-per-screen, two-scan (or three-scan for qty > 1) pattern:
  - `location_scan` — ScanInput matches against `location_code` (client-side, accepts `LOC-A-1-3-7` or `A-1-3-7`)
  - `product_scan` — ScanInput resolved via `POST /api/v1/wms/barcode/resolve`
  - `qty_confirm` — numeric input, only shown when `line_item.quantity > 1`, operator counts and confirms
- **Track UI:** 3-point animated progress track. Active node pulses orange. Confirmed node solid green. Inactive node faded grey. Line fills left→right as steps complete.
- **Summary:** per-line results (picked vs exception), exception count warning, Confirm Pick Complete CTA
- **Session key:** `?batchId=` in URL, set by `onPickSessionEnter`, cleared by `onSessionExit`
- **Exception:** full taxonomy (item_missing, short_pick, defect, packaging_damage, wrong_item, wrong_variant, wrong_quantity, barcode_mismatch, other). Problem Center called on every exception alongside `/batch/:id/exception`.
- **Backend API:** `GET /api/v1/wms/batch/:id/line-items` returns `product_title` (from `products` join) + `variant_title` (from `order_line_items.title`). Items pre-sorted by `warehouse_locations.position_x/y` for optimized pick route.

### Pack/Ship *(complete — June 2, 2026)*

- **Brief:** batch summary (order count, line item count, total units), Start Packing CTA
- **Inspect:** order-by-order scan. Per order: scan each line item barcode via `ScanInput` → barcode resolved via `POST /api/v1/wms/barcode/resolve` → match confirmed → `order_complete` flag returned by `POST /api/v1/wms/pack/scan`. On `order_complete`: ship via `POST /api/v1/wms/batch/:id/ship`, advance to next order.
- **Blocking exceptions** (`item_missing`, `short_pick`): raise `PackDecisionRequest` → `awaiting_decision` phase → poll `GET /pack/decision-request/:id` every 4s → approved: advance with `partial_shipment` flag → rejected: record as `skipped`, requeue.
- **Non-blocking exceptions** (`product_defect`, `packaging_defect`, `wrong_item`): problem bin → advance immediately.
- **Summary:** per-order results (shipped / partial / skipped), counts strip, Confirm Pack Complete CTA → `POST /api/v1/wms/batch/:id/pack-complete`.
- **Session key:** `?packBatchId=` in URL, set by `onPackSessionEnter`, cleared by `onSessionExit`
- **Exception dialog:** non-dismissible (`onClose={() => undefined}`), split into blocking (warning style) / non-blocking (error style) sections.
- **Progress:** `LinearProgress` bar showing current order index / total orders at top of inspect phase.
- **Step banner:** `Alert icon={false}` on scan phase — "Scan the item barcode to verify it matches this order line."
- **Backend API:** `GET /api/v1/wms/batch/:id/orders` returns `product_title` (products join) + `variant_title` (oli.title). `POST /api/v1/wms/pack/scan` returns `{ scan_id, order_complete }`. `POST /api/v1/wms/batch/:id/ship` accepts `{ lasyncro_order_id, partial_shipment }`. `POST /api/v1/wms/batch/:id/pack-complete` closes batch.
- **Pack complete route:** `/batch/:batchId/pack-complete` (hyphen) — not `/pack/complete`.

---

## 10. Pre-Build Checklist for Each Workflow

Before writing any code for a new webapp workflow, run through this checklist:

- [ ] Read `docs/blueprints/WMS_process_blueprint.md` — confirm backend is live and stable
- [ ] Read `docs/blueprints/ReceiveJobProcess.md` — understand the receive pattern this is derived from
- [ ] Read `docs/playbooks/modules-ux-playbook.md` — CTA tokens, border-radius, fontWeight
- [ ] Read this document — apply all patterns without deviation
- [ ] Audit existing session page file with `grep -n "camera\|Camera\|BarcodeScan\|disabled\|brief\|summary"` — identify missing phases and wrong components
- [ ] Confirm `?sessionId=` param is kept in URL while session active
- [ ] Confirm `onSessionExit` cleans the URL param
- [ ] Confirm `sessionStorage` persists the inspect mode
- [ ] Confirm shortfall modal is wired for any `accepted < expected` scenario
- [ ] Confirm Problem Center is called on every exception report
- [ ] Confirm green flash on scan success
- [ ] Confirm scan input auto-focuses and re-focuses after error and after success
- [ ] Build check: `npm run build -w modules/wms` must be clean before and after

---

## 11. Open Backlog (Webapp WMS)

| ID | Workflow | Description | Priority |
|----|----------|-------------|----------|
| WEB-STOW-03 | Stow | ✅ RESOLVED June 1, 2026 — Brief + Summary screens built, 15 bugs fixed, UI simulation complete. See §12. | P1 |
| WEB-PICK-01 | Pick | ✅ RESOLVED June 1, 2026 — Brief screen added: batch ID, line item count, total units, optimized route instruction, Start Picking CTA. | P1 |
| WEB-PICK-02 | Pick | ✅ RESOLVED June 1, 2026 — Two-scan pattern per item: location_scan (client-side match) → product_scan (barcode resolver) → optional qty_confirm (quantity > 1). Camera/BarcodeScanSurface removed. 3-point animated track UI with pulse animation. | P1 |
| WEB-PICK-03 | Pick | ✅ RESOLVED June 1, 2026 — Summary screen: per-line results, exception count, Confirm Pick Complete CTA. Problem Center wired on every exception. Session persistence via ?batchId= URL param. product_title + variant_title added to line-items API. Full backend + UI simulation verified. | P1 |
| WEB-PACK-01 | Pack | ✅ RESOLVED June 2, 2026 — Full Playbook-compliant Pack workflow audited and implemented. 17 issues resolved. Brief screen (batch summary), ScanInput pattern, session persistence (?packBatchId= URL param), LinearProgress, step banner, Summary screen (per-order shipped/partial/skipped results), Problem Center on every exception, wrong_item added to dialog, product_title + variant_title split on backend. Backend smoke test passed: single-item + multi-item orders, ship confirmation, pack-complete. See §14. | P1 |
| WEB-RECEIVE-03 | Receive | Scan path (Path B) on webapp — Phase 2: per-unit barcodes | P2 |
| WEBHOOK-01 | Backend | ✅ RESOLVED June 2, 2026 — products/create + products/update webhooks registered. Dual-secret HMAC verification fixed. REST→GQL normalizer built. End-to-end verified. | P1 |
| UX-RESYNC-01 | Top Nav | ✅ RESOLVED June 2, 2026 — Live pill wired to Catalog Sync popover. Shows status, counts, recently synced products, ghost-orange resync trigger. GitHub #999 + #1000 filed for future expansion. | P2 |
| GH-998 | Backend | Per-unit barcode tracking (inventory_units table) | P3 |

---

## 12. Stow Workflow — UI Simulation Findings (June 1, 2026)

Derived from full webapp UI simulation and audit. All findings apply to future workflows unless noted.

### Bugs Found & Resolved

| ID | Description | Fix Applied |
|----|-------------|-------------|
| STOW-AUD-01 | No Summary screen — operator committed directly from qty_confirm with no review step | Added `summary` phase between `qty_confirm` and `complete` |
| STOW-AUD-02 | Scan errors silently swallowed — `void handler()` discarded rejected promises, `submitError` never set | Replaced with `.catch()` inline on both `ScanInput` call sites |
| STOW-AUD-03 | Shortfall modal dismissible via backdrop click — operator could bypass mandatory exception flow | `onClose={() => undefined}` — backdrop and Escape both neutralised |
| STOW-AUD-04 | `exQtyInput` pre-filled with shortfall qty — violates Playbook §3 (always blank) | `setExQtyInput('')` on shortfall dialog open |
| STOW-AUD-05 | Miscount escape hatch never disappeared — visible even after first exception committed | Wrapped in `{(shortfallDialog?.reported.length ?? 0) === 0 && (...)}` |
| STOW-AUD-06 | No inline Scan button on `ScanInput` — manual typists had no visible submit target | Added conditional `Button` appearing only when input has value |
| STOW-AUD-07 | No re-focus after error — Alert render stole focus from scan input | Added `useEffect` on `error` prop: `setTimeout(() => inputRef.current?.focus(), 50)` |
| STOW-AUD-08 | No `LinearProgress` bar on Inspect phases | Added `LinearProgress` after header `Box` on all three inspect phases |
| STOW-AUD-09 | No session persistence — refresh lost active session | Option B: frontend reads `?stowTaskId=` from URL, passes as `pendingStowTaskId` prop to `WmsModuleFT2`, auto-enters session on mount |
| STOW-AUD-10 | Brief screen had no title or orientation heading | Added "Stow Session" heading + subtitle before stats strip |
| STOW-AUD-11 | `opacity: 0.15` on container Box affected child Typography opacity | Replaced with `bgcolor: alpha(theme.palette.success.main, 0.15)` using MUI `alpha` utility |
| STOW-AUD-12 | `summary` phase name collided with upcoming Summary screen naming | Renamed to `brief` — `summary` reserved for the review-before-commit screen |
| UI-BUG-01/02 | Chip labels swapped — `location_scan` showed "Scan product", `product_scan` showed "Confirm quantity" | Corrected to "Scan location" (warning) and "Scan product" (info) respectively |
| UI-BUG-03 | No explicit operator instruction on scan order | Added `Alert` Step 1 of 2 / Step 2 of 2 banners under progress bar on each inspect phase |
| UI-BUG-04/05 | `fontWeight={700}` violations throughout, "Back To Operations" capitalisation | All `fontWeight` normalised to `600` per Playbook. CTA label lowercased. |
| BONUS | `qty_confirm` back button pointed to `brief` instead of `product_scan`, Chip label wrong | Fixed navigation and label |

---

### Stow-Specific Pitfalls — Do Not Repeat

**Session persistence — always Option B (URL param via frontend props)**
Never use `sessionStorage` alone for WMS session recovery. The established pattern is:

- Frontend reads `?{workflow}Id=` from URL via `useSearchParams`
- Passes as `pending{Workflow}` prop to `WmsModuleFT2`
- Module auto-enters session on mount via `useEffect`
- `onSessionExit` clears param via `setSearchParams({}, { replace: true })`
- `onSessionEnter` sets param via `setSearchParams({ {workflow}Id: id }, { replace: true })`

**Never use `void handler()` on async scan callbacks**
`void` discards the promise. Always use `.catch()` to surface errors to `submitError`:

```tsx
onSubmit={(v) => {
  void handleScan(v).catch((err: unknown) => {
    const msg = (err as any)?.response?.data?.error ?? (err instanceof Error ? err.message : 'Scan failed.');
    setSubmitError(msg);
  });
}}
```

**Never use `color="warning"` on MUI Buttons**
Renders MUI amber/yellow. Always use `sx={{ bgcolor: 'var(--accent)', '&:hover': { bgcolor: 'var(--accent)', opacity: 0.88 } }}`.

**Never use `opacity` on a container to tint child content**
Use `alpha(theme.palette.success.main, 0.15)` as `bgcolor` directly. Container opacity bleeds through to all children.

**Never pre-fill exception qty fields**
Playbook §3 is absolute: qty field in shortfall/exception modal always starts blank. Pre-filling removes operator accountability.

**Never use `BarcodeScanSurface` on webapp**
It opens the device camera. Webapp scan input is always the `ScanInput` TextField pattern from Playbook §2.

**Chip labels must match phase exactly**
Always verify chip label, chip color, and `ScanInput` hint are consistent with the active phase:

- `location_scan` → chip "Scan location" `color="warning"`, hint "Scan bin barcode or type location code"
- `product_scan` → chip "Scan product" `color="info"`, hint "Scan product barcode or type barcode value"
- `qty_confirm` → chip "Confirm quantity" `color="success"`

**Step orientation banners are mandatory on scan phases**
Every scan phase must show an `Alert icon={false}` banner stating which step the operator is on and what to scan. Operators in a warehouse context cannot be expected to infer scan order from phase chips alone.

**`fontWeight` max is `600` — enforce on every Typography**
`fontWeight={700}` is a Playbook violation. Run this before every PR:

```zsh
grep -n "fontWeight={700}\|fontWeight: 700" modules/wms/src/ui/pages/StowSessionPage.tsx
```

---

### Updated Stow Contract (§9 replacement)

Brief → location_scan → product_scan → qty_confirm → summary → complete

| Phase | Chip | Color | ScanInput hint | Step banner |
|-------|------|-------|----------------|-------------|
| `brief` | — | — | — | — |
| `location_scan` | Scan location | warning | "Scan bin barcode or type location code" | "Step 1 of 2 — Scan or type the bin barcode to confirm the destination location." |
| `product_scan` | Scan product | info | "Scan product barcode or type barcode value" | "Step 2 of 2 — Scan or type the product barcode to verify you have the correct item." |
| `qty_confirm` | Confirm quantity | success | — | — |
| `summary` | Review & confirm | primary | — | — |
| `complete` | — | — | — | — |

**Session key:** `?stowTaskId=` in URL, set by `onStowSessionEnter`, cleared by `onSessionExit`

**Shortfall modal:** mandatory, non-dismissible, blank qty, miscount escape hatch hidden after first exception committed

**Summary screen shows:** Location · Product · Units placing · Exceptions filed (if any) · Confirm & Stow CTA
---

## 13. Pick Workflow — UI Simulation Findings (June 1, 2026)

Derived from full webapp UI simulation and audit. All findings apply to future workflows unless noted.

### Bugs Found & Resolved

| ID | Description | Fix Applied |
|----|-------------|-------------|
| PICK-AUD-01/02 | `BarcodeScanSurface` + `Camera` import in use — opened PC webcam on product scan | Removed entirely. All scan input is `ScanInput` (TextField + Enter-to-submit) per Playbook §2 |
| PICK-AUD-03 | No Brief screen | Added `brief` phase: batch ID, line item count, total units, route instruction, Start Picking CTA |
| PICK-AUD-04 | Single-item-per-screen with no location scan | Added `location_scan` phase with client-side barcode match. `product_scan` phase follows. Optional `qty_confirm` phase for quantity > 1 |
| PICK-AUD-05 | No Summary screen | Added `summary` phase: per-line results (picked vs exception), exception count warning, Confirm Pick Complete CTA |
| PICK-AUD-06 | No session persistence | `?batchId=` URL param via `pendingPickBatchId` prop + `onPickSessionEnter` callback — mirrors Stow pattern |
| PICK-AUD-07 | `void handler()` on all async callbacks | Replaced with `.catch()` throughout |
| PICK-AUD-08 | MUI `color=` props (`success`, `warning`, `error`) on Buttons | Replaced with `sx={{ bgcolor: 'var(--accent)' }}` pattern throughout |
| PICK-AUD-09 | `fontWeight={700}` violations in 9 places | All normalised to `600` |
| PICK-AUD-10 | Exception types incomplete — missing `wrong_item`, `wrong_variant`, `barcode_mismatch`, `other` | Full Playbook §3 taxonomy implemented |
| PICK-AUD-11 | Problem Center never called on exception | `onCreateProblemTask` prop added. Called in sequence after `onReportException` on every exception |
| PICK-AUD-12/13 | No URL param session persistence in `WmsModuleFT2` or `WmsPage` | `pendingPickBatchId` prop + `onPickSessionEnter` wired in both files |
| BACKEND-01 | `GET /batch/:id/line-items` returned `title` (variant title only, no product name) | Added `products` join, now returns `product_title` + `variant_title` separately |
| UI-BUG-01 | Node 3 (qty confirm) absolutely positioned outside relative container — rendered in top nav | Removed premature closing `</Box>` before Node 3 block. Container now correctly wraps all three nodes |

### Pick-Specific Pitfalls — Do Not Repeat

**`external_product_identity_map` rows required for barcode resolution**
Variants seeded directly into `variants` (not via Shopify sync) have no identity map rows.
The barcode resolver returns null — scans silently fail. Always seed `external_product_identity_map`
before UI simulation. See `docs/psql/README.md` § Dev Barcode Seeding for the exact pattern.

**`external_variant_id` must be unique per `(shop_id, platform, external_product_id, external_variant_id)`**
Two variants from the same product (e.g. LINEN-GRY-M and LINEN-GRY-L) must use distinct
`external_variant_id` values (e.g. `dev-variant-linen-grym` vs `dev-variant-linen-gryl`).
`ON CONFLICT DO NOTHING` silently swallows duplicates — always verify with a SELECT after insert.

**Variant UUIDs change on every DB reset**
Never hardcode variant UUIDs in seed commands. Always re-query `variants` for current UUIDs first.

**`product_title` vs `variant_title` are distinct fields**
`order_line_items.title` stores the variant title (e.g. "Blue / XL"), not the product name.
Product name requires a join to `products`. The `LineItem` interface reflects this:
`product_title: string` (from products join) and `variant_title: string | null` (from oli.title).

**Absolute positioning within relative container — closing tag discipline**
The 3-point track card uses `position: relative` on the outer container. All three node `Box`
elements must be inside this container. A premature `</Box>` before Node 3 causes it to escape
to the nearest positioned ancestor in the DOM (the top nav). Always verify container nesting
with `sed -n` before and after inserting absolutely positioned children.

**qty_confirm phase only appears when `quantity > 1`**
For single-unit line items the flow is: location_scan → product_scan → advance.
For multi-unit line items: location_scan → product_scan → qty_confirm → advance.
The track renders 2 nodes (qty=1) or 3 nodes (qty>1) dynamically via `needsQtyConfirm`.

### Updated Pick Contract

`brief → location_scan → product_scan → [qty_confirm] → summary → done`

| Phase | Track node | Active color | Step banner |
|-------|-----------|--------------|-------------|
| `brief` | — | — | — |
| `location_scan` | Node 1 at 25%/33% pulsing | orange (`var(--accent)`) | "Step 1 of 2/3 — Walk to the location and scan the bin barcode." |
| `product_scan` | Node 2 at 50%/66% pulsing | orange (`var(--accent)`) | "Step 2 of 2/3 — Find the item and scan the product barcode." |
| `qty_confirm` | Node 3 at 75% pulsing | orange (`var(--accent)`) | "Step 3 of 3 — Count the units and confirm the quantity." |
| `summary` | — | — | — |
| `done` | — | — | — |

**Track line fill:** 0% → 50%/66% (after location) → 75%/100% (after product, qty=1 completes) → 100% (after qty confirm)

**Node positions with qty=1 (2-node):** Location at 33%, Product at 66%
**Node positions with qty>1 (3-node):** Location at 25%, Product at 50%, Qty at 75%

**Session key:** `?batchId=` in URL, set by `onPickSessionEnter`, cleared by `onSessionExit`

**Exception dialog:** non-dismissible (`onClose={() => undefined}`), full taxonomy, notes required for `barcode_mismatch` + `other`, qty field for `short_pick`

**Summary screen shows:** per-line product title + variant + location + status (picked/exception) · exception type label · picked count · exception count · Confirm Pick Complete CTA

---

## 14. Pack Workflow — Audit Findings (June 2, 2026)

Derived from full audit and backend smoke test. All findings apply to future workflows unless noted.

### Bugs Found & Resolved

| ID | Description | Fix Applied |
|----|-------------|-------------|
| PACK-AUD-01 | `BarcodeScanSurface` imported and used — opened PC webcam | Removed. All scan input is `ScanInput` (TextField + Enter-to-submit) per Playbook §2 |
| PACK-AUD-02 | No Brief screen | Added `brief` phase: order count, line item count, total units, Start Packing CTA |
| PACK-AUD-03 | No Summary screen | Added `summary` phase: per-order shipped/partial/skipped results, counts strip, Confirm Pack Complete CTA |
| PACK-AUD-04 | No session persistence | `?packBatchId=` URL param via `pendingPackBatchId` prop + `onPackSessionEnter` — mirrors Pick/Stow pattern |
| PACK-AUD-05 | No `scanInputRef`, no auto-focus, no re-focus after error | `scanInputRef` added. Two `useEffect`s: focus on `scanState === 'scanning'` phase enter and on `submitError` change |
| PACK-AUD-06 | `void handler()` on all async callbacks | Replaced with `.catch()` throughout — errors surface to `submitError` |
| PACK-AUD-07 | `fontWeight={700}` in 6 places | All normalised to `600` per Playbook |
| PACK-AUD-08 | MUI `color=` props on Buttons | Replaced with `sx={{ borderColor, color }}` using MUI theme tokens |
| PACK-AUD-09 | `borderRadius: 2/3` throughout | All replaced with `'6px'` per Playbook |
| PACK-AUD-10 | `aspectRatio: '4/3'` on state feedback Papers — mobile camera dimension | Replaced with `py: 4` content-sized layout |
| PACK-AUD-11 | No LinearProgress batch progress bar | Added above order header — shows current order index / total orders |
| PACK-AUD-12 | No step orientation banner | Added `Alert icon={false}` on scan phase |
| PACK-AUD-13 | Problem Center never called on exception | `onCreateProblemTask` prop added, called in sequence after `onReportException` on every exception |
| PACK-AUD-14 | `wrong_item` missing from exception dialog | Added to non-blocking section. Type signature extended. |
| PACK-AUD-15 | `PackLineItem.title` single field — no product name separation | Backend: added `products` join to `/batch/:id/orders` line items query. Interface: split into `product_title` + `variant_title`. Render updated. |
| PACK-AUD-16 | Dead `handlePackComplete` function — never called | Removed |
| PACK-AUD-17 | Exception dialog dismissible via backdrop/Escape | `onClose={() => undefined}` + `maxWidth="xs"` — matches Pick pattern |

### Pack-Specific Pitfalls — Do Not Repeat

**Pack complete route is `/batch/:batchId/pack-complete` (hyphen)**
Not `/pack/complete`. The route uses a hyphen, not a slash. Confirmed in `wms.routes.ts` line 160. Frontend (`WmsPage.tsx`) is correct. Any future smoke test or curl must use the hyphen form.

**`pick_scan_log` is append-only**
Trigger `prevent_pick_scan_log_mutation()` blocks DELETE and UPDATE at DB level. Never attempt to clean up pick scan log rows in dev teardown. Use `pack_scan_log`, `pick_batch_orders`, `pick_batches`, `order_*` tables for test cleanup only.

**`external_order_id` must be numeric**
`external_order_identity_map` has a CHECK constraint: `external_order_id ~ '^[0-9]+$'`. All test order IDs must be numeric strings (e.g. `'9000000001'`), not human-readable slugs.

**Pack has two exception classes — never collapse them**
Blocking (`item_missing`, `short_pick`) → `PackDecisionRequest` → owner approval loop.
Non-blocking (`product_defect`, `packaging_defect`, `wrong_item`) → problem bin → advance immediately.
The dialog must always show both sections separately with clear labels.

**`packResults` state drives the Summary screen**
Results are accumulated per order as `{ orderId, externalOrderId, status: 'shipped' | 'partial' | 'skipped' }`. `handleShipAndAdvance` records `shipped/partial`. Rejected decision records `skipped`. Last order transitions to `phase === 'summary'` instead of calling `onPackComplete` directly — `onPackComplete` is called only from the Summary CTA.

**Session persistence uses `packBatchId` — not `batchId`**
Pick uses `?batchId=`. Pack uses `?packBatchId=`. Both can be active simultaneously in theory (different operators). Keep them distinct.

### Updated Pack Contract (§9 replacement — see above)

`brief → active (order loop) → summary → done`

| Phase | Content |
|-------|---------|
| `brief` | Order count · Line item count · Total units · Start Packing CTA |
| `active` | LinearProgress (order N of M) · Order header · Current item · Step banner · ScanInput · State feedback (processing/wrong_item/accepted) · Report Issue button · awaiting_decision screen when blocking exception pending |
| `summary` | Shipped/partial/skipped counts strip · Per-order result rows with icons · Confirm Pack Complete CTA |

**Exception dialog:** non-dismissible, blocking section (warning) above divider, non-blocking section (error/default) below divider
**Session key:** `?packBatchId=` in URL, set by `onPackSessionEnter`, cleared by `onSessionExit`

### WEB-PACK-02 — Item-centric Free-scan Pack Surface ✅ RESOLVED June 5, 2026

**What shipped:**

- `POST /wms/pack/free-scan` — universal pack scanner. Routes by prefix:
  - `LSU-` → resolves unit → auto-claims batch (pick_complete → packing) on first scan → confirms pack scan → returns full order context (variant image, sibling line items with scan status, shipping address)
  - `LSO-` → verifies all siblings confirmed → ships order → auto-completes batch if last order
- Auto-print: invoice (A4) + carrier label fire on session open. Print failure non-blocking (warning banner, packer proceeds).
- `lasyncro_unit_id` added to `pick_scan_log` + `pack_scan_log` migrations (nullable, populated on LSU- scans).
- `packScan.service.ts` fixed: now updates authoritative `inventory_units` table (WM-46) instead of stale `inventory_unit_status`.
- Operations page: always-on pack mode panel with NodeTrack pulse animation, sad path inline errors (auto-dismiss 3.5s).
- `PackSessionPage` fully rewritten — item-centric, sibling thumbnails, LSO- confirm, Problem Center escape hatch, back-nav guard, LSO- mismatch rejection.
- Batch auto-complete fires silently on last LSO- scan (no screen, no redirect).

**Sad path rejection codes:**

- `unit_not_found` — LSU- not in inventory_units
- `not_picked` — unit status ≠ picked
- `already_packed` — unit already packed/shipped
- `no_pick_record` — no confirmed pick_scan_log entry for this unit
- `batch_not_ready` — batch status not pick_complete or packing
- `siblings_incomplete` — LSO- scanned before all line items confirmed
- `invoice_not_found` — LSO- not matched to any order

**Screens removed vs WEB-PACK-01:**
Brief, Summary, Order Complete, Manual Ship CTA.

---

## 15. Carrier Integration — WM-38 (June 3, 2026)

### Architecture

Adapter pattern — `ICarrierProvider` interface at `services/wms/carriers/ICarrierProvider.ts`. Adding a new carrier = new file implementing the interface + one line in `carrierLabel.service.ts` `PROVIDERS` map. Nothing else changes.

### Sendcloud (implementation v1)

- Merchant's own Sendcloud account — LaSyncro incurs zero label cost
- Credentials encrypted at rest (AES-256-GCM) in `shop_carrier_settings`
- Decrypt context: `wms.carrier.sendcloud`
- API call: `POST https://panel.sendcloud.sc/api/v2/parcels` with `request_label: true` + `apply_shipping_rules: true`
- Response: `tracking_number`, `tracking_url`, `label.label_printer` (PDF URL)

### Data model

| Table | Purpose |
|---|---|
| `shop_carrier_settings` | Per-shop, per-carrier encrypted credentials. PK: (shop_id, carrier_code). RLS enforced. |
| `order_shipment_tracking` | One row per physical shipment. Supports partial shipments. Consumed by Outbound module + Shopify writeback. |

### Label generation flow

```
POST /orders/:orderId/generate-label
  → idempotency check (return existing if already generated)
  → resolve shipping address from orders table
  → carrierLabel.service → decrypt credentials → ICarrierProvider.generateLabel()
  → persist to order_shipment_tracking
  → return { trackingNumber, trackingUrl, labelUrl }
```

### Shopify tracking writeback

`shipConfirmation.service.ts` step 5.5 reads `order_shipment_tracking` for the order and passes `trackingInfo` into `writeShopifyFulfillment`. Customers receive Shopify shipping notification with live carrier tracking link.

### Endpoints

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `PUT` | `/api/v1/wms/carrier-settings` | `wms:batch:release` | Upsert carrier credentials |
| `GET` | `/api/v1/wms/carrier-settings` | `wms:read` | List configured carriers (no raw keys) |
| `DELETE` | `/api/v1/wms/carrier-settings/:carrierCode` | `wms:batch:release` | Remove carrier |
| `POST` | `/api/v1/wms/orders/:orderId/generate-label` | `wms:pack:scan` | Generate + persist shipping label |

### Settings toggle

`shop_wms_settings.include_return_label` (boolean, default false) — controls return slip compositing onto WM-34 invoice PDF bottom half. Configurable via `PATCH /api/v1/wms/settings`.

### Testing without charge

Use Sendcloud's sandbox credentials + shipping method `"Unstamped letter"` (id: 8) — generates labels with no billing against merchant account.

---

## 16. Pack Label Generation — WM-38 Native Integration (June 3, 2026)

`handlePrintLabel` in `WmsPage.tsx` upgraded from Shopify packing slip to native carrier label generation.

### Flow

POST /api/v1/wms/orders/:orderId/generate-label
→ idempotent — returns existing label if already generated
→ labelUrl present → open carrier PDF in new tab ✅
→ no labelUrl / error → fallback to Shopify packing slip
→ 409 on packing slip → log and continue (fulfillment still processing)

### Operator experience

- Carrier configured: label PDF opens in new tab automatically at pack time
- No carrier configured: Shopify packing slip opens (pre-WM-38 behaviour preserved)
- Operator is never blocked — fallback always exists
