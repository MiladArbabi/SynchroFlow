// apps/mobile/src/screens/OperatorPerformanceScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, AppHeader, Card, Row } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

interface PerformanceMetrics {
  pick_rate_uph: number | null;
  pack_rate_uph: number | null;
  stow_rate_uph: number | null;
  batches_picked: number;
  batches_packed: number;
  receive_jobs_closed: number;
  dock_to_stock_hours: number | null;
}

interface MetricTileProps {
  label: string;
  value: string;
  icon: keyof typeof Ionicons.glyphMap;
  sub?: string;
}

function MetricTile({ label, value, icon, sub }: MetricTileProps) {
  return (
    <View style={styles.tile}>
      <Ionicons name={icon} size={20} color={colors.accent} />
      <Text style={styles.tileValue}>{value}</Text>
      <Text style={styles.tileLabel}>{label}</Text>
      {sub && <Text style={styles.tileSub}>{sub}</Text>}
    </View>
  );
}

export default function OperatorPerformanceScreen() {
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const { operatorId, operatorName } = route.params as { operatorId: number; operatorName: string };

  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(`/api/v1/members/${operatorId}/performance`);
      setMetrics(data.metrics);
    } catch {
      setError('Failed to load performance data.');
    } finally {
      setLoading(false);
    }
  }, [operatorId]);

  useEffect(() => { void load(); }, [load]);

  const fmt = (val: number | null, unit: string) =>
    val !== null ? `${val} ${unit}` : '—';

  return (
    <Screen>
      <AppHeader
        title={operatorName}
        onBack={() => navigation.goBack()}
        showProfile={false}
        onRefresh={load}
      />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : metrics ? (
          <>
            <Text style={styles.sectionTitle}>Throughput</Text>
            <View style={styles.tileGrid}>
              <MetricTile label="Pick rate" value={fmt(metrics.pick_rate_uph, 'UPH')} icon="walk-outline" sub="units per hour" />
              <MetricTile label="Pack rate" value={fmt(metrics.pack_rate_uph, 'UPH')} icon="cube-outline" sub="units per hour" />
              <MetricTile label="Stow rate" value={fmt(metrics.stow_rate_uph, 'UPH')} icon="archive-outline" sub="units per hour" />
              <MetricTile label="Dock-to-stock" value={fmt(metrics.dock_to_stock_hours, 'hrs')} icon="timer-outline" sub="avg receive→stow" />
            </View>

            <Text style={styles.sectionTitle}>Activity</Text>
            <Card style={styles.activityCard}>
              <Row style={styles.activityRow}>
                <Ionicons name="checkmark-circle-outline" size={18} color={colors.success} />
                <Text style={styles.activityLabel}>Batches picked</Text>
                <Text style={styles.activityValue}>{metrics.batches_picked}</Text>
              </Row>
              <Row style={styles.activityRow}>
                <Ionicons name="gift-outline" size={18} color={colors.info} />
                <Text style={styles.activityLabel}>Batches packed</Text>
                <Text style={styles.activityValue}>{metrics.batches_packed}</Text>
              </Row>
              <Row style={styles.activityRow}>
                <Ionicons name="boat-outline" size={18} color={colors.accent} />
                <Text style={styles.activityLabel}>Receive jobs closed</Text>
                <Text style={styles.activityValue}>{metrics.receive_jobs_closed}</Text>
              </Row>
            </Card>

            {metrics.pick_rate_uph === null && metrics.pack_rate_uph === null && metrics.stow_rate_uph === null && (
              <View style={styles.center}>
                <Ionicons name="hourglass-outline" size={36} color={colors.ink3} />
                <Text style={styles.emptyText}>No completed tasks yet — metrics will appear once this operator completes their first job.</Text>
              </View>
            )}
          </>
        ) : null}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  tileGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tile: {
    flex: 1, minWidth: '45%', backgroundColor: colors.bg2,
    borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', gap: spacing.xs,
  },
  tileValue: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  tileLabel: { color: colors.ink3, fontSize: font.size.xs, textAlign: 'center' },
  tileSub: { color: colors.ink4, fontSize: font.size.xs, textAlign: 'center' },
  activityCard: { gap: spacing.sm },
  activityRow: { justifyContent: 'space-between', alignItems: 'center' },
  activityLabel: { color: colors.ink2, fontSize: font.size.sm, flex: 1, marginLeft: spacing.sm },
  activityValue: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.bold },
  center: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  errorText: { color: colors.error, fontSize: font.size.sm },
  emptyText: { color: colors.ink3, fontSize: font.size.sm, textAlign: 'center' },
});