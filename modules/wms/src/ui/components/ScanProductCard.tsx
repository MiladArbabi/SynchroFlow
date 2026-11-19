// modules/wms/src/ui/components/ScanProductCard.tsx
//
// SF-WMS-SCAN-UX-01 — shared product information for workflow scan steps
// (Pick, Stow, Receive, Pack). Presentation only: every value comes from the
// caller's own server-backed state; nothing is derived, invented or selected
// here, and each workflow keeps its own state machine.
//
//   SCAN PRODUCT                       SCAN UNIT LABEL
//   [img]  Product Name · Variant      [img]  Product Name · Variant
//          SKU: <sku> (when present)          SKU: <sku> (when present)
//          Barcode: <barcode>                 Unit label: <full LSU from server (scan_unit_id)>
//          Quantity: <n>                      Quantity: <n>
//                                             ✓ <scanned LSU id>
//
// SF-PICK-UX-ADAPTIVE-01-QUANTITY-CUSTODY-001 — the card always shows the
// identifier the scan actually accepts: the product barcode, or in labelled
// stock one unit label (LSU). One label verifies product and location; the
// rest of the quantity is counted, so there is no per-label progress here.

import { useEffect, useState, type ReactNode } from 'react';
import { Box, Typography } from '@mui/material';
import { Package } from 'lucide-react';

const monoSx = {
  fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
  fontVariantNumeric: 'tabular-nums',
} as const;

export type ScanProductStage = 'product' | 'units';

export interface ScanProductCardProps {
  /** 'product' = SCAN PRODUCT, 'units' = SCAN UNIT LABEL. */
  stage: ScanProductStage;
  /**
   * Stage heading override (e.g. "Count units"). null omits the heading when
   * the workflow already renders its own single stage instruction.
   */
  stageLabel?: string | null;
  /**
   * Rows placed between the Barcode/LSU line and Quantity (e.g. Stow's
   * expected LSU labels, then SKU). Caller-owned data only.
   */
  middle?: ReactNode;
  /** data-testid prefix for name/barcode/quantity rows (default "scan-product"). */
  fieldTestIdPrefix?: string;
  /** false hides the barcode line (a workflow where a product barcode is never the scan target). */
  showBarcode?: boolean;
  productTitle: string;
  variantTitle?: string | null;
  imageUrl?: string | null;
  /**
   * The actual product barcode the caller's server payload carries. Never an
   * SKU, LSU or invented value. null = the server reports none → "Not
   * assigned"; undefined = the payload has no barcode field → line hidden.
   */
  barcode?: string | null;
  /**
   * SF-PICK-UX-ADAPTIVE-01-PRODUCT-IDENTITY-001 — the SKU the caller's server
   * payload carries. Shown only when present; never derived or substituted.
   */
  sku?: string | null;
  /** Required quantity for this task. */
  quantity: number;
  /** @deprecated ignored — one unit label verifies; kept for caller compatibility. */
  unitsRequired?: number;
  /**
   * SF-PICK-UX-ADAPTIVE-01-ACTIONABLE-ID-001 — 'units' stage: one eligible LSU
   * for this exact task, as the server projected it (scan_unit_id). Shown in
   * full; never verification (other eligible LSUs stay scannable); hidden
   * once a label is scanned (the verified LSU is shown instead). null → no line.
   */
  scanUnitId?: string | null;
  /** 'product' stage: the product barcode scan was accepted (green ✓; not a Pick commitment). */
  barcodeAccepted?: boolean;
  /** 'units' stage: the LSU ids the operator actually scanned, in scan order. */
  scannedUnitIds?: readonly string[];
  /** Optional extra rows under the facts (e.g. Stow's expected labels). */
  children?: ReactNode;
  testId?: string;
}

function ProductThumb({ src }: { src: string | null | undefined }) {
  const [broken, setBroken] = useState(false);
  useEffect(() => setBroken(false), [src]);
  const shown = !!src && !broken;
  return (
    <Box
      data-testid="scan-product-image"
      sx={{
        width: { xs: 64, sm: 80, md: 96 },
        height: { xs: 64, sm: 80, md: 96 },
        flexShrink: 0,
        display: 'grid',
        placeItems: 'center',
        border: '1px solid var(--rule-2)',
        borderRadius: '12px',
        bgcolor: shown ? 'var(--surface)' : 'var(--bg-2)',
        overflow: 'hidden',
      }}
    >
      {shown ? (
        <Box
          component="img"
          src={src!}
          alt=""
          onError={() => setBroken(true)}
          sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', display: 'block' }}
        />
      ) : (
        <Package size={22} aria-hidden="true" style={{ opacity: 0.45 }} />
      )}
    </Box>
  );
}

