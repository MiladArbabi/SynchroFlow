/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/pages/ft2-pages/ReturnsOverviewPage.tsx
//
// Returns — Overview tab
// ----------------------
// Owner-facing daily triage. Answers: "What needs my attention, and what
// is my return problem costing me?"
//
// Layout: canonical FT2 triage + pulse (see docs/playbooks/modules-ux-playbook.md
// §1 — Orders Overview is the source of truth for this pattern).
//   LEFT  — Needs attention: orphaned return jobs, ranked oldest-first
//   RIGHT — Returns Pulse: 6 shop-level stats, compressed
//   BELOW — By Product / By Supplier detail tables (unchanged data, kept
//           full-width since they're reference detail, not decisions)
//
// Data:
//   useReturns()            → /api/v1/modules/returns (includes orphaned_jobs, RT2-03)
//   useReturnsCorrelation() → /api/v1/modules/returns/correlation
//
// Theme: useReturnsTheme() — now token-based (RT2-AUD-27 fix), matches
// the rest of FT2 rather than hardcoded hex.

import { Box, Typography, CircularProgress, Alert, Chip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { RotateCcw, TrendingDown, Clock, CheckCircle } from 'lucide-react';
import { useReturns, type ReturnsByVariant, type OrphanedReturnJob } from '../finances/useReturns';
import { useReturnsCorrelation } from '../returns/useReturnsCorrelation';
import { PlanGate } from '../../components/PlanGate';

// ─── Theme ───────────────────────────────────────────────────────────────────
// RT2-AUD-27: replaced hardcoded hex with CSS var tokens per the modules
// UX playbook's Hard Rules (§1). Severity colors kept as explicit hex
// since no --severity-* tokens exist yet — matches the pattern already
// used in FinancesIntelligencePage.tsx's SignalRow.

function useReturnsTheme() {
  return {
    pageBg:      'var(--bg)',
    cardBg:      'var(--surface)',
    border:      'var(--rule)',
    textPrimary: 'var(--ink)',
    textSecond:  'var(--ink-3)',
    tileBg:      'var(--bg-3)',
    errorBg:     'rgba(239,68,68,0.08)',
    errorBorder: '#EF4444',
    rateHigh:    '#DC2626',
    rateMid:     '#F59E0B',
    rateOk:      '#22C55E',
  };
}

const fmt = (n: number) =>
  `$${Number(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

// ─── Triage row (canonical "Needs a decision" anatomy) ───────────────────────
// Mirrors FinancesIntelligencePage.tsx's SignalRow exactly.

function SignalRow({ icon, title, detail, cta, onClick, severity }: {
  icon: React.ReactNode;
  title: string;
  detail: string;
  cta?: string;
  onClick?: () => void;
  severity: 'critical' | 'warning' | 'ok';
}) {
  const pal = useReturnsTheme();
  const sevColor =
    severity === 'critical' ? pal.rateHigh :
    severity === 'warning'  ? pal.rateMid  :
                               pal.rateOk;
  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 2,
      px: 2.5, py: 2,
      borderTop: `0.5px solid ${pal.border}`,
    }}>
      <Box sx={{ mt: 0.25, color: sevColor, flexShrink: 0 }}>{icon}</Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary }}>{title}</Typography>
        <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: 0.25 }}>{detail}</Typography>
      </Box>
      {cta && onClick && (
        <Box
          onClick={onClick}
          sx={{
            display: 'inline-flex', alignItems: 'center',
            px: 1.25, py: 0.5,
            fontSize: 11, fontWeight: 600,
            color: 'var(--accent)',
            border: '0.5px solid var(--accent)',
            borderRadius: '6px',
            cursor: 'pointer', flexShrink: 0,
            '&:hover': { opacity: 0.75 },
          }}
        >
          {cta} →
        </Box>
      )}
    </Box>
  );
}

// ─── Pulse stat (compact, for the pulse rail) ─────────────────────────────────
function PulseStat({ label, value }: { label: string; value: string }) {
  const pal = useReturnsTheme();
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', py: 0.75 }}>
      <Typography sx={{ fontSize: 12, color: pal.textSecond }}>{label}</Typography>
      <Typography sx={{ fontSize: 14, fontWeight: 600, color: pal.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </Typography>
    </Box>
  );
}

// ─── Segmented composition bar (mirrors Overview's Collected/At-risk pattern) ─

function CompositionBar({ segments }: { segments: { label: string; value: number; color: string }[] }) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  return (
    <Box sx={{ mt: 1, mb: 1.5 }}>
      <Box sx={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', bgcolor: 'var(--bg-3)' }}>
        {segments.map((s, i) => (
          <Box key={i} sx={{
            width: total > 0 ? `${(s.value / total) * 100}%` : '0%',
            bgcolor: s.color,
          }} />
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 2, mt: 0.75, flexWrap: 'wrap' }}>
        {segments.map((s, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: s.color }} />
            <Typography sx={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {s.label} {s.value}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

// ─── Variant / correlation rows (unchanged from prior version) ───────────────

function VariantRow({ row }: { row: ReturnsByVariant }) {
  const pal = useReturnsTheme();

  const returnRateColor =
    row.return_rate_pct > 20 ? pal.rateHigh :
    row.return_rate_pct > 10 ? pal.rateMid  :
    pal.rateOk;

  return (
    <Box sx={{
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
      px: 2,
      py: 1.5,
      borderBottom: `1px solid ${pal.border}`,
      '&:hover': { bgcolor: pal.tileBg },
      alignItems: 'center',
    }}>
      <Box>
        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary }}>
          {row.variant_title ?? 'Unknown product'}
        </Typography>
        {row.sku && (
          <Typography sx={{ fontSize: 11, color: pal.textSecond, fontFamily: 'monospace' }}>
            {row.sku}
          </Typography>
        )}
      </Box>
      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.total_refunds}</Typography>
      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.total_units_returned}</Typography>
      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{fmt(row.revenue_leakage)}</Typography>
      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>
        {row.margin_leakage != null ? fmt(row.margin_leakage) : '—'}
      </Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Chip
          label={`${row.return_rate_pct}%`}
          size="small"
          sx={{ bgcolor: returnRateColor, color: '#fff', fontWeight: 600, fontSize: 11 }}
        />
        <Typography sx={{ fontSize: 11, color: pal.textSecond }}>
          {row.restock_rate_pct}% restocked
        </Typography>
      </Box>
    </Box>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function ReturnsOverviewPage() {
  const pal = useReturnsTheme();
  const navigate = useNavigate();
  const { data, isLoading, isError } = useReturns();
  const correlationQuery = useReturnsCorrelation();
  const correlationRows = correlationQuery.data?.data ?? [];
  const hasCorrelation = correlationRows.length > 0;

  const summary = data?.summary;
  const orphanedJobs: OrphanedReturnJob[] = data?.orphaned_jobs ?? [];
  const byVariant = (data?.by_variant ?? []).sort(
    (a, b) => b.revenue_leakage - a.revenue_leakage
  );

  const criticalOrphans = orphanedJobs.filter(j => j.severity === 'critical');
  const warningOrphans  = orphanedJobs.filter(j => j.severity === 'warning');
  const hasOrphans = orphanedJobs.length > 0;

  const highReturnRateSkus = byVariant.filter(v => v.return_rate_pct >= 20);
  const missingSupplierData = hasCorrelation && correlationRows.every(r => !r.supplier_name);

  const allClear = !hasOrphans && highReturnRateSkus.length === 0;

  const formatAge = (hours: number) => {
    if (hours < 24) return `${Math.round(hours)}h`;
    return `${Math.round(hours / 24)}d`;
  };

  return (
    <Box sx={{ background: pal.pageBg, minHeight: '100%', p: 3 }}>

      {/* HEADER */}
      <Box sx={{ mb: 3 }}>
        <Typography sx={{ fontSize: 22, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>
          Returns
        </Typography>
        <Typography sx={{ fontSize: 13, color: 'var(--ink-3)' }}>
          {isLoading ? '—' : `${summary?.total_refunds ?? 0} total ${summary?.total_refunds === 1 ? 'refund' : 'refunds'} (${summary?.total_units_returned ?? 0} units), resulting in ${fmt(summary?.total_margin_leakage ?? 0)} total margin loss`}
        </Typography>
      </Box>

      {isLoading && (
        <Box sx={{ display: 'flex', justifyContent: 'center', pt: 6 }}>
          <CircularProgress size={24} />
        </Box>
      )}

      {isError && (
        <Alert severity="error" sx={{ mb: 3 }}>
          Failed to load returns data. Please refresh.
        </Alert>
      )}

      {/* EMPTY STATE — no refunds at all */}
      {!isLoading && !isError && summary?.total_refunds === 0 && (
        <Box sx={{ p: 4, textAlign: 'center', background: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: 2 }}>
          <RotateCcw size={32} style={{ marginBottom: 12, opacity: 0.3, color: pal.textSecond }} />
          <Typography sx={{ fontSize: 15, fontWeight: 600, color: pal.textPrimary }}>
            No returns recorded yet
          </Typography>
          <Typography sx={{ fontSize: 13, color: pal.textSecond, mt: 0.5 }}>
            Returns intelligence will appear here as refunds are processed in Shopify.
          </Typography>
        </Box>
      )}

      {summary && summary.total_refunds > 0 && (
        <>
          {/* TRIAGE + PULSE — canonical FT2 layout */}
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.25, alignItems: 'start' }}>

            {/* LEFT — Needs attention */}
            <Box sx={{ flex: '1 0 300px', minWidth: 0, bgcolor: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: '14px', overflow: 'hidden' }}>
              <Box sx={{ px: 2.5, py: 2 }}>
                <Typography sx={{ fontSize: 15, fontWeight: 500, color: pal.textPrimary }}>Needs attention</Typography>
                <Typography sx={{ fontSize: 11, color: pal.textSecond, mt: 0.25 }}>Ranked oldest-first</Typography>
              </Box>

              {criticalOrphans.map(job => (
                <SignalRow
                  key={job.return_job_id}
                  severity="critical"
                  icon={<Clock size={16} />}
                  title={`Refunded ${formatAge(job.hours_since_refund)} ago — item never received`}
                  detail={job.refund_amount > 0 ? `${fmt(job.refund_amount)} refunded, still unclaimed` : 'Unclaimed — no item logged'}
                  cta="Claim"
                  onClick={() => navigate(`/returns/jobs/${job.return_job_id}`)}
                />
              ))}

              {warningOrphans.map(job => (
                <SignalRow
                  key={job.return_job_id}
                  severity="warning"
                  icon={<Clock size={16} />}
                  title={`Refunded ${formatAge(job.hours_since_refund)} ago — awaiting receipt`}
                  detail={job.refund_amount > 0 ? `${fmt(job.refund_amount)} refunded, still unclaimed` : 'Unclaimed — no item logged'}
                  cta="Claim"
                  onClick={() => navigate(`/returns/jobs/${job.return_job_id}`)}
                />
              ))}

              {highReturnRateSkus.length > 0 && (
                <SignalRow
                  severity="warning"
                  icon={<TrendingDown size={16} />}
                  title={`${highReturnRateSkus.length} ${highReturnRateSkus.length === 1 ? 'SKU' : 'SKUs'} with return rate ≥20%`}
                  detail="High return rate may indicate a product, sizing, or quality issue."
                  cta="Review"
                  onClick={() => navigate('/returns')}
                />
              )}

              {allClear && (
                <SignalRow
                  severity="ok"
                  icon={<CheckCircle size={16} />}
                  title="Returns are on track"
                  detail="No aging orphans, no high-return-rate SKUs."
                />
              )}
            </Box>

            {/* RIGHT — Returns Pulse */}
            <Box sx={{ flex: '0 0 300px', bgcolor: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: '14px', p: '18px 20px' }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
                Returns Pulse
              </Typography>

              {/* HEADLINE — margin leakage, colored like Orders' "11 breached" */}
              <Typography sx={{
                fontSize: 26, fontWeight: 700, mt: 0.5,
                color: summary.total_margin_leakage > 0 ? pal.rateHigh : pal.textPrimary,
              }}>
                {fmt(summary.total_margin_leakage)}
              </Typography>
              <Typography sx={{ fontSize: 12, color: pal.textSecond, mb: 1 }}>
                lost to returns this period
              </Typography>

              {/* COMPOSITION — restocked vs pending, out of units returned */}
              <CompositionBar segments={[
                { label: 'Restocked', value: summary.total_units_restocked, color: pal.rateOk },
                { label: 'Pending',   value: Math.max(0, summary.total_units_returned - summary.total_units_restocked), color: pal.rateMid },
              ]} />

              <PulseStat label="Total refunds"    value={String(summary.total_refunds)} />
              <PulseStat label="Revenue refunded" value={fmt(summary.total_revenue_refunded)} />
              <PulseStat label="Restock rate"     value={`${summary.restock_rate_pct}%`} />

              {hasCorrelation && (
                <Box
                  onClick={() => navigate('/returns/suppliers')}
                  sx={{
                    mt: 1.5, display: 'inline-flex', alignItems: 'center',
                    px: 1.25, py: 0.5, fontSize: 11, fontWeight: 600,
                    color: 'var(--accent)', border: '0.5px solid var(--accent)',
                    borderRadius: '6px', cursor: 'pointer',
                    '&:hover': { opacity: 0.75 },
                  }}
                >
                  View suppliers →
                </Box>
              )}
            </Box>
          </Box>

          {/* ZONE — BY PRODUCT */}
          {byVariant.length > 0 && (
            <Box sx={{ mt: 3 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
                By Product — ranked by revenue leakage
              </Typography>

              <Box sx={{ background: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
                  px: 2, py: 1,
                  borderBottom: `1px solid ${pal.border}`,
                  bgcolor: pal.tileBg,
                }}>
                  {['Product', 'Refunds', 'Units', 'Revenue Lost', 'Margin Lost', 'Return Rate'].map(h => (
                    <Typography key={h} sx={{ fontSize: 11, fontWeight: 600, color: pal.textSecond }}>
                      {h}
                    </Typography>
                  ))}
                </Box>
                {byVariant.map(row => (
                  <VariantRow key={row.lasyncro_variant_id} row={row} />
                ))}
              </Box>
            </Box>
          )}

          {/* ZONE — SUPPLIER BATCH CORRELATION */}
          <PlanGate feature="returns.analysis" mode="teased">
          {hasCorrelation && (
            <Box sx={{ mt: 3 }}>
              <Typography sx={{ fontSize: 11, fontWeight: 700, color: pal.textSecond, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5 }}>
                By Supplier — return rate per batch
              </Typography>

              <Box sx={{ background: pal.cardBg, border: `1px solid ${pal.border}`, borderRadius: 2, overflow: 'hidden' }}>
                <Box sx={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr',
                  px: 2, py: 1,
                  borderBottom: `1px solid ${pal.border}`,
                  bgcolor: pal.tileBg,
                }}>
                  {['Product', 'Supplier', 'Batch Received', 'Returned', 'Received', 'Return Rate'].map(h => (
                    <Typography key={h} sx={{ fontSize: 11, fontWeight: 600, color: pal.textSecond }}>{h}</Typography>
                  ))}
                </Box>

                {correlationRows.map((row, i) => {
                  const rateColor =
                    row.return_rate_pct == null  ? undefined :
                    row.return_rate_pct >= 20    ? pal.rateHigh :
                    row.return_rate_pct >= 10    ? pal.rateMid  :
                    pal.rateOk;

                  const batchLabel = row.batch_received_at
                    ? new Date(row.batch_received_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                    : row.receive_job_id ? 'Unknown date' : 'No batch data';

                  return (
                    <Box key={i} sx={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr',
                      px: 2, py: 1.5,
                      borderBottom: `1px solid ${pal.border}`,
                      '&:last-child': { borderBottom: 'none' },
                      '&:hover': { bgcolor: pal.tileBg },
                      alignItems: 'center',
                      borderLeft: row.return_rate_pct != null && row.return_rate_pct >= 20
                        ? `3px solid ${pal.rateHigh}`
                        : '3px solid transparent',
                    }}>
                      <Box>
                        <Typography sx={{ fontSize: 13, fontWeight: 500, color: pal.textPrimary }}>
                          {row.variant_title ?? '—'}
                        </Typography>
                        {row.sku && (
                          <Typography sx={{ fontSize: 11, color: pal.textSecond, fontFamily: 'monospace' }}>
                            {row.sku}
                          </Typography>
                        )}
                      </Box>
                      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.supplier_name ?? 'Unknown supplier'}</Typography>
                      <Typography sx={{ fontSize: 11, color: pal.textSecond }}>{batchLabel}</Typography>
                      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.units_returned}</Typography>
                      <Typography sx={{ fontSize: 13, color: pal.textPrimary }}>{row.units_received}</Typography>
                      <Typography sx={{ fontSize: 13, fontWeight: 600, color: rateColor }}>
                        {row.return_rate_pct != null ? `${row.return_rate_pct}%` : '—'}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>
          )}
          </PlanGate>
        </>
      )}
    </Box>
  );
}