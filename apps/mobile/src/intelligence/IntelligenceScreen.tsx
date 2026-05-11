// apps/mobile/src/intelligence/IntelligenceScreen.tsx
//
// INTELLIGENCE TAB (Mobile)
// -------------------------
// Segment control routing 4 intelligence modules.
// Each segment loads lazily on first activation.
//
// Segments: Cash Flow | Demand | Finances | Returns

import { useCallback, useState, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Screen, AppHeader } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';
import { Segment, SEGMENTS, CashFlowData, DemandData, SkuMargin, ReturnCorrelation } from './types';
import { CashFlowView, DemandView, FinancesView, ReturnsView } from './views';

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