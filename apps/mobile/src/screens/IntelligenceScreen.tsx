// apps/mobile/src/screens/IntelligenceScreen.tsx
//
// INTELLIGENCE SCREEN (Mobile)
// ----------------------------
// Owner-only intelligence surface with segmented control.
// Four modules, one tab — swipe or tap to navigate between them.
//
// Segments:
//   Cash Flow — net position, PO outflows, runway
//   Demand    — reorder alerts, SKU risk
//   Finances  — blended margin, margin destroyers
//   Returns   — return rate, supplier batch correlation
//
// Data loads lazily per segment on first activation,
// then refreshes on focus or manual pull.

import { useCallback, useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, AppHeader, Card, Badge } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

// ─── Segment definition ──────────────────────────────────────────────────────

type Segment = 'cashflow' | 'demand' | 'finances' | 'returns';

const SEGMENTS: { key: Segment; label: string }[] = [
  { key: 'cashflow',  label: 'Cash Flow' },
  { key: 'demand',    label: 'Demand' },
  { key: 'finances',  label: 'Finances' },
  { key: 'returns',   label: 'Returns' },
];

// ─── Types ───────────────────────────────────────────────────────────────────

interface CashSummary {
  realized_revenue: number;
  pending_revenue: number;
  at_risk_revenue: number;
  net_cash_position: number;
  working_capital_locked: number;
}
interface GrossProfit {
  gross_revenue: number;
  total_cogs: number;
  gross_profit: number;
  gross_margin_pct: number | null;
}
interface PoOutflow {
  po_id: string;
  supplier_name: string;
  expected_delivery_date: string;
  total_cost: number;
}
interface ProjectionWeek {
  week: string;
  conservative: number;
  base: number;
  optimistic: number;
}
interface CashFlowData {
  summary: CashSummary;
  gross_profit: GrossProfit;
  po_outflows: PoOutflow[];
  projection_60d: ProjectionWeek[];
  computed_at: string;
}

interface DemandSummary {
  total_variants_tracked: number;
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;
  avg_days_of_stock: number | null;
  total_inventory_value: number;
}
interface DemandVariant {
  lasyncro_variant_id: string;
  sku: string | null;
  title: string;
  days_of_stock_remaining: number | null;
  reorder_urgency: 'critical' | 'warning' | 'healthy' | 'overstocked' | 'no_velocity';
  available_quantity: number;
  velocity_per_day: number | null;
}
interface DemandData {
  summary: DemandSummary;
  variants: DemandVariant[];
  computed_at: string;
}

interface SkuMargin {
  lasyncro_variant_id: string;
  sku: string | null;
  title: string;
  total_units_sold: number;
  gross_revenue: number;
  estimated_cost: number;
  gross_margin: number;
  margin_pct: number;
}

interface ReturnCorrelation {
  lasyncro_variant_id: string;
  sku: string | null;
  variant_title: string | null;
  supplier_id: number | null;
  supplier_name: string | null;
  receive_job_id: string | null;
  batch_received_at: string | null;
  units_sold: number;
  units_returned: number;
  return_rate_pct: number | null;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MARGIN_TARGET = 40;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}
function cashColor(v: number) { return v > 0 ? colors.success : v < 0 ? colors.error : colors.ink3; }
function marginColor(pct: number) { return pct >= MARGIN_TARGET ? colors.success : pct >= MARGIN_TARGET * 0.75 ? colors.warning : colors.error; }
function returnRateColor(pct: number) { return pct >= 20 ? colors.error : pct >= 10 ? colors.warning : colors.success; }
function daysLabel(days: number | null) { if (days === null) return 'Unknown'; if (days === 0) return 'Stockout'; return `${days}d left`; }
function statusVariant(s: DemandVariant['reorder_urgency']): 'error' | 'warning' | 'info' { return s === 'critical' ? 'error' : s === 'warning' ? 'warning' : 'info'; }
function formatDate(iso: string) { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }); }

