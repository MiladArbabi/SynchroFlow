// apps/mobile/src/screens/FinancesScreen.tsx
//
// FINANCES SCREEN (Mobile)
// ------------------------
// Daily margin intelligence for the owner.
// Answers: "Am I actually profitable? What's killing my margin?"
//
// Zone 1: Hero — blended margin % today vs target
// Zone 2: Margin destroyers — bottom SKUs weighted by volume
// Zone 3: Trend — direction vs last 7 days
//
// Data:
//   GET /api/v1/modules/finances/margin/sku
//   GET /api/v1/modules/finances/margin/trend
//
// Both load in parallel. Each zone handles its own error state.

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

interface TrendDay {
  date: string;
  avg_margin_pct: number;
  total_margin: number;
  total_revenue: number;
  order_count: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MARGIN_TARGET = 40; // 40% blended margin target

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(1)}K`;
  return `$${value.toLocaleString()}`;
}

function marginColor(pct: number): string {
  if (pct >= MARGIN_TARGET) return colors.success;
  if (pct >= MARGIN_TARGET * 0.75) return colors.warning;
  return colors.error;
}

function marginVariant(pct: number): 'error' | 'warning' | 'info' {
  if (pct >= MARGIN_TARGET) return 'info';
  if (pct >= MARGIN_TARGET * 0.75) return 'warning';
  return 'error';
}

function trendDirection(data: TrendDay[]): { delta: number; label: string; color: string } {
  if (data.length < 2) return { delta: 0, label: 'No trend data', color: colors.ink3 };
  const recent = data.slice(-7);
  const prior = data.slice(-14, -7);
  if (recent.length === 0 || prior.length === 0) return { delta: 0, label: 'Insufficient data', color: colors.ink3 };
  const recentAvg = recent.reduce((s, d) => s + d.avg_margin_pct, 0) / recent.length;
  const priorAvg = prior.reduce((s, d) => s + d.avg_margin_pct, 0) / prior.length;
  const delta = recentAvg - priorAvg;
  return {
    delta,
    label: delta >= 0 ? `+${delta.toFixed(1)}% vs prior week` : `${delta.toFixed(1)}% vs prior week`,
    color: delta >= 0 ? colors.success : colors.error,
  };
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

function SkuRow({ sku, rank }: { sku: SkuMargin; rank: number }) {
  // Weight by volume: units sold × margin gap from target
  const urgency = (MARGIN_TARGET - sku.margin_pct) * sku.total_units_sold;
  const isUrgent = urgency > 100;

  return (
    <View style={[styles.skuRow, isUrgent && styles.skuRowUrgent]}>
      <View style={styles.skuRank}>
        <Text style={styles.skuRankText}>{rank}</Text>
      </View>
      <View style={styles.skuMeta}>
        <Text style={styles.skuTitle} numberOfLines={1}>
          {sku.title}{sku.sku && sku.sku !== sku.title ? ` · ${sku.sku}` : ''}
        </Text>
        <Text style={styles.skuStats}>
          {sku.total_units_sold} units · {formatCurrency(sku.gross_revenue)} revenue
        </Text>
      </View>
      <View style={styles.skuMarginBlock}>
        <Text style={[styles.skuMarginPct, { color: marginColor(sku.margin_pct) }]}>
          {sku.margin_pct.toFixed(1)}%
        </Text>
        <Text style={styles.skuMarginAbs}>{formatCurrency(sku.gross_margin)}</Text>
      </View>
    </View>
  );
}

// ─── Screen ──────────────────────────────────────────────────────────────────

export default function FinancesScreen() {
  const navigation = useNavigation<any>();

  const [skuData, setSkuData] = useState<SkuMargin[]>([]);
  const [skuLoading, setSkuLoading] = useState(true);
  const [skuError, setSkuError] = useState<string | null>(null);

  const [trendData, setTrendData] = useState<TrendDay[]>([]);
  const [trendLoading, setTrendLoading] = useState(true);
  const [trendError, setTrendError] = useState<string | null>(null);

  const loadSku = useCallback(async () => {
    setSkuLoading(true);
    setSkuError(null);
    try {
      const { data } = await apiClient.get('/api/v1/modules/finances/margin/sku?limit=10&order=asc');
      setSkuData(data.data ?? []);
    } catch {
      setSkuError('Failed to load margin data.');
    } finally {
      setSkuLoading(false);
    }
  }, []);

  const loadTrend = useCallback(async () => {
    setTrendLoading(true);
    setTrendError(null);
    try {
      const { data } = await apiClient.get('/api/v1/modules/finances/margin/trend?days=30');
      setTrendData(data.data ?? []);
    } catch {
      setTrendError('Failed to load trend data.');
    } finally {
      setTrendLoading(false);
    }
  }, []);

  const loadAll = useCallback(() => {
    void loadSku();
    void loadTrend();
  }, [loadSku, loadTrend]);

  useFocusEffect(useCallback(() => { loadAll(); }, [loadAll]));

  // Compute blended margin from SKU data
  const totalRevenue = skuData.reduce((s, r) => s + Number(r.gross_revenue), 0);
  const totalMargin = skuData.reduce((s, r) => s + Number(r.gross_margin), 0);
  const blendedMarginPct = totalRevenue > 0 ? (totalMargin / totalRevenue) * 100 : null;

  // Bottom 3 SKUs weighted by revenue impact
  const destroyers = [...skuData]
    .filter(s => s.margin_pct < MARGIN_TARGET)
    .sort((a, b) => {
      const urgencyA = (MARGIN_TARGET - a.margin_pct) * a.total_units_sold;
      const urgencyB = (MARGIN_TARGET - b.margin_pct) * b.total_units_sold;
      return urgencyB - urgencyA;
    })
    .slice(0, 3);

  const trend = trendDirection(trendData);

  return (
    <Screen>
      <AppHeader
        showLogo={false}
        title="Finances"
        onRefresh={loadAll}
        rightAction={{
          icon: 'notifications-outline',
          onPress: () => navigation.getParent()?.navigate('AlertsInbox'),
        }}
      />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* ── ZONE 1: MARGIN HERO ───────────────────────────── */}
        {skuLoading ? (
          <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.lg }} />
        ) : skuError ? (
          <ZoneError message={skuError} onRetry={loadSku} />
        ) : (
          <Card style={styles.heroCard}>
            <Text style={styles.heroLabel}>Blended Margin</Text>
            {blendedMarginPct !== null ? (
              <>
                <Text style={[styles.heroValue, { color: marginColor(blendedMarginPct) }]}>
                  {blendedMarginPct.toFixed(1)}%
                </Text>
                <View style={styles.heroMeta}>
                  <Text style={styles.heroTarget}>Target: {MARGIN_TARGET}%</Text>
                  {blendedMarginPct < MARGIN_TARGET && (
                    <View style={styles.heroGapRow}>
                      <Ionicons name="arrow-down-outline" size={13} color={colors.error} />
                      <Text style={styles.heroGap}>
                        {(MARGIN_TARGET - blendedMarginPct).toFixed(1)}% below target
                      </Text>
                    </View>
                  )}
                </View>
                {/* Trend delta */}
                {!trendLoading && !trendError && trendData.length > 0 && (
                  <Text style={[styles.trendDelta, { color: trend.color }]}>{trend.label}</Text>
                )}
              </>
            ) : (
              <View style={styles.emptyHero}>
                <Ionicons name="bar-chart-outline" size={32} color={colors.ink4} />
                <Text style={styles.emptyText}>No margin data yet</Text>
                <Text style={styles.emptySubtext}>Margin appears once orders have cost data attached.</Text>
              </View>
            )}
          </Card>
        )}

        {/* ── ZONE 2: MARGIN DESTROYERS ─────────────────────── */}
        {!skuLoading && !skuError && skuData.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>
              {destroyers.length > 0 ? '⚠️ Margin destroyers' : '✓ All SKUs above target'}
            </Text>
            {destroyers.length === 0 ? (
              <Text style={styles.allGoodText}>
                Every SKU is above your {MARGIN_TARGET}% margin target.
              </Text>
            ) : (
              <>
                <Text style={styles.sectionSubtitle}>
                  Ranked by revenue impact — fix these first
                </Text>
                {destroyers.map((sku, i) => (
                  <SkuRow key={sku.lasyncro_variant_id} sku={sku} rank={i + 1} />
                ))}
              </>
            )}
          </Card>
        )}

        {/* ── ZONE 3: ALL SKUs ──────────────────────────────── */}
        {!skuLoading && !skuError && skuData.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>All SKUs by margin</Text>
            <Text style={styles.sectionSubtitle}>Lowest margin first</Text>
            {skuData.map((sku, i) => (
              <SkuRow key={sku.lasyncro_variant_id} sku={sku} rank={i + 1} />
            ))}
          </Card>
        )}

        {/* ── EMPTY STATE ───────────────────────────────────── */}
        {!skuLoading && !skuError && skuData.length === 0 && (
          <Card style={styles.emptyCard}>
            <Ionicons name="receipt-outline" size={40} color={colors.ink4} />
            <Text style={styles.emptyTitle}>No margin data yet</Text>
            <Text style={styles.emptySubtext}>
              Margin data appears once orders have unit costs attached via your supplier POs.
            </Text>
          </Card>
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
  heroMeta: { alignItems: 'center', gap: 2 },
  heroTarget: { color: colors.ink4, fontSize: font.size.xs },
  heroGapRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  heroGap: { color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },
  trendDelta: { fontSize: font.size.xs, fontWeight: font.weight.semibold, marginTop: spacing.xs },
  emptyHero: { alignItems: 'center', gap: spacing.sm },

  // Section
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: 2 },
  sectionSubtitle: { color: colors.ink4, fontSize: font.size.xs, marginBottom: spacing.sm },
  allGoodText: { color: colors.success, fontSize: font.size.sm },

  // SKU rows
  skuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    gap: spacing.sm,
  },
  skuRowUrgent: { backgroundColor: colors.error + '08' },
  skuRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.bg2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  skuRankText: { color: colors.ink3, fontSize: font.size.xs, fontWeight: font.weight.bold },
  skuMeta: { flex: 1 },
  skuTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  skuStats: { color: colors.ink4, fontSize: font.size.xs },
  skuMarginBlock: { alignItems: 'flex-end' },
  skuMarginPct: { fontSize: font.size.md, fontWeight: font.weight.bold },
  skuMarginAbs: { color: colors.ink4, fontSize: font.size.xs },

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

  // Empty states
  emptyCard: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.xl },
  emptyTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  emptyText: { color: colors.ink3, fontSize: font.size.md },
  emptySubtext: { color: colors.ink4, fontSize: font.size.sm, textAlign: 'center' },
});