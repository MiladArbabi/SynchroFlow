// apps/mobile/src/screens/IntelligenceScreen.tsx
//
// INTELLIGENCE SCREEN (Mobile)
// ----------------------------
// Owner-only combined intelligence surface.
// Zone 1: Cash Flow — net position hero + key metrics
// Zone 2: Demand — reorder alerts + SKU risk list
//
// Both datasets load in parallel on focus.
// Each zone handles its own error/loading state independently
// so a failure in one does not block the other.
//
// Data:
//   GET /api/v1/modules/cashflow  (Growth tier)
//   GET /api/v1/modules/demand    (Growth tier)

import { useCallback, useState } from 'react';
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

interface CashFlowData {
  summary: CashSummary;
  gross_profit: GrossProfit;
  po_outflows: PoOutflow[];
  computed_at: string;
}

interface DemandSummary {
  total_variants_tracked: number;
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;
  avg_days_of_stock: number | null;
}

interface DemandVariant {
  lasyncro_variant_id: string;
  sku: string;
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}

function cashColor(value: number): string {
  if (value > 0) return colors.success;
  if (value < 0) return colors.error;
  return colors.ink3;
}

function daysLabel(days: number | null): string {
  if (days === null) return 'Unknown';
  if (days === 0) return 'Stockout';
  return `${days}d left`;
}

function statusVariant(status: DemandVariant['reorder_urgency']): 'error' | 'warning' | 'info' {
  if (status === 'critical') return 'error';
  if (status === 'warning') return 'warning';
  return 'info';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ZoneError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.zoneError}>
      <Ionicons name="alert-circle-outline" size={20} color={colors.error} />
      <Text style={styles.zoneErrorText}>{message}</Text>
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
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

