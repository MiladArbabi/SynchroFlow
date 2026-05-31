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

### Pick *(next after Stow)*
- **Brief:** batch summary (order count, line item count, total units), sorted pick route, Claim & Start
- **Inspect (scan):** free-scan items, per-line progress, auto-confirm, exception modal
- **Summary:** all lines picked, exceptions logged, Pick Complete CTA
- **Session key:** `?batchId=` in URL
- **Known gap:** Brief + Summary screens need adding. Scan mode not yet on webapp.

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
| WEB-STOW-03 | Stow | Add Brief + Summary screens to StowSessionPage | P1 |
| WEB-PICK-01 | Pick | Add Brief screen to pick session | P1 |
| WEB-PICK-02 | Pick | Add scan mode (free-scan) to pick session | P1 |
| WEB-PICK-03 | Pick | Add Summary screen to pick session | P1 |
| WEB-PACK-01 | Pack | Audit Brief + Summary presence | P1 |
| WEB-RECEIVE-03 | Receive | Scan path (Path B) on webapp — Phase 2: per-unit barcodes | P2 |
| WEBHOOK-01 | Backend | Register products/create + products/update webhooks | P1 |
| UX-RESYNC-01 | Top Nav | Live pill triggers manual resync | P2 |
| GH-998 | Backend | Per-unit barcode tracking (inventory_units table) | P3 |