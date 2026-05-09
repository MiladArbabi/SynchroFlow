// apps/mobile/src/screens/DemandScreen.tsx
//
// DEMAND SCREEN (Mobile)
// ----------------------
// Alert-only surface for the owner/admin.
// Shows stockout risk summary and per-SKU reorder signals.
//
// Data: GET /api/v1/modules/demand (Growth tier)
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
import { Screen, AppHeader, Card, Badge } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

// ─── Types ───────────────────────────────────────────────────────────────────

interface DemandSummary {
  total_variants_tracked: number;
  critical_reorder_count: number;
  warning_reorder_count: number;
  stockout_count: number;
  avg_days_of_stock: number | null;
  total_inventory_value: number;
}

interface DemandVariant {
  variant_id: string;
  sku: string;
  title: string;
  days_of_stock: number | null;
  reorder_status: 'critical' | 'warning' | 'ok';
  units_on_hand: number;
  daily_velocity: number | null;
  reorder_point: number | null;
}

interface DemandData {
  summary: DemandSummary;
  variants: DemandVariant[];
  computed_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function statusVariant(status: DemandVariant['reorder_status']): 'error' | 'warning' | 'info' {
  if (status === 'critical') return 'error';
  if (status === 'warning') return 'warning';
  return 'info';
}

function daysLabel(days: number | null): string {
  if (days === null) return 'Unknown';
  if (days === 0) return 'Stockout';
  return `${days}d left`;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SummaryTile({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <View style={[styles.tile, accent && styles.tileAccent]}>
      <Text style={[styles.tileValue, accent && styles.tileValueAccent]}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
    </View>
  );
}

function VariantRow({ variant }: { variant: DemandVariant }) {
  return (
    <Card style={styles.variantCard}>
      <View style={styles.variantHeader}>
        <View style={styles.variantMeta}>
          <Text style={styles.variantTitle} numberOfLines={1}>{variant.title}</Text>
          <Text style={styles.variantSku}>{variant.sku}</Text>
        </View>
        <Badge
          label={daysLabel(variant.days_of_stock)}
          variant={statusVariant(variant.reorder_status)}
        />
      </View>
      <View style={styles.variantStats}>
        <Text style={styles.statText}>On hand: {variant.units_on_hand}</Text>
        {variant.daily_velocity != null && (
          <Text style={styles.statText}>Velocity: {variant.daily_velocity.toFixed(1)}/day</Text>
        )}
        {variant.reorder_point != null && (
          <Text style={styles.statText}>Reorder at: {variant.reorder_point}</Text>
        )}
      </View>
    </Card>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function DemandScreen() {
  const [data, setData] = useState<DemandData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res } = await apiClient.get('/api/v1/modules/demand');
      setData(res ?? null);
    } catch {
      setError('Failed to load demand data.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const criticalVariants = data?.variants.filter(v => v.reorder_status === 'critical') ?? [];
  const warningVariants = data?.variants.filter(v => v.reorder_status === 'warning') ?? [];
  const hasAlerts = criticalVariants.length > 0 || warningVariants.length > 0;

  return (
    <Screen>
      <AppHeader showLogo onRefresh={load} />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        <Text style={styles.heading}>Demand</Text>

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
            {/* Summary tiles */}
            <View style={styles.tilesRow}>
              <SummaryTile
                label="Tracked SKUs"
                value={String(data.summary.total_variants_tracked)}
              />
              <SummaryTile
                label="Critical"
                value={String(data.summary.critical_reorder_count)}
                accent={data.summary.critical_reorder_count > 0}
              />
              <SummaryTile
                label="Stockouts"
                value={String(data.summary.stockout_count)}
                accent={data.summary.stockout_count > 0}
              />
            </View>

            {data.summary.avg_days_of_stock != null && (
              <Text style={styles.avgDays}>
                Avg days of stock: {data.summary.avg_days_of_stock.toFixed(1)}d
              </Text>
            )}

            {/* Alert variants */}
            {!hasAlerts ? (
              <View style={styles.center}>
                <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
                <Text style={styles.emptyTitle}>All clear</Text>
                <Text style={styles.emptySubtitle}>No reorder alerts at this time.</Text>
              </View>
            ) : (
              <>
                {criticalVariants.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>⚠️ Critical — reorder now</Text>
                    {criticalVariants.map(v => <VariantRow key={v.variant_id} variant={v} />)}
                  </>
                )}
                {warningVariants.length > 0 && (
                  <>
                    <Text style={styles.sectionTitle}>Watch — reorder soon</Text>
                    {warningVariants.map(v => <VariantRow key={v.variant_id} variant={v} />)}
                  </>
                )}
              </>
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
  tilesRow: { flexDirection: 'row', gap: spacing.sm },
  tile: {
    flex: 1,
    backgroundColor: colors.bg2,
    borderRadius: radius.md,
    padding: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  tileAccent: { backgroundColor: colors.error + '22', borderWidth: 1, borderColor: colors.error },
  tileValue: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  tileValueAccent: { color: colors.error },
  tileLabel: { color: colors.ink3, fontSize: font.size.xs, textAlign: 'center' },
  avgDays: { color: colors.ink3, fontSize: font.size.sm },
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  variantCard: { gap: spacing.xs },
  variantHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  variantMeta: { flex: 1, marginRight: spacing.sm },
  variantTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  variantSku: { color: colors.ink4, fontSize: font.size.xs },
  variantStats: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  statText: { color: colors.ink3, fontSize: font.size.xs },
  center: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  errorText: { color: colors.error, fontSize: font.size.sm },
  retryText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  emptyTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  emptySubtitle: { color: colors.ink3, fontSize: font.size.sm, textAlign: 'center' },
  computedAt: { color: colors.ink4, fontSize: font.size.xs, textAlign: 'center', marginTop: spacing.sm },
});