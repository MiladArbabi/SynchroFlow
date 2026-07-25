# Print System Architecture Audit — 2026-07-25

## Context

Started as a Floor Planning UX pass on Setup > Canvas (marquee removal, pan
clamping, inspector fixes). Surfaced a real bug — location barcode labels
render correctly on-screen but print blank — which led to a full audit of
every print/label/document code path in the app. Findings below informed
GitHub issue: "Unified Printing System: barcodes, shipping labels, invoices."

## The three document types

### 1. Invoices — the reference pattern
- **File:** `apps/backend/src/services/wms/invoicePdf.service.ts`
- **Stack:** `pdf-lib` (PDF construction) + `bwip-js` (barcode → PNG, embedded as image)
- **Delivery:** `GET /api/v1/wms/orders/:orderId/invoice`, idempotent, server-rendered Buffer
- **Why it works:** barcode is rasterized server-side into the PDF as an
  image, not left as a client SVG hoping the browser's print pipeline
  renders it correctly. This is why invoices don't have the blank-barcode
  bug that Floor Planning has.

### 2. Shipping labels — external asset, not ours to render
- **Files:** `WmsOperationsPage.tsx` (`'Carrier returned no printable
  shipping-label URL'`), `ShopSettingsCarriersPage.tsx`
- **Origin:** fetched directly from carrier APIs (SendCloud, Shippo — see
  `sendcloudTrackingRouter`, `shippoTrackingRouter` in `express.ts`)
- **Implication:** no rendering needed or possible on our side — this is
  purely a delivery/routing problem (open URL, or hand blob to QZ Tray),
  never a generation problem.

### 3. Location/zone barcodes — the broken one
- **File:** `modules/floor-planning/src/ui/components/PrintPreviewPanel.tsx`
- **Stack:** `JsBarcode`, client-side, writes directly into an `<svg>` ref
- **Delivery:** `window.print()` with injected `@media print` CSS
- **Bugs found:**
  - Barcode SVG (`BarcodeSVG` component) has no `viewBox`, relies on
    `height: auto` — renders fine on-screen, renders blank in printed/PDF
    output. Root cause: print rasterization doesn't reliably resolve
    `height: auto` on an SVG without an explicit `viewBox`.
  - Print isolation CSS references `#lasyncro-print-root`, an element ID
    that is never actually rendered anywhere in the codebase (confirmed via
    full repo grep) — dead selector.
  - Setup > Canvas's "Print barcode" button (`onPrintBarcode` /
    `usePrintBarcode()`) calls `POST /zones/:locationCode/print`, which
    (per `floor-planning.controller.ts`'s `httpPrintBarcode`) only updates
    `last_printed_at` in the database. **No barcode is rendered or printed
    at all** — the button gives false confidence that a physical label
    was produced.

## The delivery layer that should unify everything

- **File:** `apps/frontend/src/utils/qzPrint.ts`
- **What it does:** `printViaQz(pdfBlob, role, axios)` — connects to QZ
  Tray (localhost:8182), resolves the shop's configured default printer
  for a given `role` (`GET /api/v1/wms/printers/default/:role`), dispatches
  the PDF silently. Never throws; returns `false` on any failure so the
  caller can fall back to opening the blob in-browser.
- **Printer config UI:** `apps/frontend/src/pages/ft2-pages/
  ShopSettingsWarehousePage.tsx` — printer registry, role assignment,
  QZ Tray status detection.
- **Key insight:** `printViaQz` is renderer-agnostic — it takes any PDF
  blob. It is already the right shape to be the single delivery layer for
  invoices, warehouse labels, and fetched shipping-label blobs alike. It
  just isn't consistently wired to all three yet.

## Proposed unified architecture

1. Extract a shared server-side barcode generator (`bwip-js`-based,
   matching the invoice pattern) — retire client-side `JsBarcode`.
2. New `warehouseLabelPdf.service.ts` (sibling to `invoicePdf.service.ts`)
   — real server-rendered PDF for location barcode labels. Single service,
   two entry points (Canvas single-zone print, Barcodes-tab batch print).
3. Zone-type-aware label format: small Code128 label for `type: 'bin'`,
   large A4 directional placard for `type: 'lane'` (bigger font, zone_type
   + child bin list, for operator wayfinding to a full aisle).
4. All three document types (invoice, warehouse label, fetched shipping
   label) flow through one delivery function: try `printViaQz` first
   (silent thermal, per configured printer role), fall back to
   browser open/download.
5. Extend the existing printer-role config pattern to cleanly cover all
   document types in one Settings > Warehouse screen.

## Target user context (why this matters)

SMB commerce, 1-20 operators + owners/admins, own-warehouse fulfillment,
$100K-$50M revenue, high SKU complexity. Printing/labeling is a daily,
physical-world workflow for this audience — a fragmented or unreliable
print system directly undermines the "stop firefighting, stop the Excel
chaos" product thesis.

## Status

Logged as a GitHub issue (epic). Not yet started — Floor Planning UX work
continued separately in parallel. Suggested first sub-issue: shared
barcode generator + `warehouseLabelPdf.service.ts`, since it fixes the
blank-barcode bug, replaces the non-functional Canvas print button, and
unlocks lane-vs-bin formatting in a single change.
