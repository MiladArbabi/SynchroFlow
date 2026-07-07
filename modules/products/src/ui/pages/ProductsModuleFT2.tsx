// modules/products/src/ui/pages/ProductsModuleFT2.tsx
//
// INVENTORY MODULE — FT2 OPERATOR SURFACE
// Sprint 4 rebuild · May 2026
// ─────────────────────────────────────────────────────────────
// Layout:
//   1. Header      — DM Sans 22px/500 + live signal line
//   2. Stat Row    — 4 StatCards: Ready to Sell · Margin at Risk · Inbound · Dead Capital
//   3. Action Queue — ranked by urgency × actionability (no PO > overdue PO > low stock > no SKU > dead capital)
//   4. Inbound Pipeline — open POs with overdue flag + cash committed
//   5. Warehouse Readiness — stock-no-bin intersection signal
//   6. Return Leakage — top returned variants with restock CTA
//
// RULES:
// - No hardcoded hex. CSS variables or theme.palette.* only.
// - No inline style={}. MUI sx prop only.
// - No cross-module imports.
// - No fetching. All data via props.
// - fontWeight max 500. border 0.5px solid var(--rule).

import { Box, Typography, useTheme } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { alpha } from '@mui/material/styles';
import { Warehouse, RefreshCw } from 'lucide-react';
import { formatCurrencyCompact } from '@lasyncro/shared/ui';
import type { CurrencyContext } from '@lasyncro/shared/ui-contracts';

// ─── PROPS ────────────────────────────────────────────────────

export interface ProductsModuleFT2DataProps {
  context: {
    period: { from: string; to: string };
    productsObserved: number | null;
    variantsObserved: number | null;
    productsWithSkuCount: number | null;
    productsWithoutSkuCount: number | null;
    statusCounts: { active: number | null; inactive: number | null; archived: number | null } | null;
  };
  operatorSummary?: {
    sellability: {
      sellable: number | null;
      blocked: number | null;
      blockedReasons: {
        noSku: number | null;
        noInventory: number | null;
        zeroStock: number | null;
        phantom: number | null;
      };
    };
    deadWeight: { noSalesCount: number | null };
    drift: { addedThisPeriod: number | null };
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
    demand: {
      critical_reorder_count: number;
      warning_reorder_count: number;
      stockout_count: number;
      total_inventory_value: number;
      dead_capital_value: number;
      avg_days_of_stock: number | null;
      reorder_now: Array<{
        lasyncro_variant_id: string;
        sku: string | null;
        days_of_stock_remaining: number | null;
        estimated_stockout_date: string | null;
        velocity_per_day: number;
        suggested_reorder_qty: number | null;
      }>;
    } | null;
    inbound: {
      open_po_count: number;
      total_units_expected: number;
      total_committed_value_cents: number | null;
      overdue_pos: Array<{
        po_short_ref: string;
        supplier_name: string;
        status: string;
        expected_delivery_date: string | null;
        overdue_days: number | null;
        total_units_ordered: number;
        total_units_received: number;
        covers_stocked_out_skus: string[];
      }>;
      pending_pos: Array<{
        po_short_ref: string;
        supplier_name: string;
        status: string;
        expected_delivery_date: string | null;
        overdue_days: number | null;
        total_units_ordered: number;
        total_units_received: number;
        covers_stocked_out_skus: string[];
      }>;
    } | null;
    warehouse: {
      total_pick_bins: number;
      stocked_pick_bins: number;
      pick_zone_occupancy_pct: number | null;
      variants_with_stock_no_bin: number;
    } | null;
    finances: {
      total_margin_at_risk_per_week: number;
      active_sellers_no_cost: number;
      stocked_out_margin_variants: Array<{
        lasyncro_variant_id: string;
        sku: string | null;
        avg_sale_price: number;
        unit_cost: number;
        margin_per_unit: number;
        margin_pct: number;
        units_sold_30d: number;
        margin_lost_per_week: number;
      }>;
    } | null;
  } | null;
  // Legacy FT2 snapshot fields — retained for data trust bar
  dataFreshness: {
    structural: 'fresh' | 'stale' | 'unknown' | null;
    inventory: 'fresh' | 'stale' | 'unknown' | null;
    sales: 'fresh' | 'stale' | 'unknown' | null;
    fulfillment: 'fresh' | 'stale' | 'unknown' | null;
    cost: 'fresh' | 'stale' | 'unknown' | null;
  } | null;
  outcome: { status: 'positive' | 'negative' | 'unknown' } | null;
  operationalCounts: {
    productsWithInventoryCount: number | null;
    productsWithoutInventoryCount: number | null;
    skusWithSalesCount: number | null;
    totalSkusObserved: number | null;
  } | null;
  // Unused legacy fields — kept for prop-compat, not rendered
  trend?: unknown;
  signals?: unknown;
  productDataIntegrity?: unknown;
  operational?: unknown;
  supply?: unknown;
  alignment?: unknown;
  dependency?: unknown;
  supplyCounts?: unknown;
  currency?: CurrencyContext;
}