function VariantRow({ variant }: { variant: DemandVariant }) {
  const daysLeft = variant.days_of_stock_remaining;
  const velocity = variant.velocity_per_day;
  return (
    <View style={styles.variantRow}>
      <View style={styles.variantTop}>
        <Text style={styles.variantTitle} numberOfLines={1}>{variant.title}</Text>
        <Badge label={daysLabel(daysLeft)} variant={statusVariant(variant.reorder_urgency)} />
      </View>
      <View style={styles.variantBottom}>
        <Text style={styles.variantStat}>{variant.available_quantity} units left</Text>
        {velocity != null && velocity > 0 && (
          <Text style={styles.variantStat}>{velocity.toFixed(1)} sold/day</Text>
        )}
      </View>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function IntelligenceScreen() {
    
  const navigation = useNavigation<any>();

  const [cashFlow, setCashFlow] = useState<CashFlowData | null>(null);
  const [cashLoading, setCashLoading] = useState(true);
  const [cashError, setCashError] = useState<string | null>(null);

  const [demand, setDemand] = useState<DemandData | null>(null);
  const [demandLoading, setDemandLoading] = useState(true);
  const [demandError, setDemandError] = useState<string | null>(null);

  const loadCash = useCallback(async () => {
    setCashLoading(true);
    setCashError(null);
    try {
      const { data } = await apiClient.get('/api/v1/modules/cashflow');
      setCashFlow(data ?? null);
    } catch {
      setCashError('Failed to load cash flow.');
    } finally {
      setCashLoading(false);
    }
  }, []);

  const loadDemand = useCallback(async () => {
    setDemandLoading(true);
    setDemandError(null);
    try {
      const { data } = await apiClient.get('/api/v1/modules/demand');
      setDemand(data ?? null);
    } catch {
      setDemandError('Failed to load demand data.');
    } finally {
      setDemandLoading(false);
    }
  }, []);

  const loadAll = useCallback(() => {
    void loadCash();
    void loadDemand();
  }, [loadCash, loadDemand]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  // Alert variants for demand zone
  const alertVariants = demand?.variants.filter(v => v.reorder_urgency === 'critical' || v.reorder_urgency === 'warning') ?? [];

  return (
    <Screen>
     <AppHeader showLogo onRefresh={loadAll} rightAction={{ icon: 'notifications-outline', onPress: () => navigation.getParent()?.navigate('AlertsInbox') }} />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* ── ZONE 1: CASH FLOW ─────────────────────────────── */}
        <Text style={styles.zoneHeading}>Cash Flow</Text>

        {cashLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.lg }} />
        ) : cashError ? (
          <ZoneError message={cashError} onRetry={loadCash} />
        ) : !cashFlow ? null : (
          <>
            {/* Net position hero */}
            <Card style={styles.heroCard}>
              <Text style={styles.heroLabel}>Net Cash Position</Text>
              <Text style={[styles.heroValue, { color: cashColor(cashFlow.summary.net_cash_position) }]}>
                {formatCurrency(cashFlow.summary.net_cash_position)}
              </Text>
              {cashFlow.summary.at_risk_revenue > 0 && (
                <View style={styles.atRiskRow}>
                  <Ionicons name="warning-outline" size={14} color={colors.error} />
                  <Text style={styles.atRiskText}>
                    {formatCurrency(cashFlow.summary.at_risk_revenue)} at risk
                  </Text>
                </View>
              )}
            </Card>

            {/* Key metrics */}
            <Card>
              <StatRow label="Realized Revenue" value={formatCurrency(cashFlow.summary.realized_revenue)} />
              <StatRow label="Pending Revenue" value={formatCurrency(cashFlow.summary.pending_revenue)} />
              {cashFlow.gross_profit.gross_margin_pct != null && (
                <StatRow
                  label="Gross Margin"
                  value={`${cashFlow.gross_profit.gross_margin_pct.toFixed(1)}%`}
                  accent={cashFlow.gross_profit.gross_margin_pct >= 40 ? colors.success : colors.warning}
                />
              )}
              {cashFlow.summary.working_capital_locked > 0 && (
                <StatRow
                  label="Locked in Inventory"
                  value={formatCurrency(cashFlow.summary.working_capital_locked)}
                  accent={colors.warning}
                />
              )}
            </Card>

            {/* Upcoming PO outflows */}
            {cashFlow.po_outflows.length > 0 && (
              <Card>
                <Text style={styles.sectionLabel}>Upcoming PO Outflows</Text>
                {cashFlow.po_outflows.map(po => (
                  <View key={po.po_id} style={styles.poRow}>
                    <View style={styles.poLeft}>
                      <Text style={styles.poSupplier} numberOfLines={1}>{po.supplier_name}</Text>
                      <Text style={[
                        styles.poDate,
                        new Date(po.expected_delivery_date) < new Date() && { color: colors.error }
                      ]}>
                        {new Date(po.expected_delivery_date) < new Date() ? 'Overdue · ' : ''}
                        {formatDate(po.expected_delivery_date)}
                      </Text>
                    </View>
                    <Text style={styles.poCost}>{formatCurrency(po.total_cost)}</Text>
                  </View>
                ))}
              </Card>
            )}
          </>
        )}

        {/* ── ZONE 2: DEMAND ────────────────────────────────── */}
        <Text style={[styles.zoneHeading, { marginTop: spacing.lg }]}>Demand</Text>

        {demandLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.lg }} />
        ) : demandError ? (
          <ZoneError message={demandError} onRetry={loadDemand} />
        ) : !demand ? null : (
          <>
            <View style={styles.demandStatus}>
              <Text style={styles.demandStatusText}>
                {demand.summary.total_variants_tracked} SKUs monitored
                {demand.summary.critical_reorder_count > 0
                  ? ` · ${demand.summary.critical_reorder_count} critical`
                  : demand.summary.warning_reorder_count > 0
                  ? ` · ${demand.summary.warning_reorder_count} need attention`
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
                <Text style={styles.sectionLabel}>
                  {demand.summary.critical_reorder_count > 0 ? '⚠️ Reorder alerts' : 'Watch list'}
                </Text>
                {alertVariants.map(v => <VariantRow key={v.lasyncro_variant_id} variant={v} />)}
              </Card>
            )}

            {demand.summary.avg_days_of_stock != null && (
              <Text style={styles.computedAt}>
                Avg {demand.summary.avg_days_of_stock.toFixed(1)}d stock · Updated{' '}
                {new Date(demand.computed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            )}
          </>
        )}

      </ScrollView>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  zoneHeading: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  heroCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  heroLabel: { color: colors.ink3, fontSize: font.size.sm },
  heroValue: { fontSize: 40, fontWeight: font.weight.bold },
  atRiskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  atRiskText: { color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },
  sectionLabel: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: spacing.sm },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.rule },
  statLabel: { color: colors.ink3, fontSize: font.size.sm },
  statValue: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  poRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  poLeft: { flex: 1, marginRight: spacing.sm },
  poSupplier: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  poDate: { color: colors.ink4, fontSize: font.size.xs },
  poCost: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  allClearCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  allClearText: { color: colors.ink3, fontSize: font.size.sm },
  zoneError: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md, backgroundColor: colors.error + '12', borderRadius: radius.md },
  zoneErrorText: { color: colors.error, fontSize: font.size.sm, flex: 1 },
  retryText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  computedAt: { color: colors.ink4, fontSize: font.size.xs, textAlign: 'center' },
  variantRow: { paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule, gap: spacing.xs },
  variantTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  variantBottom: { flexDirection: 'row', gap: spacing.md },
  variantTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, flex: 1 },
  variantStat: { color: colors.ink4, fontSize: font.size.xs },
  demandStatus: { paddingVertical: spacing.xs },
  demandStatusText: { color: colors.ink3, fontSize: font.size.sm },
});