// ─── Shared sub-components ───────────────────────────────────────────────────

function ZoneError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.zoneError}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
      <Text style={styles.zoneErrorText}>{message}</Text>
      <TouchableOpacity onPress={onRetry}><Text style={styles.retryText}>Retry</Text></TouchableOpacity>
    </View>
  );
}

function StatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent ? { color: accent } : undefined]}>{value}</Text>
    </View>
  );
}

// ─── Inline chart components ─────────────────────────────────────────────────

function MiniBarChart({ values, labels, color, height = 80 }: {
  values: number[];
  labels: string[];
  color: string;
  height?: number;
}) {
  if (values.length === 0 || values.every(v => v === 0)) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.ink4, fontSize: font.size.xs }}>No data yet</Text>
      </View>
    );
  }
  const max = Math.max(...values);
  return (
    <View style={{ height: height + 20 }}>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        {values.map((v, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{
              width: '80%',
              height: max > 0 ? Math.max(3, (v / max) * height) : 3,
              backgroundColor: v === max ? color : color + '66',
              borderRadius: 3,
            }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        {labels.map((l, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: colors.ink4 }} numberOfLines={1}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}

function MiniSparkline({ values, color, height = 60 }: {
  values: number[];
  color: string;
  height?: number;
}) {
  if (values.length < 2 || values.every(v => v === 0)) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.ink4, fontSize: font.size.xs }}>No trend data yet</Text>
      </View>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 280;
  const stepX = width / (values.length - 1);

  const points = values.map((v, i) => ({
    x: i * stepX,
    y: height - ((v - min) / range) * (height - 8) - 4,
  }));

  return (
    <View style={{ height, width: '100%' }}>
      {points.slice(0, -1).map((p, i) => {
        const next = points[i + 1];
        const dx = next.x - p.x;
        const dy = next.y - p.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View key={i} style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: len,
            height: 2,
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ rotate: `${angle}deg` }],
            transformOrigin: '0 50%',
          }} />
        );
      })}
      {points.map((p, i) => (
        <View key={i} style={{
          position: 'absolute',
          left: p.x - 3,
          top: p.y - 3,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }} />
      ))}
    </View>
  );
}

function HorizontalBar({ label, value, max, threshold, color }: {
  label: string;
  value: number;
  max: number;
  threshold?: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const thresholdPct = threshold && max > 0 ? Math.min(1, threshold / max) : null;
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: colors.ink, fontSize: font.size.xs, fontWeight: font.weight.semibold }} numberOfLines={1}>{label}</Text>
        <Text style={{ color, fontSize: font.size.xs, fontWeight: font.weight.bold }}>{value}d</Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.bg2, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: 8, width: `${pct * 100}%`, backgroundColor: color, borderRadius: 4 }} />
        {thresholdPct !== null && (
          <View style={{
            position: 'absolute', left: `${thresholdPct * 100}%`,
            top: 0, width: 2, height: 8, backgroundColor: colors.error,
          }} />
        )}
      </View>
    </View>
  );
}

function ReturnRateBar({ rate, threshold = 10 }: { rate: number; threshold?: number }) {
  const cappedRate = Math.min(rate, 100);
  const color = rate >= 20 ? colors.error : rate >= threshold ? colors.warning : colors.success;
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.ink3, fontSize: font.size.xs }}>0%</Text>
        <Text style={{ color: colors.ink4, fontSize: font.size.xs }}>Healthy threshold: {threshold}%</Text>
        <Text style={{ color: colors.ink3, fontSize: font.size.xs }}>100%</Text>
      </View>
      <View style={{ height: 12, backgroundColor: colors.bg2, borderRadius: 6, overflow: 'hidden' }}>
        <View style={{ height: 12, width: `${cappedRate}%`, backgroundColor: color, borderRadius: 6 }} />
        <View style={{
          position: 'absolute', left: `${threshold}%`,
          top: 0, width: 2, height: 12, backgroundColor: colors.ink3,
        }} />
      </View>
      <Text style={{ color, fontSize: font.size.xs, fontWeight: font.weight.semibold, textAlign: 'center' }}>
        {rate.toFixed(1)}% return rate{rate > threshold ? ` — ${(rate - threshold).toFixed(1)}% above threshold` : ' — within healthy range'}
      </Text>
    </View>
  );
}