export type ProductsModuleFT2Props = ProductsModuleFT2DataProps;

// ─── HELPERS ──────────────────────────────────────────────────

const fmtN = (n: number | null | undefined): string =>
  n == null ? '—' : Math.round(n).toLocaleString();

function PulseRow({ label, value, valueColor, sub }: { label: string; value: string; valueColor?: string; sub?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', py: 1, borderBottom: '1px solid var(--rule)' }}>
      <Box>
        <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>{label}</Typography>
        {sub && <Typography sx={{ fontSize: 10, fontWeight: 300, color: 'var(--ink-4)', mt: 0.125 }}>{sub}</Typography>}
      </Box>
      <Typography sx={{ fontSize: 13, fontWeight: 600, color: valueColor ?? 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{value}</Typography>
    </Box>
  );
}

// ─── STAT CARD ────────────────────────────────────────────────
// Matches Orders FT2 StatCard exactly.
function StatCard({ label, value, valueColor, sub, cta, ctaHref }: {
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
  cta?: string;
  ctaHref?: string;
}) {
  const navigate = useNavigate();
  return (
    <Box sx={{
      bgcolor: 'var(--surface)',
      border: '0.5px solid var(--rule)',
      borderRadius: '8px',
      p: '12px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 0.5,
      flex: 1,
      minWidth: 0,
    }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: value.length > 6 ? 20 : 24, fontWeight: 500, color: valueColor ?? 'var(--ink)', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.25 }}>
          {sub}
        </Typography>
      )}
      {cta && ctaHref && (
        <Box
          onClick={() => navigate(ctaHref)}
          sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.375, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', mt: 0.5, cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
        >
          {cta} →
        </Box>
      )}
    </Box>
  );
}

// ─── SECTION HEADER ───────────────────────────────────────────

function SectionHeader({ label, meta }: { label: string; meta?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
      <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        {label}
      </Typography>
      {meta && (
        <Typography sx={{ fontSize: 10, color: 'var(--ink-4)' }}>
          {meta}
        </Typography>
      )}
    </Box>
  );
}

// ─── ACTION ROW ───────────────────────────────────────────────

type ActionRowProps = {
  dot: 'critical' | 'warning' | 'optimize';
  label: string;
  meta?: string;
  impact?: string;
  cta: string;
  ctaHref: string;
};

function ActionRow({ dot, label, meta, impact, cta, ctaHref }: ActionRowProps) {
  const theme = useTheme();
  const navigate = useNavigate();

  const dotColor =
    dot === 'critical' ? theme.palette.error.main :
    dot === 'warning'  ? theme.palette.warning.main :
                         'var(--ink-4)';

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      px: 2, py: 1.25,
      borderBottom: '0.5px solid var(--rule)',
      '&:last-child': { borderBottom: 'none' },
      '&:hover': { bgcolor: dot === 'optimize' ? 'action.hover' : alpha(dotColor, 0.04) },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, minWidth: 0 }}>
        <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: dotColor, flexShrink: 0 }} />
        <Box sx={{ minWidth: 0 }}>
          <Typography sx={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
            {label}
          </Typography>
          {meta && (
            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', mt: 0.125 }}>
              {meta}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0, ml: 2 }}>
        {impact && (
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: dot === 'critical' ? theme.palette.error.main : dot === 'warning' ? theme.palette.warning.main : 'var(--ink-4)', fontVariantNumeric: 'tabular-nums' }}>
            {impact}
          </Typography>
        )}
        {/* Primary action CTA — filled accent pill, consistent with Resolve → and Review › */}
        <Box
          onClick={() => navigate(ctaHref)}
          sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, '&:hover': { opacity: 0.88 } }}
        >
          {cta} →
        </Box>
      </Box>
    </Box>
  );
}

