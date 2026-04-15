// modules/products/src/ui/pages/ProductsModuleFT2.tsx
import { Box, Typography, Chip, Divider, useTheme } from '@mui/material';

/**
 * ProductsModuleFT2DataProps
 * --------------------------
 * DATA-ONLY FT2 contract.
 *
 * Rules:
 * - Observational facts only
 * - No inference, scoring, or recommendations
 * - Null = truth unavailable or withheld by policy
 */
export interface ProductsModuleFT2DataProps {
  context: {
    period: { from: string; to: string };
    productsObserved: number | null;
    statusCounts: {
      active: number | null;
      inactive: number | null;
      archived: number | null;
    } | null;
    variantsObserved: number | null;
    productsWithSkuCount: number | null;
    productsWithoutSkuCount: number | null;
  };

  // Operational presence counts — raw facts, no inference
  operationalCounts: {
    productsWithInventoryCount: number | null;
    productsWithoutInventoryCount: number | null;
    skusWithSalesCount: number | null;
    totalSkusObserved: number | null;
  } | null;

  // Supply presence counts — raw facts, no inference
  supplyCounts: {
    productsWithInventorySignalCount: number | null;
  } | null;

  // Operator summary — purpose-built actionable surface
  // Source: GET /api/v1/modules/products/operator-summary
  // Null = endpoint not yet loaded or data unavailable
  operatorSummary: {
    sellability: {
      sellable: number | null;
      blocked: number | null;
      blockedReasons: {
        noSku: number | null;
        noInventory: number | null;
        zeroStock: number | null;
      };
    };
    deadWeight: {
      noSalesCount: number | null;
    };
    drift: {
      addedThisPeriod: number | null;
    };
    topReturned: Array<{
      variantTitle: string | null;
      sku: string | null;
      unitsReturned: number;
      revenueLeakage: number;
      returnRatePct: number;
    }>;
    noSkuProducts: Array<{
      productTitle: string | null;
      variants: Array<{ variantTitle: string | null }>;
    }>;
  } | null;

  outcome: { status: 'positive' | 'negative' | 'unknown' } | null;
  trend: { direction: 'up' | 'down' | 'flat' | 'unknown' } | null;

  productDataIntegrity: {
    integrity: 'ok' | 'attention' | 'unknown';
    duplication: 'present' | 'absent' | 'unknown';
  } | null;

  operational: {
    inventory: 'ok' | 'gaps' | 'unknown';
    fulfillment: 'visible' | 'missing' | 'unknown';
    stability: 'stable' | 'fragile' | 'unknown';
  } | null;

  supply: {
    replenishment: 'observable' | 'missing' | 'unknown';
    coverage: 'complete' | 'partial' | 'missing' | 'unknown';
  } | null;

  // Each field nullable independently — backend FTEP returns null per-field
  // when that domain's freshness is 'unknown' (see ProductDataFreshnessFtep.service.ts)
  dataFreshness: {
    structural: 'fresh' | 'stale' | 'unknown' | null;
    inventory: 'fresh' | 'stale' | 'unknown' | null;
    sales: 'fresh' | 'stale' | 'unknown' | null;
    fulfillment: 'fresh' | 'stale' | 'unknown' | null;
    cost: 'fresh' | 'stale' | 'unknown' | null;
  } | null;

  alignment: { alignment: 'aligned' | 'misaligned' | 'unknown' } | null;

  dependency: {
    surface: 'isolated' | 'coupled' | 'unknown';
    blastRadius: 'contained' | 'wide' | 'unknown';
  } | null;

  // Catalog-level signals — downgraded from intelligence layer
  // Source of truth: ProductsFtep.types.ts → signals
  signals?: {
    catalog: 'ok' | 'attention' | 'unknown';
    skuCoverage: 'ok' | 'gaps' | 'unknown';
    variantComplexity: 'simple' | 'complex' | 'unknown';
  } | null;
}

export type ProductsModuleFT2Props = ProductsModuleFT2DataProps;

// ─────────────────────────────────────────
// LABEL MAPS
// Faithful to FTEP semantics — do not add inference.
// 'unknown' always means "data insufficient", not "bad".
// Source of truth: ProductsFtep.types.ts
// ─────────────────────────────────────────
const INVENTORY_LABELS: Record<string, string> = {
  ok: 'Stock visible',
  gaps: 'Coverage gaps detected',
  unknown: 'Insufficient data',
};

