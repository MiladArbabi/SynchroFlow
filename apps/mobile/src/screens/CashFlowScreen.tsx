// apps/mobile/src/screens/CashFlowScreen.tsx
//
// CASH FLOW SCREEN (Mobile)
// -------------------------
// Single-number view of net cash position with color coding.
// Shows gross profit summary, revenue buckets, and upcoming PO outflows.
//
// Data: GET /api/v1/modules/cashflow (Growth tier)
// Refreshes on every focus event.

import { useCallback, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, AppHeader, Card } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

// ─── Types ───────────────────────────────────────────────────────────────────

interface CashSummary {
  realized_revenue: number;
  pending_revenue: number;
  at_risk_revenue: number;
  total_refunded: number;
  inventory_value: number;
  net_cash_position: number;
  working_capital_locked: number;
}

interface GrossProfit {
  gross_revenue: number;
  total_cogs: number;
  gross_profit: number;
  gross_margin_pct: number | null;
}

interface CashBucket {
  label: string;
  orders: number;
  revenue: number;
  description: string;
}

interface PoOutflow {
  po_id: string;
  supplier_name: string;
  expected_delivery_date: string;
  total_cost: number;
  status: string;
}

interface CashFlowData {
  summary: CashSummary;
  gross_profit: GrossProfit;
  buckets: CashBucket[];
  po_outflows: PoOutflow[];
  computed_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}

function cashPositionColor(value: number): string {
  if (value > 0) return colors.success;
  if (value < 0) return colors.error;
  return colors.ink3;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent ? { color: accent } : undefined]}>{value}</Text>
    </View>
  );
}

function BucketRow({ bucket }: { bucket: CashBucket }) {
  return (
    <View style={styles.bucketRow}>
      <View style={styles.bucketLeft}>
        <Text style={styles.bucketLabel}>{bucket.label}</Text>
        <Text style={styles.bucketDesc} numberOfLines={1}>{bucket.description}</Text>
      </View>
      <View style={styles.bucketRight}>
        <Text style={styles.bucketRevenue}>{formatCurrency(bucket.revenue)}</Text>
        <Text style={styles.bucketOrders}>{bucket.orders} orders</Text>
      </View>
    </View>
  );
}

function PoRow({ po }: { po: PoOutflow }) {
  const isOverdue = new Date(po.expected_delivery_date) < new Date();
  return (
    <View style={styles.poRow}>
      <View style={styles.poLeft}>
        <Text style={styles.poSupplier} numberOfLines={1}>{po.supplier_name}</Text>
        <Text style={[styles.poDate, isOverdue && { color: colors.error }]}>
          {isOverdue ? 'Overdue · ' : ''}{formatDate(po.expected_delivery_date)}
        </Text>
      </View>
      <Text style={styles.poCost}>{formatCurrency(po.total_cost)}</Text>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function CashFlowScreen() {
  const [data, setData] = useState<CashFlowData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res } = await apiClient.get('/api/v1/modules/cashflow');
      setData(res ?? null);
    } catch {
      setError('Failed to load cash flow data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen>
      <AppHeader showLogo onRefresh={load} />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        <Text style={styles.heading}>Cash Flow</Text>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={load}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !data ? (
          <View style={styles.center}>
            <Text style={styles.emptyTitle}>No data available</Text>
          </View>
        ) : (
          <>
            {/* Hero — net cash position */}
            <Card style={styles.heroCard}>
              <Text style={styles.heroLabel}>Net Cash Position</Text>
              <Text style={[styles.heroValue, { color: cashPositionColor(data.summary.net_cash_position) }]}>
                {formatCurrency(data.summary.net_cash_position)}
              </Text>
              {data.summary.at_risk_revenue > 0 && (
                <View style={styles.atRiskRow}>
                  <Ionicons name="warning-outline" size={14} color={colors.error} />
                  <Text style={styles.atRiskText}>
                    {formatCurrency(data.summary.at_risk_revenue)} at risk
                  </Text>
                </View>
              )}
            </Card>

            {/* Gross profit */}
            <Card>
              <Text style={styles.sectionTitle}>Gross Profit</Text>
              <StatRow label="Revenue" value={formatCurrency(data.gross_profit.gross_revenue)} />
              <StatRow label="COGS" value={formatCurrency(data.gross_profit.total_cogs)} />
              <StatRow
                label="Gross Profit"
                value={formatCurrency(data.gross_profit.gross_profit)}
                accent={data.gross_profit.gross_profit >= 0 ? colors.success : colors.error}
              />
              {data.gross_profit.gross_margin_pct != null && (
                <StatRow
                  label="Margin"
                  value={`${data.gross_profit.gross_margin_pct.toFixed(1)}%`}
                  accent={data.gross_profit.gross_margin_pct >= 40 ? colors.success : colors.warning}
                />
              )}
            </Card>

            {/* Revenue buckets */}
            <Card>
              <Text style={styles.sectionTitle}>Revenue Breakdown</Text>
              {data.buckets.map(b => <BucketRow key={b.label} bucket={b} />)}
            </Card>

            {/* Working capital */}
            {data.summary.working_capital_locked > 0 && (
              <Card style={styles.wclCard}>
                <Ionicons name="lock-closed-outline" size={16} color={colors.warning} />
                <Text style={styles.wclText}>
                  {formatCurrency(data.summary.working_capital_locked)} locked in inventory
                </Text>
              </Card>
            )}

            {/* PO outflows */}
            {data.po_outflows.length > 0 && (
              <Card>
                <Text style={styles.sectionTitle}>Upcoming PO Outflows</Text>
                {data.po_outflows.map(po => <PoRow key={po.po_id} po={po} />)}
              </Card>
            )}

            <Text style={styles.computedAt}>
              Updated {new Date(data.computed_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </Text>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  heading: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  heroCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  heroLabel: { color: colors.ink3, fontSize: font.size.sm },
  heroValue: { fontSize: 40, fontWeight: font.weight.bold },
  atRiskRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  atRiskText: { color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: spacing.sm },
  statRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.rule },
  statLabel: { color: colors.ink3, fontSize: font.size.sm },
  statValue: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  bucketRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  bucketLeft: { flex: 1, marginRight: spacing.sm },
  bucketLabel: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  bucketDesc: { color: colors.ink4, fontSize: font.size.xs },
  bucketRight: { alignItems: 'flex-end' },
  bucketRevenue: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  bucketOrders: { color: colors.ink4, fontSize: font.size.xs },
  wclCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.warning + '18' },
  wclText: { color: colors.warning, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  poRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: spacing.sm, borderBottomWidth: 1, borderBottomColor: colors.rule },
  poLeft: { flex: 1, marginRight: spacing.sm },
  poSupplier: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  poDate: { color: colors.ink4, fontSize: font.size.xs },
  poCost: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  center: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  errorText: { color: colors.error, fontSize: font.size.sm },
  retryText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  emptyTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  computedAt: { color: colors.ink4, fontSize: font.size.xs, textAlign: 'center', marginTop: spacing.sm },
});