// ─── INBOUND ROW ──────────────────────────────────────────────

function InboundRow({ po, isOverdue }: {
  po: {
    po_short_ref: string;
    supplier_name: string;
    status: string;
    expected_delivery_date: string | null;
    overdue_days: number | null;
    total_units_ordered: number;
    total_units_received: number;
    covers_stocked_out_skus: string[];
  };
  isOverdue: boolean;
}) {
  const theme = useTheme();
  const navigate = useNavigate();

  const dateLabel = po.expected_delivery_date
    ? new Date(po.expected_delivery_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
    : '—';

  const statusLabel = po.status.replace(/_/g, ' ');

  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      px: 2, py: 1.25,
      borderBottom: '0.5px solid var(--rule)',
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box>
          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
            {po.supplier_name}
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>
            {po.po_short_ref} · {statusLabel}
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ fontSize: 12, fontWeight: 500, color: isOverdue ? theme.palette.error.main : 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
            {isOverdue ? `${po.overdue_days}d overdue` : `Due ${dateLabel}`}
          </Typography>
          <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
            {po.total_units_ordered} units
            {po.covers_stocked_out_skus.length > 0 && ` · covers ${po.covers_stocked_out_skus.length} stocked out`}
          </Typography>
        </Box>
        {isOverdue && (
          <Box
            onClick={() => navigate('/orders/inbound')}
            sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
          >
            Chase →
          </Box>
        )}
        {!isOverdue && po.status === 'shipped' && (
          <Box
            onClick={() => navigate('/orders/inbound')}
            sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
          >
            Receive →
          </Box>
        )}
      </Box>
    </Box>
  );
}

// ─── MAIN COMPONENT ───────────────────────────────────────────

