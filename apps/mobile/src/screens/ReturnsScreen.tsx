// apps/mobile/src/screens/ReturnsScreen.tsx
//
// RETURNS SCREEN (Mobile)
// -----------------------
// Supplier batch quality intelligence.
// Answers: "Why am I getting returns? Which supplier is causing them?"
//
// Zone 1: Return rate hero — this month vs average
// Zone 2: Supplier batch correlation — the novel signal
// Zone 3: High return rate SKUs — product-level view
//
// Data:
//   GET /api/v1/modules/returns/correlation
//
// Design principle: returns are not just refunds — they are
// supplier quality signals and product signals. Surface both.

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
import { Screen, AppHeader, Card } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

// ─── Types ───────────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

function returnRateColor(pct: number): string {
  if (pct >= 20) return colors.error;
  if (pct >= 10) return colors.warning;
  return colors.success;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function ZoneError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.zoneError}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
      <Text style={styles.zoneErrorText}>{message}</Text>
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

function CorrelationRow({ row, avgReturnRate }: { row: ReturnCorrelation; avgReturnRate: number }) {
  const rate = row.return_rate_pct ?? 0;
  const isBadBatch = rate >= avgReturnRate * 2 && rate >= 15;

  return (
    <View style={[styles.corrRow, isBadBatch && styles.corrRowAlert]}>
      <View style={styles.corrLeft}>
        <Text style={styles.corrVariant} numberOfLines={1}>
          {row.variant_title ?? row.sku ?? 'Unknown SKU'}
        </Text>
        {row.supplier_name && (
          <Text style={styles.corrSupplier} numberOfLines={1}>
            {row.supplier_name}
            {row.batch_received_at ? ` · Batch ${formatDate(row.batch_received_at)}` : ''}
          </Text>
        )}
        <Text style={styles.corrUnits}>
          {row.units_returned} returned of {row.units_sold} sold
        </Text>
        {isBadBatch && (
          <View style={styles.badBatchTag}>
            <Ionicons name="warning-outline" size={11} color={colors.error} />
            <Text style={styles.badBatchText}>Suspect batch</Text>
          </View>
        )}
      </View>
      <Text style={[styles.corrRate, { color: returnRateColor(rate) }]}>
        {rate.toFixed(1)}%
      </Text>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function ReturnsScreen() {
  const navigation = useNavigation<any>();
  const [data, setData] = useState<ReturnCorrelation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res } = await apiClient.get('/api/v1/modules/returns/correlation');
      setData(res.data ?? []);
    } catch {
      setError('Failed to load returns data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  // Compute aggregates
  const totalReturned = data.reduce((s, r) => s + r.units_returned, 0);
  const totalSold = data.reduce((s, r) => s + r.units_sold, 0);
  const overallReturnRate = totalSold > 0 ? (totalReturned / totalSold) * 100 : null;

  const avgReturnRate = data.length > 0
    ? data.reduce((s, r) => s + (r.return_rate_pct ?? 0), 0) / data.length
    : 0;

  // Supplier-level rollup
  const supplierMap = new Map<string, { name: string; returned: number; sold: number }>();
  for (const row of data) {
    if (!row.supplier_name) continue;
    const key = row.supplier_name;
    const existing = supplierMap.get(key) ?? { name: row.supplier_name, returned: 0, sold: 0 };
    existing.returned += row.units_returned;
    existing.sold += row.units_sold;
    supplierMap.set(key, existing);
  }
  const supplierRollup = Array.from(supplierMap.values())
    .map(s => ({ ...s, rate: s.sold > 0 ? (s.returned / s.sold) * 100 : 0 }))
    .sort((a, b) => b.rate - a.rate);

  // High-return SKUs (rate ≥ 15% or ≥ 2× average)
  const highReturnRows = data
    .filter(r => (r.return_rate_pct ?? 0) >= Math.max(15, avgReturnRate * 1.5))
    .sort((a, b) => (b.return_rate_pct ?? 0) - (a.return_rate_pct ?? 0));

  return (
    <Screen>
      <AppHeader
        showLogo={false}
        title="Returns"
        onRefresh={load}
        rightAction={{
          icon: 'notifications-outline',
          onPress: () => navigation.getParent()?.navigate('AlertsInbox'),
        }}
      />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <ZoneError message={error} onRetry={load} />
        ) : data.length === 0 ? (
          <Card style={styles.emptyCard}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
            <Text style={styles.emptyTitle}>No return data</Text>
            <Text style={styles.emptySubtext}>
              Return correlation appears once your WMS receive flow is active and refunds are processed.
            </Text>
          </Card>
        ) : (
          <>
            {/* ── ZONE 1: RETURN RATE HERO ──────────────────── */}
            <Card style={styles.heroCard}>
              <Text style={styles.heroLabel}>Overall Return Rate</Text>
              {overallReturnRate !== null ? (
                <>
                  <Text style={[styles.heroValue, { color: returnRateColor(overallReturnRate) }]}>
                    {overallReturnRate.toFixed(1)}%
                  </Text>
                  <View style={styles.heroStats}>
                    <Text style={styles.heroStat}>{totalReturned} units returned</Text>
                    <Text style={styles.heroStatDivider}>·</Text>
                    <Text style={styles.heroStat}>{totalSold} sold</Text>
                  </View>
                  {overallReturnRate >= 10 && (
                    <View style={styles.alertRow}>
                      <Ionicons name="warning-outline" size={14} color={colors.error} />
                      <Text style={styles.alertText}>Above healthy threshold (10%)</Text>
                    </View>
                  )}
                </>
              ) : (
                <Text style={styles.emptyText}>No return rate data</Text>
              )}
            </Card>

            {/* ── ZONE 2: SUPPLIER QUALITY ──────────────────── */}
            {supplierRollup.length > 0 && (
              <Card>
                <Text style={styles.sectionTitle}>Supplier quality</Text>
                <Text style={styles.sectionSubtitle}>Return rate by supplier</Text>
                {supplierRollup.map(s => (
                  <View key={s.name} style={styles.supplierRow}>
                    <View style={styles.supplierLeft}>
                      <Text style={styles.supplierName} numberOfLines={1}>{s.name}</Text>
                      <Text style={styles.supplierUnits}>{s.returned} of {s.sold} units returned</Text>
                    </View>
                    <Text style={[styles.supplierRate, { color: returnRateColor(s.rate) }]}>
                      {s.rate.toFixed(1)}%
                    </Text>
                  </View>
                ))}
              </Card>
            )}

            {/* ── ZONE 3: BATCH CORRELATION ─────────────────── */}
            {highReturnRows.length > 0 && (
              <Card>
                <Text style={styles.sectionTitle}>⚠️ Suspect batches</Text>
                <Text style={styles.sectionSubtitle}>
                  SKUs with return rates significantly above average ({avgReturnRate.toFixed(1)}%)
                </Text>
                {highReturnRows.map(row => (
                  <CorrelationRow
                    key={`${row.lasyncro_variant_id}-${row.receive_job_id ?? 'no-batch'}`}
                    row={row}
                    avgReturnRate={avgReturnRate}
                  />
                ))}
              </Card>
            )}

            {/* ── ZONE 4: ALL CORRELATIONS ──────────────────── */}
            <Card>
              <Text style={styles.sectionTitle}>All return data</Text>
              <Text style={styles.sectionSubtitle}>Highest return rate first</Text>
              {data.map(row => (
                <CorrelationRow
                  key={`${row.lasyncro_variant_id}-${row.receive_job_id ?? 'no-batch'}`}
                  row={row}
                  avgReturnRate={avgReturnRate}
                />
              ))}
            </Card>
          </>
        )}

      </ScrollView>
    </Screen>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },

  // Hero
  heroCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  heroLabel: { color: colors.ink3, fontSize: font.size.sm },
  heroValue: { fontSize: 48, fontWeight: font.weight.bold, lineHeight: 56 },
  heroStats: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  heroStat: { color: colors.ink3, fontSize: font.size.xs },
  heroStatDivider: { color: colors.ink4, fontSize: font.size.xs },
  alertRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  alertText: { color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },

  // Section
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: 2 },
  sectionSubtitle: { color: colors.ink4, fontSize: font.size.xs, marginBottom: spacing.sm },

  // Supplier rollup
  supplierRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  supplierLeft: { flex: 1, marginRight: spacing.sm },
  supplierName: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  supplierUnits: { color: colors.ink4, fontSize: font.size.xs },
  supplierRate: { fontSize: font.size.md, fontWeight: font.weight.bold },

  // Correlation rows
  corrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    gap: spacing.sm,
  },
  corrRowAlert: {
    backgroundColor: colors.error + '08',
    marginHorizontal: -spacing.md,
    paddingHorizontal: spacing.md,
  },
  corrLeft: { flex: 1 },
  corrVariant: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  corrSupplier: { color: colors.ink3, fontSize: font.size.xs, marginTop: 1 },
  corrUnits: { color: colors.ink4, fontSize: font.size.xs, marginTop: 1 },
  corrRate: { fontSize: font.size.md, fontWeight: font.weight.bold, minWidth: 48, textAlign: 'right' },
  badBatchTag: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginTop: spacing.xs,
  },
  badBatchText: { color: colors.error, fontSize: 11, fontWeight: font.weight.semibold },

  // Zone error
  zoneError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.error + '12',
    borderRadius: radius.md,
  },
  zoneErrorText: { color: colors.error, fontSize: font.size.sm, flex: 1 },
  retryText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.semibold },

  // Empty
  emptyCard: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  emptyTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  emptyText: { color: colors.ink3, fontSize: font.size.md },
  emptySubtext: { color: colors.ink4, fontSize: font.size.sm, textAlign: 'center' },
});