/** The identifier to scan: prominent, monospace, full value, wraps rather than clips. */
// SF-PICK-UX-ADAPTIVE-01-QUANTITY-UX-001 — same size as the neighbouring facts;
// the full value wraps (never clips). `accepted` = the scan matched (green ✓);
// it is not a Pick commitment, which only the server confirmation makes.
function ScanTarget({ label, value, testId, accepted = false }: { label: string; value: string; testId: string; accepted?: boolean }) {
  return (
    <Typography
      component="div"
      data-testid={testId}
      data-accepted={accepted ? 'true' : undefined}
      sx={{ fontSize: { xs: 14, md: 15 }, color: 'var(--ink-2)', lineHeight: 1.45, minWidth: 0 }}
    >
      <Box component="span" sx={{ color: 'var(--ink-3)' }}>{label}: </Box>
      <Box
        component="span"
        data-scan-target=""
        sx={{ ...monoSx, color: accepted ? 'var(--good-ink)' : 'var(--ink)', fontWeight: 600, overflowWrap: 'anywhere', wordBreak: 'break-all', whiteSpace: 'normal' }}
      >
        {accepted ? `✓ ${value}` : value}
      </Box>
    </Typography>
  );
}

function Fact({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <Typography
      component="div"
      data-testid={testId}
      sx={{ fontSize: { xs: 14, md: 15 }, color: 'var(--ink-2)', lineHeight: 1.45, overflowWrap: 'anywhere' }}
    >
      <Box component="span" sx={{ color: 'var(--ink-3)' }}>{label}: </Box>
      <Box component="span" sx={{ ...monoSx, color: 'var(--ink)', fontWeight: 500 }}>{children}</Box>
    </Typography>
  );
}

export function ScanProductCard({
  stage,
  stageLabel,
  productTitle,
  variantTitle,
  imageUrl,
  barcode,
  sku,
  quantity,
  scannedUnitIds = [],
  scanUnitId,
  barcodeAccepted = false,
  children,
  middle,
  fieldTestIdPrefix = 'scan-product',
  showBarcode = true,
  testId = 'scan-product-card',
}: ScanProductCardProps) {
  const heading = stage === 'units' ? null : (stageLabel === null ? null : stageLabel ?? 'Scan product');
  const fid = (s: string) => `${fieldTestIdPrefix}-${s}`;
  // Shopify's single-variant placeholder is not a variant name.
  const variant = variantTitle?.trim() && variantTitle.trim() !== 'Default Title' ? variantTitle.trim() : null;
  const name = variant ? `${productTitle} · ${variant}` : productTitle;
  const shownBarcode = barcode?.trim() || null;
  const shownSku = sku?.trim() || null;
  const shownScanUnitId = scanUnitId?.trim() || null;

  return (
    <Box data-testid={testId} data-stage={stage} sx={{ display: 'grid', gap: { xs: 1.25, md: 1.5 }, minWidth: 0 }}>
      {heading !== null ? (
        <Typography
          component="h2"
          data-testid="scan-stage-instruction"
          sx={{ m: 0, fontSize: 12, fontWeight: 600, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--accent-text)' }}
        >
          {heading}
        </Typography>
      ) : null}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: { xs: 1.5, md: 2 }, minWidth: 0 }}>
        <ProductThumb src={imageUrl} />
        <Box sx={{ minWidth: 0, display: 'grid', gap: '2px' }}>
          <Typography
            data-testid={fid('name')}
            sx={{ fontSize: { xs: 17, md: 20 }, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25, overflowWrap: 'anywhere' }}
          >
            {name}
          </Typography>
          {shownSku ? <Fact label="SKU" testId={fid('sku')}>{shownSku}</Fact> : null}
          {stage === 'units' ? (
            scannedUnitIds.length > 0 ? (
              // The verified LSU (possibly not the suggested one) replaces the suggestion, same row and size.
              <Box
                component="ul"
                aria-label="Scanned unit labels"
                data-testid={fid('scanned-lsus')}
                sx={{ listStyle: 'none', m: 0, p: 0, display: 'flex', flexWrap: 'wrap', gap: '2px 12px', fontSize: { xs: 14, md: 15 }, lineHeight: 1.45 }}
              >
                {scannedUnitIds.map((id) => (
                  <Box component="li" key={id} data-lsu={id} sx={{ ...monoSx, fontWeight: 600, color: 'var(--good-ink)', overflowWrap: 'anywhere', wordBreak: 'break-all' }}>
                    ✓ {id}
                  </Box>
                ))}
              </Box>
            ) : shownScanUnitId ? (
              <ScanTarget label="Unit label" value={shownScanUnitId} testId={fid('accepted-identifier')} />
            ) : null
          ) : showBarcode && barcode !== undefined ? (
            shownBarcode
              ? <ScanTarget label="Barcode" value={shownBarcode} testId={fid('barcode')} accepted={barcodeAccepted} />
              : <Fact label="Barcode" testId={fid('barcode')}>Not assigned</Fact>
          ) : null}
          {middle}
          <Fact label="Quantity" testId={fid('quantity')}>{quantity}</Fact>
        </Box>
      </Box>
      {children}
    </Box>
  );
}