export default function ProductsModuleFT2(props: ProductsModuleFT2Props) {
  const theme = useTheme();
  const navigate = useNavigate();
  const { context, operatorSummary, dataFreshness, currency } = props;

  const fmt$ = (n: number | null | undefined): string =>
    formatCurrencyCompact(n, currency?.displayCurrency, currency?.locale, currency?.rates);

  const os = operatorSummary;
  const sellable  = os?.sellability.sellable ?? 0;
  const blocked   = os?.sellability.blocked ?? 0;
  const total     = sellable + blocked;
  const noSku     = os?.sellability.blockedReasons.noSku ?? 0;
  const zeroStock = os?.sellability.blockedReasons.zeroStock ?? 0;
  const phantom   = os?.sellability.blockedReasons.phantom ?? 0;

  // Determine signal line
  const signalParts: string[] = [];
  if (context.variantsObserved)   signalParts.push(`${context.variantsObserved} SKUs`);
  if (phantom > 0)                 signalParts.push(`${phantom} phantom`);
  if (zeroStock > 0)               signalParts.push(`${zeroStock} stocked out`);
  if (os?.inbound?.total_units_expected) signalParts.push(`${os.inbound.total_units_expected} units inbound`);
  if (os?.warehouse?.pick_zone_occupancy_pct != null) signalParts.push(`${os.warehouse.pick_zone_occupancy_pct}% warehouse occupancy`);

  return (
    <Box sx={{ p: '24px 40px', minHeight: '100%', bgcolor: 'var(--bg)' }}>

      {/* ── 1. HEADER ─────────────────────────────────────────── */}
      <Box sx={{ mb: 2.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: theme.palette.success.main, flexShrink: 0 }} />
          <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
            Live
          </Typography>
        </Box>
        <Typography sx={{ fontSize: 26, fontWeight: 700, color: 'var(--ink)', lineHeight: 1.1, letterSpacing: '-0.02em', mb: 0.375 }}>
          Inventory
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {signalParts.length > 0 ? signalParts.join(' · ') : 'Loading inventory signals…'}
        </Typography>
      </Box>

      {/* ── DATA TRUST BAR ────────────────────────────────────── */}
      {dataFreshness && Object.values(dataFreshness).some(v => v === 'stale') && (
        <Box sx={{
          display: 'flex', alignItems: 'center', gap: 1.5,
          px: 2, py: 1, mb: 2.5,
          bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.12 : 0.06),
          border: `0.5px solid ${alpha(theme.palette.warning.main, 0.3)}`,
          borderRadius: '8px',
        }}>
          <RefreshCw size={12} color={theme.palette.warning.main} />
          <Typography sx={{ fontSize: 12, color: 'var(--ink-3)' }}>
            Some data may be stale —{' '}
            {(['structural','inventory','sales','fulfillment','cost'] as const)
              .filter(k => dataFreshness[k] === 'stale')
              .join(', ')}{' '}
            data needs a sync.
          </Typography>
        </Box>
      )}

      {/* ── 4. TWO COLUMN BODY ────────────────────────────────── */}
      {/* LEFT: Action queue  |  RIGHT: Inbound pipeline + Return leakage */}
      <Box sx={{ display: 'flex', gap: 2, alignItems: 'stretch', flexWrap: 'wrap' }}>

        {/* ── LEFT COLUMN — Action queue ──────────────────────── */}
        {os && (
          <Box sx={{ flex: 2, minWidth: 320, display: 'flex', flexDirection: 'column', gap: 2 }}>
            {/* Warehouse banner — inside left column above action queue */}
            {os?.warehouse && os.warehouse.variants_with_stock_no_bin > 0 && (
              <Box sx={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                px: 2, py: 1.5,
                border: `0.5px solid ${alpha(theme.palette.warning.main, 0.35)}`,
                bgcolor: alpha(theme.palette.warning.main, theme.palette.mode === 'dark' ? 0.08 : 0.04),
                borderRadius: '10px',
              }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <Warehouse size={14} color={theme.palette.warning.main} />
                  <Box>
                    <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                      {os.warehouse.variants_with_stock_no_bin} SKUs have stock but no pick bin assigned
                    </Typography>
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {os.warehouse.pick_zone_occupancy_pct ?? 0}% occupancy · {os.warehouse.stocked_pick_bins} of {os.warehouse.total_pick_bins} bins stocked · stow before next pick run
                    </Typography>
                  </Box>
                </Box>
                <Box
                  onClick={() => navigate('/wms/readiness')}
                  sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', ml: 2, '&:hover': { opacity: 0.75 } }}
                >
                  Fix in WMS →
                </Box>
              </Box>
            )}
            <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden', flex: 1 }}>
              <Box sx={{ px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  Action queue
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {os.demand && (os.demand.critical_reorder_count > 0 || os.demand.warning_reorder_count > 0) && (
                    <Typography sx={{ fontSize: 10, color: theme.palette.error.main, fontWeight: 500 }}>
                      {os.demand.critical_reorder_count} critical · {os.demand.warning_reorder_count} warning
                    </Typography>
                  )}
                  <Box
                    onClick={() => navigate('/demand')}
                    sx={{ display: 'inline-flex', alignItems: 'center', px: 1, py: 0.375, fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                  >
                    See all in Demand →
                  </Box>
                </Box>
              </Box>

              {/* Priority 1: stocked out with no covering PO */}
              {os.demand?.reorder_now
                .filter(v => {
                  const coveredByPO = os.inbound
                    ? [...os.inbound.overdue_pos, ...os.inbound.pending_pos].some(po =>
                        po.covers_stocked_out_skus.includes(v.lasyncro_variant_id)
                      )
                    : false;
                  return v.days_of_stock_remaining === 0 && !coveredByPO;
                })
                .slice(0, 4)
                .map(v => {
                  const fin = os.finances?.stocked_out_margin_variants.find(f => f.lasyncro_variant_id === v.lasyncro_variant_id);
                  return (
                    <ActionRow
                      key={v.lasyncro_variant_id}
                      dot="critical"
                      label={v.sku ?? 'No SKU'}
                      meta={`Stocked out · no inbound PO · ${v.velocity_per_day.toFixed(2)} units/day`}
                      impact={fin ? `${fmt$(fin.margin_lost_per_week)}/wk lost` : undefined}
                      cta="Order"
                      ctaHref="/suppliers"
                    />
                  );
                })}

              {/* Priority 2: stocked out with overdue PO */}
              {os.inbound?.overdue_pos
                .filter(po => po.covers_stocked_out_skus.length > 0)
                .map(po => (
                  <ActionRow
                    key={po.po_short_ref}
                    dot="critical"
                    label={`${po.supplier_name} PO ${po.po_short_ref}`}
                    meta={`${po.overdue_days}d overdue · covers ${po.covers_stocked_out_skus.length} stocked-out SKU${po.covers_stocked_out_skus.length > 1 ? 's' : ''}`}
                    impact={po.overdue_days != null && po.overdue_days > 0 ? `${po.overdue_days}d late` : undefined}
                    cta="Chase"
                    ctaHref="/orders/inbound"
                  />
                ))}

              {/* Priority 3: no SKU */}
              {noSku > 0 && (
                <ActionRow
                  dot="warning"
                  label={`${noSku} SKUs have no product code`}
                  meta="WMS-Lite can't pick or receive these — fix in Shopify"
                  cta="Fix in Catalog"
                  ctaHref="/inventory/catalog"
                />
              )}

              {/* Priority 4: critically low stock */}
              {os.demand && os.demand.critical_reorder_count - os.demand.stockout_count > 0 && (
                <ActionRow
                  dot="warning"
                  label={`${os.demand.critical_reorder_count - os.demand.stockout_count} SKUs under 7 days stock`}
                  meta="Order before they run out"
                  cta="See Demand"
                  ctaHref="/demand"
                />
              )}

              {/* Priority 5: dead capital */}
              {os.demand && os.demand.dead_capital_value > 0 && (
                <ActionRow
                  dot="optimize"
                  label={`${fmt$(os.demand.dead_capital_value)} in non-moving stock`}
                  meta="Active SKUs with stock but zero velocity"
                  cta="Review"
                  ctaHref="/demand"
                />
              )}

              {/* Priority 6: unrestocked returns */}
              {os.topReturned.length > 0 && (
                <ActionRow
                  dot="optimize"
                  label={`${os.topReturned.length} returned product${os.topReturned.length > 1 ? 's' : ''} not restocked`}
                  meta="Every unrestocked return is double-lost — revenue refunded and inventory not recovered"
                  cta="Fix in Returns"
                  ctaHref="/returns"
                />
              )}
            </Box>
          </Box>
        )}

        {/* ── RIGHT COLUMN — Inventory pulse + Inbound pipeline + Return leakage ─── */}
        <Box sx={{ flex: 1, minWidth: 280, display: 'flex', flexDirection: 'column', gap: 2 }}>

          {/* Inventory pulse */}
          {os && (
            <Box sx={{ bgcolor: 'var(--surface)', border: '1px solid var(--rule)', borderRadius: '14px', p: '18px 20px' }}>
              <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', mb: 1 }}>
                Inventory pulse
              </Typography>
              <PulseRow label="Ready to sell" value={`${fmtN(sellable)} of ${fmtN(total)}`} valueColor={sellable === 0 ? '#E5484D' : sellable < total ? '#D9A23B' : '#4CAF7A'} />
              <PulseRow label="Margin at risk" value={os.finances ? fmt$(os.finances.total_margin_at_risk_per_week) + '/wk' : '—'} valueColor={os.finances && os.finances.total_margin_at_risk_per_week > 0 ? '#E5484D' : undefined} />
              <PulseRow label="Phantom" value={String(phantom)} valueColor={phantom > 0 ? '#E5484D' : undefined} sub="sold without recorded receiving" />
              <PulseRow label="Stocked out" value={String(zeroStock)} valueColor={zeroStock > 0 ? '#D9A23B' : undefined} />
              <PulseRow label="Inbound" value={os.inbound ? `${fmtN(os.inbound.total_units_expected)} units` : '—'} sub={os.inbound ? `${os.inbound.open_po_count} open PO${os.inbound.open_po_count === 1 ? '' : 's'}` : undefined} />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 1 }}>
                <Typography sx={{ fontSize: 12, fontWeight: 300, color: 'var(--ink-3)' }}>Dead capital</Typography>
                <Typography sx={{ fontSize: 13, fontWeight: 600, color: os.demand && os.demand.dead_capital_value > 0 ? '#D9A23B' : 'var(--ink)', fontVariantNumeric: 'tabular-nums' }}>{os.demand ? fmt$(os.demand.dead_capital_value) : '—'}</Typography>
              </Box>
            </Box>
          )}

          {/* Inbound pipeline */}
          {os?.inbound && os.inbound.open_po_count > 0 && (
            <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>
              <Box sx={{ px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                  Inbound pipeline
                </Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                  {os.inbound.total_committed_value_cents != null && (
                    <Typography sx={{ fontSize: 11, color: 'var(--ink-4)' }}>
                      {fmt$(os.inbound.total_committed_value_cents / 100)} committed
                    </Typography>
                  )}
                  <Box
                    onClick={() => navigate('/cashflow')}
                    sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 500, color: 'var(--accent)', border: '0.5px solid var(--accent)', borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.75 } }}
                  >
                    Cash Flow →
                  </Box>
                </Box>
              </Box>
              {os.inbound.overdue_pos.map(po => (
                <InboundRow key={po.po_short_ref} po={po} isOverdue={true} />
              ))}
              {os.inbound.pending_pos.map(po => (
                <InboundRow key={po.po_short_ref} po={po} isOverdue={false} />
              ))}
            </Box>
          )}

          {/* Return leakage */}
          {os?.topReturned && os.topReturned.length > 0 && (() => {
            const maxRate = Math.max(...os.topReturned.map(r => r.returnRatePct));
            const totalLeakage = os.topReturned.reduce((s, r) => s + r.revenueLeakage, 0);
            return (
              <Box sx={{ bgcolor: 'var(--surface)', border: '0.5px solid var(--rule)', borderRadius: '10px', overflow: 'hidden' }}>
                <Box sx={{ px: 2, py: 1.25, borderBottom: '0.5px solid var(--rule)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <Typography sx={{ fontSize: 10, fontWeight: 500, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
                    Return leakage
                  </Typography>
                  <Typography sx={{ fontSize: 11, color: theme.palette.error.main, fontWeight: 500 }}>
                    {fmt$(totalLeakage)} lost · 0% restocked
                  </Typography>
                </Box>
                {os.topReturned.map((item, idx) => {
                  const barPct = maxRate > 0 ? (item.returnRatePct / maxRate) * 100 : 0;
                  const rateColor = item.returnRatePct >= 20 ? theme.palette.error.main
                    : item.returnRatePct >= 10 ? theme.palette.warning.main
                    : theme.palette.success.main;
                  return (
                    <Box
                      key={idx}
                      sx={{
                        px: 2, py: 1.5,
                        borderBottom: '0.5px solid var(--rule)',
                        '&:last-child': { borderBottom: 'none' },
                      }}
                    >
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 0.75 }}>
                        <Box>
                          <Typography sx={{ fontSize: 13, fontWeight: 500, color: 'var(--ink)' }}>
                            {item.variantTitle && item.variantTitle !== 'Default Title' ? item.variantTitle : item.sku ?? `Item ${idx + 1}`}
                          </Typography>
                          {item.sku && (
                            <Typography sx={{ fontSize: 11, color: 'var(--ink-4)', fontFamily: 'monospace' }}>
                              {item.sku}
                            </Typography>
                          )}
                        </Box>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                          <Typography sx={{ fontSize: 12, color: 'var(--ink-4)' }}>
                            {item.unitsReturned} returned
                          </Typography>
                          <Typography sx={{ fontSize: 12, fontWeight: 500, color: theme.palette.error.main }}>
                            {fmt$(item.revenueLeakage)} lost
                          </Typography>
                           <Box
                            onClick={() => navigate('/returns')}
                            sx={{ display: 'inline-flex', alignItems: 'center', px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600, bgcolor: 'var(--accent)', color: theme.palette.common.white, borderRadius: '6px', cursor: 'pointer', '&:hover': { opacity: 0.88 } }}
                          >
                            Restock →
                          </Box>
                        </Box>
                      </Box>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ flex: 1, height: 4, borderRadius: 1, bgcolor: 'var(--bg)', overflow: 'hidden' }}>
                          <Box sx={{ height: '100%', width: `${barPct}%`, bgcolor: rateColor, borderRadius: 1, transition: 'width 0.3s ease' }} />
                        </Box>
                        <Typography sx={{ fontSize: 11, fontWeight: 500, color: rateColor, minWidth: 70, textAlign: 'right' }}>
                          {item.returnRatePct}% returned
                        </Typography>
                      </Box>
                    </Box>
                  );
                })}
              </Box>
            );
          })()}

        </Box>{/* end RIGHT COLUMN */}
      </Box>{/* end TWO COLUMN BODY */}

    </Box>
  );
}