// ─── Segment views ───────────────────────────────────────────────────────────

function CashFlowView({ data, loading, error, onRetry }: { data: CashFlowData | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  if (error) return <ZoneError message={error} onRetry={onRetry} />;
  if (!data) return null;
  return (
    <>
      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>Net Cash Position</Text>
        <Text style={[styles.heroValue, { color: cashColor(data.summary.net_cash_position) }]}>
          {formatCurrency(data.summary.net_cash_position)}
        </Text>
        {data.summary.at_risk_revenue > 0 && (
          <View style={styles.heroAlertRow}>
            <Ionicons name="warning-outline" size={13} color={colors.error} />
            <Text style={styles.heroAlertText}>{formatCurrency(data.summary.at_risk_revenue)} at risk</Text>
          </View>
        )}
      </Card>
      <Card>
        <StatRow label="Realized Revenue" value={formatCurrency(data.summary.realized_revenue)} />
        <StatRow label="Pending Revenue" value={formatCurrency(data.summary.pending_revenue)} />
        {data.gross_profit.gross_margin_pct != null && (
          <StatRow
            label="Gross Margin"
            value={`${Number(data.gross_profit.gross_margin_pct).toFixed(1)}%`}
            accent={Number(data.gross_profit.gross_margin_pct) >= 40 ? colors.success : colors.warning}
          />
        )}
        {data.summary.working_capital_locked > 0 && (
          <StatRow label="Locked in Inventory" value={formatCurrency(data.summary.working_capital_locked)} accent={colors.warning} />
        )}
      </Card>
      {data.po_outflows.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>Upcoming PO Outflows</Text>
          {data.po_outflows.map(po => (
            <View key={po.po_id} style={styles.poRow}>
              <View style={styles.poLeft}>
                <Text style={styles.poSupplier} numberOfLines={1}>{po.supplier_name}</Text>
                <Text style={[styles.poDate, new Date(po.expected_delivery_date) < new Date() && { color: colors.error }]}>
                  {new Date(po.expected_delivery_date) < new Date() ? 'Overdue · ' : ''}{formatDate(po.expected_delivery_date)}
                </Text>
              </View>
              <Text style={styles.poCost}>{formatCurrency(po.total_cost)}</Text>
            </View>
          ))}
        </Card>
      )}
      {data.projection_60d?.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>60-day runway</Text>
          <Text style={styles.sectionSubtitle}>Projected weekly cash position (base scenario)</Text>
          <MiniSparkline
            values={data.projection_60d.map(w => Number(w.base))}
            color={cashColor(data.summary.net_cash_position)}
          />
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.xs }}>
            <Text style={{ color: colors.ink4, fontSize: 9 }}>Now</Text>
            <Text style={{ color: colors.ink4, fontSize: 9 }}>+60 days</Text>
          </View>
        </Card>
      )}
    </>
  );
}