const FULFILLMENT_LABELS: Record<string, string> = {
  visible: 'Fulfillment observable',
  missing: 'Fulfillment data absent',
  unknown: 'Insufficient data',
};

const STABILITY_LABELS: Record<string, string> = {
  stable: 'Operationally stable',
  fragile: 'Fragile state detected',
  unknown: 'Insufficient data',
};

const REPLENISHMENT_LABELS: Record<string, string> = {
  observable: 'Replenishment observable',
  missing: 'Replenishment data absent',
  unknown: 'Insufficient data',
};

const COVERAGE_LABELS: Record<string, string> = {
  complete: 'Full coverage',
  partial: 'Partial coverage',
  missing: 'Coverage absent',
  unknown: 'Insufficient data',
};

const SURFACE_LABELS: Record<string, string> = {
  isolated: 'Low dependency surface',
  coupled: 'High dependency surface',
  unknown: 'Insufficient data',
};

const BLAST_RADIUS_LABELS: Record<string, string> = {
  contained: 'Impact contained',
  wide: 'Wide blast radius',
  unknown: 'Insufficient data',
};

const ALIGNMENT_LABELS: Record<string, string> = {
  aligned: 'Domains in agreement',
  misaligned: 'Cross-domain divergence',
  unknown: 'Insufficient data',
};

const FRESHNESS_LABELS: Record<string, string> = {
  fresh: 'Fresh',
  stale: 'Stale',
  unknown: 'Insufficient data',
};

const CATALOG_LABELS: Record<string, string> = {
  ok: 'Catalog healthy',
  attention: 'Catalog needs attention',
  unknown: 'Insufficient data',
};

const SKU_COVERAGE_LABELS: Record<string, string> = {
  ok: 'Full SKU coverage',
  gaps: 'Coverage gaps detected',
  unknown: 'Insufficient data',
};

const VARIANT_COMPLEXITY_LABELS: Record<string, string> = {
  simple: 'Low complexity',
  complex: 'High complexity',
  unknown: 'Insufficient data',
};

// ─────────────────────────────────────────
// SIGNAL ROW
// Renders one label/value pair with theme-consistent
// color coding. Tone derives from enum value semantics.
// ─────────────────────────────────────────
type SignalTone = 'positive' | 'warning' | 'neutral';

function resolveSignalTone(value: string | null): SignalTone {
  if (value == null) return 'neutral';
  if (['ok', 'visible', 'stable', 'observable', 'complete', 'isolated', 'contained', 'aligned', 'fresh'].includes(value)) return 'positive';
  if (['gaps', 'missing', 'fragile', 'partial', 'coupled', 'wide', 'misaligned', 'stale'].includes(value)) return 'warning';
  return 'neutral';
}

function SignalRow({
  label,
  value,
  displayValue,
}: {
  label: string;
  value: string | null;
  displayValue: string;
}) {
  const theme = useTheme();

   // Use CSS variable references — palette values resolved at build time
  // do not update on scheme switch in MUI v6 colorSchemes mode.
  const toneColor: Record<SignalTone, string> = {
    positive: theme.palette.success.main,
    warning: theme.palette.warning.main,
    neutral: 'var(--mui-palette-text-secondary)',
  };

  const tone = resolveSignalTone(value);
  const color = toneColor[tone];

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        py: 1.25,
        px: 2,
        borderBottom: '1px solid',
        borderColor: 'divider',
        '&:last-child': { borderBottom: 'none' },
      }}
    >
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      <Typography variant="body2" fontWeight={600} sx={{ color }}>
        {displayValue}
      </Typography>
    </Box>
  );
}

