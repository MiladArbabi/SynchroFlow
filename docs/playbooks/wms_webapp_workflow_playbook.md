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

### Resolution order (POST /api/v1/wms/barcode/resolve)

1. `external_product_identity_map.barcode` — manufacturer barcode (EAN/UPC from Shopify)
2. `external_product_identity_map.external_sku` — SKU
3. `barcode_print_jobs.barcode_value` — LaSyncro-generated barcode

### Barcode generation timing

- **During receive:** operator scans manufacturer barcodes (from Shopify sync)
- **On receive close:** LaSyncro generates variant-level barcodes → `barcode_print_jobs`
- **After receive:** operator prints and attaches LaSyncro labels before stowing
- **Stow/Pick/Pack:** LaSyncro barcodes used

### Test store barcodes (dev only)
| SKU | Barcode | Variant ID |
|-----|---------|------------|
| sku-hosted-1 | TEST-003 | 1c89aca4-... |
| sku-managed-1 | TEST-004 | 7a0034b5-... |

### Phase 2 — Per-unit tracking
GitHub issue #998. Each physical unit gets a unique `unit_id` and barcode. Requires `inventory_units` table. See issue for full schema.

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

### Pack/Ship *(last)*

- **Brief:** order summary (items, customer, shipping method), Claim & Start
- **Inspect:** scan each item per order, confirm all items present, Ship confirmation
- **Summary:** all orders packed, ship confirmation per order
- **Session key:** `?batchId=` in URL
- **Known gap:** Brief + Summary screens need auditing.

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
| WEB-PACK-01 | Pack | Audit Brief + Summary presence | P1 |
| WEB-RECEIVE-03 | Receive | Scan path (Path B) on webapp — Phase 2: per-unit barcodes | P2 |
| WEBHOOK-01 | Backend | Register products/create + products/update webhooks | P1 |
| UX-RESYNC-01 | Top Nav | Live pill triggers manual resync | P2 |
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