function DemandView({ data, loading, error, onRetry }: { data: DemandData | null; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  if (error) return <ZoneError message={error} onRetry={onRetry} />;
  if (!data) return null;
  const alertVariants = data.variants.filter(v => v.reorder_urgency === 'critical' || v.reorder_urgency === 'warning');
  return (
    <>
      <View style={styles.statusLine}>
        <Text style={styles.statusText}>
          {data.summary.total_variants_tracked} SKUs monitored
          {data.summary.critical_reorder_count > 0
            ? ` · ${data.summary.critical_reorder_count} critical`
            : data.summary.warning_reorder_count > 0
            ? ` · ${data.summary.warning_reorder_count} need attention`
            : ' · all healthy'}
        </Text>
      </View>
      {alertVariants.length === 0 ? (
        <Card style={styles.allClearCard}>
          <Ionicons name="checkmark-circle-outline" size={32} color={colors.success} />
          <Text style={styles.allClearText}>No reorder alerts</Text>
        </Card>
      ) : (
        <Card>
          <Text style={styles.sectionTitle}>
            {data.summary.critical_reorder_count > 0 ? '⚠️ Reorder alerts' : 'Watch list'}
          </Text>
          {alertVariants.map(v => (
            <View key={v.lasyncro_variant_id} style={styles.variantRow}>
              <View style={styles.variantTop}>
                <Text style={styles.variantTitle} numberOfLines={1}>{v.title}</Text>
                <Badge label={daysLabel(v.days_of_stock_remaining)} variant={statusVariant(v.reorder_urgency)} />
              </View>
              <View style={styles.variantBottom}>
                <Text style={styles.variantStat}>{v.available_quantity} units left</Text>
                {v.velocity_per_day != null && v.velocity_per_day > 0 && (
                  <Text style={styles.variantStat}>{v.velocity_per_day.toFixed(1)} sold/day</Text>
                )}
              </View>
            </View>
          ))}
        </Card>
      )}
      {data.variants.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>Days of stock</Text>
          <Text style={styles.sectionSubtitle}>Red line = 14-day reorder threshold</Text>
          {data.variants
            .filter(v => v.reorder_urgency !== 'no_velocity')
            .slice(0, 6)
            .map(v => (
              <HorizontalBar
                key={v.lasyncro_variant_id}
                label={v.sku ?? v.title}
                value={v.days_of_stock_remaining ?? 0}
                max={Math.max(30, ...data.variants.map(x => x.days_of_stock_remaining ?? 0))}
                threshold={14}
                color={v.reorder_urgency === 'critical' ? colors.error : v.reorder_urgency === 'warning' ? colors.warning : colors.success}
              />
            ))}
        </Card>
      )}
      {(data.summary.avg_days_of_stock != null || data.summary.total_inventory_value > 0) && (
        <Card>
          {data.summary.total_inventory_value > 0 && (
            <StatRow label="Inventory value" value={formatCurrency(data.summary.total_inventory_value)} />
          )}
          {data.summary.avg_days_of_stock != null && (
            <StatRow label="Avg days of stock" value={`${data.summary.avg_days_of_stock.toFixed(1)}d`} />
          )}
          <Text style={[styles.computedAt, { textAlign: 'left', marginTop: spacing.xs }]}>
            Updated {new Date(data.computed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
          </Text>
        </Card>
      )}
      
    </>
  );
}

function FinancesView({ data, loading, error, onRetry }: { data: SkuMargin[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  if (error) return <ZoneError message={error} onRetry={onRetry} />;

  const totalRevenue = data.reduce((s, r) => s + Number(r.gross_revenue), 0);
  const totalMargin = data.reduce((s, r) => s + Number(r.gross_margin), 0);
  const blended = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : null;
  const destroyers = [...data].filter(s => Number(s.margin_pct) < MARGIN_TARGET)
    .sort((a, b) => (MARGIN_TARGET - Number(b.margin_pct)) * b.total_units_sold - (MARGIN_TARGET - Number(a.margin_pct)) * a.total_units_sold)
    .slice(0, 3);

  return (
    <>
      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>Blended Margin</Text>
        {blended !== null ? (
          <>
            <Text style={[styles.heroValue, { color: marginColor(blended) }]}>{blended.toFixed(1)}%</Text>
            <Text style={styles.heroTarget}>Target: {MARGIN_TARGET}%</Text>
            {blended < MARGIN_TARGET && (
              <View style={styles.heroAlertRow}>
                <Ionicons name="arrow-down-outline" size={13} color={colors.error} />
                <Text style={styles.heroAlertText}>{(MARGIN_TARGET - blended).toFixed(1)}% below target</Text>
              </View>
            )}
          </>
        ) : (
          <Text style={styles.emptyText}>No margin data yet</Text>
        )}
      </Card>
      {destroyers.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>⚠️ Margin destroyers</Text>
          <Text style={styles.sectionSubtitle}>Ranked by revenue impact</Text>
          {destroyers.map((sku, i) => (
            <View key={sku.lasyncro_variant_id} style={styles.skuRow}>
              <View style={styles.skuRank}><Text style={styles.skuRankText}>{i + 1}</Text></View>
              <View style={styles.skuMeta}>
                <Text style={styles.variantTitle} numberOfLines={1}>{sku.title}</Text>
                <Text style={styles.variantStat}>{sku.total_units_sold} units · {formatCurrency(sku.gross_revenue)}</Text>
              </View>
              <View style={styles.skuMarginBlock}>
                <Text style={[styles.skuMarginPct, { color: marginColor(Number(sku.margin_pct)) }]}>{Number(sku.margin_pct).toFixed(1)}%</Text>
                <Text style={styles.variantStat}>{formatCurrency(sku.gross_margin)}</Text>
              </View>
            </View>
          ))}
        </Card>
      )}
      {data.length > 0 && (() => {
        const star = [...data].sort((a, b) => Number(b.margin_pct) - Number(a.margin_pct))[0];
        return star && Number(star.margin_pct) >= MARGIN_TARGET ? (
          <Card>
            <Text style={styles.sectionTitle}>⭐ Top performer</Text>
            <View style={styles.skuRow}>
              <View style={styles.skuMeta}>
                <Text style={styles.variantTitle} numberOfLines={1}>{star.title}</Text>
                <Text style={styles.variantStat}>{star.total_units_sold} units · {formatCurrency(Number(star.gross_revenue))}</Text>
              </View>
              <View style={styles.skuMarginBlock}>
                <Text style={[styles.skuMarginPct, { color: colors.success }]}>{Number(star.margin_pct).toFixed(1)}%</Text>
                <Text style={styles.variantStat}>{formatCurrency(Number(star.gross_margin))}</Text>
              </View>
            </View>
          </Card>
        ) : null;
      })()}

      {data.length > 0 && (() => {
        const sorted = [...data].sort((a, b) => Number(a.margin_pct) - Number(b.margin_pct));
        const worst = sorted.slice(0, 5);
        const best = sorted[sorted.length - 1];
        const display = worst.some(s => s.lasyncro_variant_id === best.lasyncro_variant_id)
          ? worst : [...worst, best];
        const remaining = data.length - display.length;
        return (
          <Card>
            <Text style={styles.sectionTitle}>Margin by SKU</Text>
            <Text style={styles.sectionSubtitle}>vs {MARGIN_TARGET}% target · worst first</Text>
            <MiniBarChart
              values={display.map(s => Number(s.margin_pct))}
              labels={display.map(s => (s.sku ?? s.title).slice(0, 8))}
              color={colors.accent}
            />
            {remaining > 0 && (
              <Text style={{ color: colors.ink4, fontSize: font.size.xs, marginTop: spacing.xs }}>
                +{remaining} more SKUs not shown
              </Text>
            )}
          </Card>
        );
      })()}
    </>
  );
}

function ReturnsView({ data, loading, error, onRetry }: { data: ReturnCorrelation[]; loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading) return <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />;
  if (error) return <ZoneError message={error} onRetry={onRetry} />;

  const totalReturned = data.reduce((s, r) => s + Number(r.units_returned), 0);
  const totalSold = data.reduce((s, r) => s + Number(r.units_sold), 0);
  const overallRate = totalSold > 0 ? (totalReturned / totalSold) * 100 : null;
  const avgRate = data.length > 0 ? data.reduce((s, r) => s + Number(r.return_rate_pct ?? 0), 0) / data.length : 0;

  const supplierMap = new Map<string, { name: string; returned: number; sold: number }>();
  for (const row of data) {
    if (!row.supplier_name) continue;
    const e = supplierMap.get(row.supplier_name) ?? { name: row.supplier_name, returned: 0, sold: 0 };
    e.returned += row.units_returned; e.sold += row.units_sold;
    supplierMap.set(row.supplier_name, e);
  }
  const suppliers = Array.from(supplierMap.values())
    .map(s => ({ ...s, rate: s.sold > 0 ? (s.returned / s.sold) * 100 : 0 }))
    .sort((a, b) => b.rate - a.rate);

  if (data.length === 0) {
    return (
      <Card style={styles.allClearCard}>
        <Ionicons name="checkmark-circle-outline" size={32} color={colors.success} />
        <Text style={styles.allClearText}>No return data yet</Text>
      </Card>
    );
  }

  return (
    <>
      <Card style={styles.heroCard}>
        <Text style={styles.heroLabel}>Overall Return Rate</Text>
        {overallRate !== null ? (
          <>
            <Text style={[styles.heroValue, { color: returnRateColor(overallRate) }]}>{overallRate.toFixed(1)}%</Text>
            <Text style={styles.heroTarget}>{totalReturned} of {totalSold} units returned</Text>
            {overallRate >= 10 && (
              <View style={styles.heroAlertRow}>
                <Ionicons name="warning-outline" size={13} color={colors.error} />
                <Text style={styles.heroAlertText}>Above healthy threshold (10%)</Text>
              </View>
            )}
          </>
        ) : null}
      </Card>
      {overallRate !== null && (
        <Card>
          <Text style={styles.sectionTitle}>Return rate health</Text>
          <ReturnRateBar rate={overallRate} />
        </Card>
      )}
      {totalReturned > 0 && (
        <Card>
          <StatRow label="Units returned this period" value={`${totalReturned} of ${totalSold} sold`} />
          <StatRow
            label="Return rate impact"
            value={overallRate !== null ? `${overallRate.toFixed(1)}% of revenue at risk` : '—'}
            accent={overallRate !== null && overallRate >= 10 ? colors.error : colors.warning}
          />
        </Card>
      )}
      {suppliers.length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>By supplier</Text>
          {suppliers.map(s => (
            <View key={s.name} style={styles.poRow}>
              <View style={styles.poLeft}>
                <Text style={styles.poSupplier} numberOfLines={1}>{s.name}</Text>
                <Text style={styles.poDate}>{s.returned} of {s.sold} returned</Text>
              </View>
              <Text style={[styles.poCost, { color: returnRateColor(s.rate) }]}>{s.rate.toFixed(1)}%</Text>
            </View>
          ))}
        </Card>
      )}
      {data.filter(r => (Number(r.return_rate_pct ?? 0)) >= Math.max(15, avgRate * 1.5)).length > 0 && (
        <Card>
          <Text style={styles.sectionTitle}>⚠️ Suspect batches</Text>
          {data.filter(r => (Number(r.return_rate_pct ?? 0)) >= Math.max(15, avgRate * 1.5)).map(row => (
            <View key={`${row.lasyncro_variant_id}-${row.receive_job_id ?? 'x'}`} style={styles.variantRow}>
              <View style={styles.variantTop}>
                <Text style={styles.variantTitle} numberOfLines={1}>{row.variant_title ?? row.sku ?? 'Unknown'}</Text>
                <Text style={[styles.skuMarginPct, { color: returnRateColor(row.return_rate_pct ?? 0) }]}>
                  {(row.return_rate_pct ?? 0).toFixed(1)}%
                </Text>
              </View>
              {row.supplier_name && (
                <Text style={styles.variantStat}>{row.supplier_name}{row.batch_received_at ? ` · ${formatDate(row.batch_received_at)}` : ''}</Text>
              )}
            </View>
          ))}
        </Card>
      )}
    </>
  );
}

// ─── Main Screen ─────────────────────────────────────────────────────────────

export default function IntelligenceScreen() {
  const navigation = useNavigation<any>();
  const [activeSegment, setActiveSegment] = useState<Segment>('cashflow');

  // Per-segment data state
  const [cashFlow, setCashFlow] = useState<CashFlowData | null>(null);
  const [cashLoading, setCashLoading] = useState(false);
  const [cashError, setCashError] = useState<string | null>(null);

  const [demand, setDemand] = useState<DemandData | null>(null);
  const [demandLoading, setDemandLoading] = useState(false);
  const [demandError, setDemandError] = useState<string | null>(null);

  const [finances, setFinances] = useState<SkuMargin[]>([]);
  const [financesLoading, setFinancesLoading] = useState(false);
  const [financesError, setFinancesError] = useState<string | null>(null);

  const [returns, setReturns] = useState<ReturnCorrelation[]>([]);
  const [returnsLoading, setReturnsLoading] = useState(false);
  const [returnsError, setReturnsError] = useState<string | null>(null);

  // Track which segments have been loaded
  const loaded = useRef<Set<Segment>>(new Set());

  const loadCash = useCallback(async () => {
    setCashLoading(true); setCashError(null);
    try { const { data } = await apiClient.get('/api/v1/modules/cashflow'); setCashFlow(data ?? null); }
    catch { setCashError('Failed to load cash flow.'); }
    finally { setCashLoading(false); }
  }, []);

  const loadDemand = useCallback(async () => {
    setDemandLoading(true); setDemandError(null);
    try { const { data } = await apiClient.get('/api/v1/modules/demand'); setDemand(data ?? null); }
    catch { setDemandError('Failed to load demand data.'); }
    finally { setDemandLoading(false); }
  }, []);

  const loadFinances = useCallback(async () => {
    setFinancesLoading(true); setFinancesError(null);
    try { const { data } = await apiClient.get('/api/v1/modules/finances/margin/sku?limit=20&order=asc'); setFinances(data.data ?? []); }
    catch { setFinancesError('Failed to load margin data.'); }
    finally { setFinancesLoading(false); }
  }, []);

  const loadReturns = useCallback(async () => {
    setReturnsLoading(true); setReturnsError(null);
    try { const { data } = await apiClient.get('/api/v1/modules/returns/correlation'); setReturns(data.data ?? []); }
    catch { setReturnsError('Failed to load returns data.'); }
    finally { setReturnsLoading(false); }
  }, []);

  // Load active segment on focus, lazy-load others
  const loadSegment = useCallback((seg: Segment) => {
    if (seg === 'cashflow') void loadCash();
    if (seg === 'demand') void loadDemand();
    if (seg === 'finances') void loadFinances();
    if (seg === 'returns') void loadReturns();
    loaded.current.add(seg);
  }, [loadCash, loadDemand, loadFinances, loadReturns]);

  const handleSegmentChange = useCallback((seg: Segment) => {
    setActiveSegment(seg);
    if (!loaded.current.has(seg)) loadSegment(seg);
  }, [loadSegment]);

  const handleRefresh = useCallback(() => {
    loadSegment(activeSegment);
  }, [activeSegment, loadSegment]);

  useFocusEffect(useCallback(() => {
    loaded.current.clear();
    loadSegment('cashflow');
    setActiveSegment('cashflow');
  }, [loadSegment]));

  return (
    <Screen>
      <AppHeader
        showLogo
        onRefresh={handleRefresh}
        rightAction={{ icon: 'notifications-outline', onPress: () => navigation.getParent()?.navigate('AlertsInbox') }}
      />

      {/* ── Segmented control ────────────────────────────────── */}
      <View style={styles.segmentBar}>
        {SEGMENTS.map(seg => (
          <TouchableOpacity
            key={seg.key}
            style={[styles.segmentBtn, activeSegment === seg.key && styles.segmentBtnActive]}
            onPress={() => handleSegmentChange(seg.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.segmentLabel, activeSegment === seg.key && styles.segmentLabelActive]}>
              {seg.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ── Segment content ──────────────────────────────────── */}
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {activeSegment === 'cashflow' && (
          <CashFlowView data={cashFlow} loading={cashLoading} error={cashError} onRetry={loadCash} />
        )}
        {activeSegment === 'demand' && (
          <DemandView data={demand} loading={demandLoading} error={demandError} onRetry={loadDemand} />
        )}
        {activeSegment === 'finances' && (
          <FinancesView data={finances} loading={financesLoading} error={financesError} onRetry={loadFinances} />
        )}
        {activeSegment === 'returns' && (
          <ReturnsView data={returns} loading={returnsLoading} error={returnsError} onRetry={loadReturns} />
        )}
      </ScrollView>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  // Segment control
  segmentBar: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  segmentBtn: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.bg2,
    justifyContent: 'center',
  },
  segmentBtnActive: {
    backgroundColor: colors.accent,
  },
  segmentLabel: {
    fontSize: font.size.xs,
    fontWeight: font.weight.medium,
    color: colors.ink3,
  },
  segmentLabelActive: {
    color: colors.bg,
    fontWeight: font.weight.bold,
  },

  // Content
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },

  // Hero card
  heroCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  heroLabel: { color: colors.ink3, fontSize: font.size.sm },
  heroValue: { fontSize: 44, fontWeight: font.weight.bold, lineHeight: 52 },
  heroTarget: { color: colors.ink4, fontSize: font.size.xs },
  heroAlertRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: spacing.xs },
  heroAlertText: { color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },

  // Shared section
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: 2 },
  sectionSubtitle: { color: colors.ink4, fontSize: font.size.xs, marginBottom: spacing.sm },

  // Stat row
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.rule },
  statLabel: { color: colors.ink3, fontSize: font.size.sm },
  statValue: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },

  // PO / supplier rows
  poRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  poLeft: { flex: 1, marginRight: spacing.sm },
  poSupplier: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  poDate: { color: colors.ink4, fontSize: font.size.xs },
  poCost: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },

  // Demand variant rows
  variantRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule, gap: spacing.xs },
  variantTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  variantTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, flex: 1, marginRight: spacing.sm },
  variantBottom: { flexDirection: 'row', gap: spacing.md },
  variantStat: { color: colors.ink4, fontSize: font.size.xs },

  // SKU margin rows
  skuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule, gap: spacing.sm },
  skuRank: { width: 22, height: 22, borderRadius: 11, backgroundColor: colors.bg2, alignItems: 'center', justifyContent: 'center' },
  skuRankText: { color: colors.ink3, fontSize: 10, fontWeight: font.weight.bold },
  skuMeta: { flex: 1 },
  skuMarginBlock: { alignItems: 'flex-end' },
  skuMarginPct: { fontSize: font.size.md, fontWeight: font.weight.bold },

  // Status line
  statusLine: { paddingVertical: spacing.xs },
  statusText: { color: colors.ink3, fontSize: font.size.sm },

  // All clear / empty
  allClearCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  allClearText: { color: colors.ink3, fontSize: font.size.sm },
  emptyText: { color: colors.ink3, fontSize: font.size.md },

  // Computed at
  computedAt: { color: colors.ink4, fontSize: font.size.xs, textAlign: 'center' },

  // Zone error
  zoneError: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.error + '12', borderRadius: radius.md },
  zoneErrorText: { color: colors.error, fontSize: font.size.sm, flex: 1 },
  retryText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.semibold },
});