// ─────────────────────────────────────────
// SECTION CARD
// Consistent card wrapper matching Overview/CashFlow pattern.
// ─────────────────────────────────────────
function SectionCard({
  title,
  footer,
  children,
}: {
  title: string;
  footer?: string;
  children: React.ReactNode;
}) {
  return (
    <Box
      sx={{
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 2,
        overflow: 'hidden',
        flex: 1,
        minWidth: 240,
      }}
    >
      <Box sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Typography variant="overline" color="text.secondary">
          {title}
        </Typography>
      </Box>
      {children}
      {footer && (
        <Box sx={{ px: 2, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontFamily: 'monospace' }}>
            {footer}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

// ─────────────────────────────────────────
// NULL SECTION
// Shown when an entire domain is suppressed by FTEP policy.
// 'null' here means "withheld by policy or data insufficient" —
// not an error state.
// ─────────────────────────────────────────
function SuppressedSection({ title }: { title: string }) {
  return (
    <SectionCard title={title}>
      <Box sx={{ px: 2, py: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Signal unavailable
        </Typography>
      </Box>
    </SectionCard>
  );
}

// ─────────────────────────────────────────
// ROOT COMPONENT
// ─────────────────────────────────────────
export default function ProductsModuleFT2(props: ProductsModuleFT2Props) {
  const {
    context,
    outcome,
    operational,
    supply,
    dependency,
    alignment,
    dataFreshness,
    signals,
    operationalCounts,
    supplyCounts,
    operatorSummary,
  } = props;

  const theme = useTheme();

  const outcomeColor =
    outcome?.status === 'positive'
      ? theme.palette.success.main
      : outcome?.status === 'negative'
      ? theme.palette.error.main
      : theme.palette.text.secondary;

  return (
    <Box sx={{ p: 3 }}>

    {/* ─────────────────────────────────────────
          ZONE 1 — YOUR PRODUCTS
          Orientation anchor only — one sentence.
          Detail lives in Zone 5 (sellability).
          ───────────────────────────────────────── */}
      <Box sx={{ mb: 3, display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Typography variant="h5" fontWeight={700} sx={{ color: 'var(--mui-palette-text-primary)' }}>
          You have {context.productsObserved ?? '—'} products
        </Typography>
        {outcome?.status != null && outcome.status !== 'unknown' && (
          <Chip
            label={outcome.status === 'positive' ? '✓ Looking good' : '✗ Needs attention'}
            size="small"
            color={outcome.status === 'positive' ? 'success' : 'error'}
          />
        )}
      </Box>

      {/* ─────────────────────────────────────────
          DATA TRUST BAR
          Collapsed from Zone 3 + Zone 4.
          Operator-readable freshness only — no system jargon.
          ───────────────────────────────────────── */}
      {dataFreshness && (
        <Box
          sx={{
            mb: 4,
            px: 2,
            py: 1.25,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 1.5,
          }}
        >
          <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, mr: 0.5 }}>
            Data trust
          </Typography>
          {(
            [
              ['Stock', dataFreshness.structural],
              ['Inventory', dataFreshness.inventory],
              ['Sales', dataFreshness.sales],
              ['Fulfillment', dataFreshness.fulfillment],
              ['Cost', dataFreshness.cost],
            ] as [string, string | null][]
          ).map(([label, value]) => {
            const isStale = value === 'stale';
            const isUnknown = value == null || value === 'unknown';
            const dotColor = isStale
              ? theme.palette.warning.main
              : isUnknown
              ? theme.palette.text.secondary
              : theme.palette.success.main;
            return (
              <Box key={label} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: dotColor, flexShrink: 0 }} />
                <Typography variant="caption" sx={{ color: isStale ? theme.palette.warning.main : 'var(--mui-palette-text-secondary)' }}>
                  {label}{isStale ? ' — stale' : ''}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}

      {/* ─────────────────────────────────────────
          ZONE 5 — WHAT CAN I ACTUALLY SELL TODAY?
          Plain-language sellability surface.
          Source: /operator-summary → sellability
          ───────────────────────────────────────── */}
      {operatorSummary && (() => {
        const total = (operatorSummary.sellability.sellable ?? 0) + (operatorSummary.sellability.blocked ?? 0);
        const sellable = operatorSummary.sellability.sellable ?? 0;
        const blocked = operatorSummary.sellability.blocked ?? 0;
        const noSku = operatorSummary.sellability.blockedReasons.noSku ?? 0;
        const noInventory = operatorSummary.sellability.blockedReasons.noInventory ?? 0;
        const zeroStock = operatorSummary.sellability.blockedReasons.zeroStock ?? 0;
        const noSales = operatorSummary.deadWeight.noSalesCount ?? 0;
        const added = operatorSummary.drift.addedThisPeriod ?? 0;
        const sellablePct = total > 0 ? (sellable / total) * 100 : 0;

        return (
          <Box sx={{ mb: 4, mt: 4 }}>
            {/* ── Header ── */}
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography variant="h5" fontWeight={700} sx={{ color: sellable === 0 ? theme.palette.error.main : sellable < total ? theme.palette.warning.main : theme.palette.success.main }}>
                {sellable} of {total}
              </Typography>
              <Typography variant="body1" fontWeight={500} sx={{ color: 'var(--mui-palette-text-primary)' }}>
                products are ready to sell
              </Typography>
            </Box>

            {/* ── Progress bar ── */}
            <Box sx={{ position: 'relative', height: 8, borderRadius: 1, bgcolor: theme.palette.error.main, overflow: 'hidden', mb: 2, mt: 1.5 }}>
              <Box sx={{
                position: 'absolute', left: 0, top: 0, height: '100%',
                width: `${sellablePct}%`,
                bgcolor: theme.palette.success.main,
                borderRadius: 1,
                transition: 'width 0.4s ease',
              }} />
            </Box>

            {/* ── Blocked reasons ── */}
            {blocked > 0 && (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 3 }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                  Why are {blocked} blocked?
                </Typography>
                {noSku > 0 && (
                  <Box sx={{ borderRadius: 1.5, border: '1px solid', borderColor: theme.palette.error.main, borderLeft: '4px solid', borderLeftColor: theme.palette.error.main, overflow: 'hidden' }}>
                    {/* Header row */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5 }}>
                      <Typography variant="body2" fontWeight={700} sx={{ color: theme.palette.error.main, minWidth: 24 }}>{noSku}</Typography>
                      <Box>
                        <Typography variant="body2" sx={{ color: 'var(--mui-palette-text-primary)' }}>
                          {noSku === 1 ? 'product has' : 'products have'} no product code — your warehouse can't identify or pick these
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Fix this in your store by adding a unique code to each product, then re-sync.
                        </Typography>
                      </Box>
                    </Box>
                    {/* Product list */}
                    {operatorSummary.noSkuProducts.length > 0 && (
                      <Box sx={{ borderTop: '1px solid', borderColor: theme.palette.error.main, opacity: 0.3 }} />
                    )}
                    {operatorSummary.noSkuProducts.map((p, idx) => (
                      <Box
                        key={idx}
                        sx={{
                          display: 'flex',
                          alignItems: 'baseline',
                          justifyContent: 'space-between',
                          px: 2,
                          py: 0.75,
                          borderTop: idx === 0 ? 'none' : '1px solid',
                          borderColor: 'divider',
                          '&:hover': { bgcolor: 'action.hover' },
                        }}
                      >
                        <Typography variant="body2" sx={{ color: 'var(--mui-palette-text-primary)', fontWeight: 500 }}>
                          {p.productTitle ?? 'Unknown product'}
                        </Typography>
                        {p.variants.length > 1 && (
                          <Typography variant="caption" color="text.secondary">
                            {p.variants.length} options: {p.variants.map(v => v.variantTitle ?? '—').join(', ')}
                          </Typography>
                        )}
                      </Box>
                    ))}
                  </Box>
                )}
                {noInventory > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: theme.palette.warning.main, borderLeft: '4px solid', borderLeftColor: theme.palette.warning.main }}>
                    <Typography variant="body2" fontWeight={700} sx={{ color: theme.palette.warning.main, minWidth: 24 }}>{noInventory}</Typography>
                    <Typography variant="body2" sx={{ color: 'var(--mui-palette-text-primary)' }}>
                      have no stock data — inventory hasn't been recorded for these products
                    </Typography>
                  </Box>
                )}
                {zeroStock > 0 && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, borderRadius: 1.5, border: '1px solid', borderColor: theme.palette.warning.main, borderLeft: '4px solid', borderLeftColor: theme.palette.warning.main }}>
                    <Typography variant="body2" fontWeight={700} sx={{ color: theme.palette.warning.main, minWidth: 24 }}>{zeroStock}</Typography>
                    <Typography variant="body2" sx={{ color: 'var(--mui-palette-text-primary)' }}>
                      are out of stock — listed as active but nothing left to ship
                    </Typography>
                  </Box>
                )}
              </Box>
            )}

            {/* ── Dead weight + drift ── */}
            <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
              {noSales > 0 && (
                <Box sx={{ flex: 1, minWidth: 200, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                  <Typography variant="h5" fontWeight={700} sx={{ color: theme.palette.warning.main, fontVariantNumeric: 'tabular-nums' }}>
                    {noSales}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, color: 'var(--mui-palette-text-primary)' }}>
                    {noSales === 1 ? 'product' : 'products'} generated no orders this period
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    Active but not selling — consider reviewing or archiving
                  </Typography>
                </Box>
              )}
              {added > 0 && (
                <Box sx={{ flex: 1, minWidth: 200, p: 2, border: '1px solid', borderColor: 'divider', borderRadius: 2 }}>
                  <Typography variant="h5" fontWeight={700} sx={{ color: theme.palette.primary.main, fontVariantNumeric: 'tabular-nums' }}>
                    {added}
                  </Typography>
                  <Typography variant="body2" sx={{ mt: 0.5, color: 'var(--mui-palette-text-primary)' }}>
                    {added === 1 ? 'product' : 'products'} added this period
                  </Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                    New to your catalog — check they're fully set up before selling
                  </Typography>
                </Box>
              )}
            </Box>
          </Box>
        );
      })()}

      {/* ─────────────────────────────────────────
          ZONE 6 — WHICH PRODUCTS KEEP COMING BACK?
          Plain-language return signal with visual rate bar.
          Source: /operator-summary → topReturned
          ───────────────────────────────────────── */}
      {operatorSummary && operatorSummary.topReturned.length > 0 && (() => {
        const maxRate = Math.max(...operatorSummary.topReturned.map(r => r.returnRatePct));
        return (
          <Box sx={{ mb: 4 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography variant="h5" fontWeight={700} sx={{ color: theme.palette.error.main }}>
                {operatorSummary.topReturned.length}
              </Typography>
              <Typography variant="body1" fontWeight={500} sx={{ color: 'var(--mui-palette-text-primary)' }}>
                {operatorSummary.topReturned.length === 1 ? 'product has' : 'products have'} significant return activity
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              High return rates may signal product quality, description, or fulfilment issues.
            </Typography>

            <Box sx={{ border: '1px solid', borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
              {operatorSummary.topReturned.map((item, idx) => {
                const barPct = maxRate > 0 ? (item.returnRatePct / maxRate) * 100 : 0;
                const rateColor = item.returnRatePct >= 20
                  ? theme.palette.error.main
                  : item.returnRatePct >= 10
                  ? theme.palette.warning.main
                  : theme.palette.success.main;
                const fmt = (n: number) =>
                  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

                return (
                  <Box
                    key={idx}
                    sx={{
                      px: 2,
                      py: 1.5,
                      borderBottom: '1px solid',
                      borderColor: 'divider',
                      '&:last-child': { borderBottom: 'none' },
                      '&:hover': { bgcolor: 'action.hover' },
                    }}
                  >
                    {/* Product name + code */}
                    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 1 }}>
                      <Box>
                        <Typography variant="body2" fontWeight={600} sx={{ color: 'var(--mui-palette-text-primary)' }}>
                          {item.variantTitle && item.variantTitle !== 'Default Title'
                            ? item.variantTitle
                            : item.sku
                            ? `Product ${item.sku}`
                            : `Product #${idx + 1}`}
                        </Typography>
                        {item.sku && (
                          <Typography variant="caption" color="text.secondary">
                            Code: {item.sku}
                          </Typography>
                        )}
                      </Box>
                      <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                          {item.unitsReturned} {item.unitsReturned === 1 ? 'unit' : 'units'} returned
                        </Typography>
                        <Typography variant="body2" fontWeight={700} sx={{ color: theme.palette.error.main }}>
                          {fmt(item.revenueLeakage)} lost
                        </Typography>
                      </Box>
                    </Box>

                    {/* Return rate bar */}
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <Box sx={{ flex: 1, height: 6, borderRadius: 1, bgcolor: 'divider', overflow: 'hidden' }}>
                        <Box sx={{
                          height: '100%',
                          width: `${barPct}%`,
                          bgcolor: rateColor,
                          borderRadius: 1,
                          transition: 'width 0.3s ease',
                        }} />
                      </Box>
                      <Typography variant="caption" fontWeight={700} sx={{ color: rateColor, minWidth: 60, textAlign: 'right' }}>
                        {item.returnRatePct}% returned
                      </Typography>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </Box>
        );
      })()}

    </Box>
  );
}