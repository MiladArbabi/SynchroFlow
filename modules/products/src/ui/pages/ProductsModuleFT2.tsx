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
  };

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

  const toneColor: Record<SignalTone, string> = {
    positive: theme.palette.success.main,
    warning: theme.palette.warning.main,
    neutral: theme.palette.text.secondary,
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
          ZONE 1 — CATALOG PRESENCE
          Top-level count. Active/archived deferred
          until backend computes them (ISS-03).
          ───────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Catalog Presence
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 0,
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 2,
            overflow: 'hidden',
          }}
        >
          <Box sx={{ flex: 1, minWidth: 160, px: 2, py: 1.5 }}>
            <Typography variant="h4" fontWeight={700} sx={{ fontVariantNumeric: 'tabular-nums' }}>
              {context.productsObserved ?? '—'}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
              Products detected
            </Typography>
          </Box>
          <Divider orientation="vertical" flexItem />
          <Box sx={{ flex: 1, minWidth: 160, px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography
              variant="body1"
              fontWeight={600}
              sx={{ color: outcomeColor }}
            >
              {outcome?.status === 'positive'
                ? 'Healthy'
                : outcome?.status === 'negative'
                ? 'Needs attention'
                : '—'}
            </Typography>
            {outcome?.status != null && outcome.status !== 'unknown' && (
              <Chip
                label={outcome.status === 'positive' ? '✓ All clear' : '✗ Attention needed'}
                size="small"
                color={outcome.status === 'positive' ? 'success' : 'error'}
              />
            )}
          </Box>
        </Box>
      </Box>

      {/* ─────────────────────────────────────────
          ZONE 2 — CATALOG SIGNALS
          Downgraded from intelligence layer.
          Source: ProductsFtep.types.ts → signals
          ───────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Catalog Signals
        </Typography>
        {signals ? (
          <SectionCard title="SKU Health" footer="> CATALOG SIGNALS — LOSSY, NON-SEMANTIC">
            <SignalRow label="Catalog health" value={signals.catalog} displayValue={CATALOG_LABELS[signals.catalog] ?? signals.catalog} />
            <SignalRow label="SKU coverage" value={signals.skuCoverage} displayValue={SKU_COVERAGE_LABELS[signals.skuCoverage] ?? signals.skuCoverage} />
            <SignalRow label="Variant complexity" value={signals.variantComplexity} displayValue={VARIANT_COMPLEXITY_LABELS[signals.variantComplexity] ?? signals.variantComplexity} />
          </SectionCard>
        ) : (
          <SuppressedSection title="SKU Health" />
        )}
      </Box>

      {/* ─────────────────────────────────────────
          ZONE 2 — OPERATIONAL + SUPPLY SIGNALS
          ───────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Operational Signals
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>

          {operational ? (
            <SectionCard title="Inventory & Fulfillment" footer="> OPERATIONAL SIGNALS — NO EXECUTION DETAIL">
              <SignalRow label="Inventory visibility" value={operational.inventory} displayValue={INVENTORY_LABELS[operational.inventory] ?? operational.inventory} />
              <SignalRow label="Fulfillment visibility" value={operational.fulfillment} displayValue={FULFILLMENT_LABELS[operational.fulfillment] ?? operational.fulfillment} />
              <SignalRow label="Operational stability" value={operational.stability} displayValue={STABILITY_LABELS[operational.stability] ?? operational.stability} />
            </SectionCard>
          ) : (
            <SuppressedSection title="Inventory & Fulfillment" />
          )}

          {supply ? (
            <SectionCard title="Supply & Replenishment" footer="> SUPPLY SIGNALS — NO FORECASTING">
              <SignalRow label="Replenishment observability" value={supply.replenishment} displayValue={REPLENISHMENT_LABELS[supply.replenishment] ?? supply.replenishment} />
              <SignalRow label="Supply coverage" value={supply.coverage} displayValue={COVERAGE_LABELS[supply.coverage] ?? supply.coverage} />
            </SectionCard>
          ) : (
            <SuppressedSection title="Supply & Replenishment" />
          )}

        </Box>
      </Box>

      {/* ─────────────────────────────────────────
          ZONE 3 — DEPENDENCY + ALIGNMENT
          ───────────────────────────────────────── */}
      <Box sx={{ mb: 4 }}>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          System Coherence
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>

          {dependency ? (
            <SectionCard title="Dependency Surface" footer="> IMPACT ASSESSMENT IS USER-INFERRED">
              <SignalRow label="Dependency surface" value={dependency.surface} displayValue={SURFACE_LABELS[dependency.surface] ?? dependency.surface} />
              <SignalRow label="Blast radius" value={dependency.blastRadius} displayValue={BLAST_RADIUS_LABELS[dependency.blastRadius] ?? dependency.blastRadius} />
            </SectionCard>
          ) : (
            <SuppressedSection title="Dependency Surface" />
          )}

          {alignment ? (
            <SectionCard title="Cross-Domain Alignment" footer="> SIGNAL ONLY — NO INTERPRETATION">
              <SignalRow label="Reality agreement" value={alignment.alignment} displayValue={ALIGNMENT_LABELS[alignment.alignment] ?? alignment.alignment} />
            </SectionCard>
          ) : (
            <SuppressedSection title="Cross-Domain Alignment" />
          )}

        </Box>
      </Box>

      {/* ─────────────────────────────────────────
          ZONE 4 — DATA FRESHNESS
          Per-domain, independently nullable.
          null per field = that domain's freshness unknown.
          ───────────────────────────────────────── */}
      <Box>
        <Typography variant="overline" color="text.secondary" sx={{ mb: 2, display: 'block' }}>
          Data Freshness
        </Typography>
        {dataFreshness ? (
          <SectionCard title="Trust Latency" footer="> PER-DOMAIN FRESHNESS — INDEPENDENT SIGNALS">
            {(
              [
                ['Structural data', dataFreshness.structural],
                ['Inventory data', dataFreshness.inventory],
                ['Sales data', dataFreshness.sales],
                ['Fulfillment data', dataFreshness.fulfillment],
                ['Cost data', dataFreshness.cost],
              ] as [string, string | null][]
            ).map(([label, value]) => (
              <SignalRow
                key={label}
                label={label}
                value={value}
                displayValue={value != null ? (FRESHNESS_LABELS[value] ?? value) : 'Insufficient data'}
              />
            ))}
          </SectionCard>
        ) : (
          <SuppressedSection title="Trust Latency" />
        )}
      </Box>

    </Box>
  );
}