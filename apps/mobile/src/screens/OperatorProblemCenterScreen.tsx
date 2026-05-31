// apps/mobile/src/screens/OperatorProblemCenterScreen.tsx

import { useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, RefreshControl, TouchableOpacity,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Badge, Row, Divider, AppHeader } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

/**
 * OPERATOR PROBLEM CENTER SCREEN
 * --------------------------------
 * Read-only view of open problem_center_tasks for the operator.
 *
 * Operator's responsibility:
 *   - See which items they reported as exceptions
 *   - Know the PROB label and which bin to place the item in
 *   - Track status (open / investigating)
 *
 * Operator CANNOT resolve — that is owner/admin only.
 * Resolution happens in DispatchScreen (owner) or web Problem Center.
 *
 * INV-PC-10 — closes mobile Problem Center gap.
 */

type ProblemTask = {
  problem_task_id: string;
  status: 'open' | 'investigating' | 'resolved' | 'discarded' | 'returned_to_supplier';
  source: 'pick' | 'pack' | 'stow' | 'receive' | 'returns';
  exception_type: string;
  quantity: number;
  prob_label: string | null;
  problem_bin_location: string | null;
  created_at: string;
  variant_title: string | null;
  sku: string | null;
};

const SOURCE_BADGE: Record<string, { label: string; variant: 'info' | 'warning' | 'success' | 'error' }> = {
  pick:    { label: 'PICK',    variant: 'info' },
  pack:    { label: 'PACK',    variant: 'warning' },
  stow:    { label: 'STOW',   variant: 'warning' },
  receive: { label: 'RECEIVE', variant: 'success' },
  returns: { label: 'RETURN',  variant: 'error' },
};

function relativeAge(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export default function OperatorProblemCenterScreen() {
  const [tasks,      setTasks]      = useState<ProblemTask[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error,      setError]      = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get('/api/v1/wms/problem-center');
      // Show open + investigating only — resolved are history, not actionable for operator
      const active = (data.problem_tasks ?? []).filter(
        (t: ProblemTask) => t.status === 'open' || t.status === 'investigating'
      );
      setTasks(active);
    } catch {
      setError('Failed to load problem tasks. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(true); }, [load]));

  const openCount = tasks.length;

  return (
    <Screen>
      <AppHeader showLogo onRefresh={() => { setRefreshing(true); void load(true); }} />

      {/* Summary strip */}
      <View style={styles.summaryStrip}>
        <View style={[styles.summaryCard, openCount > 0 && styles.summaryCardAlert]}>
          <Text style={[styles.summaryCount, openCount > 0 && styles.summaryCountAlert]}>
            {openCount}
          </Text>
          <Text style={styles.summaryLabel}>Open</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryCount}>
            {tasks.filter(t => t.source === 'pick').length}
          </Text>
          <Text style={styles.summaryLabel}>Pick</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryCount}>
            {tasks.filter(t => t.source === 'pack').length}
          </Text>
          <Text style={styles.summaryLabel}>Pack</Text>
        </View>
        <View style={styles.summaryCard}>
          <Text style={styles.summaryCount}>
            {tasks.filter(t => t.source === 'stow').length}
          </Text>
          <Text style={styles.summaryLabel}>Stow</Text>
        </View>
      </View>

      <Divider />

      {/* Error */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      <ScrollView
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || loading}
            onRefresh={() => { setRefreshing(true); void load(true); }}
            tintColor={colors.accent}
          />
        }
      >
        {/* Empty state */}
        {!loading && !error && tasks.length === 0 && (
          <View style={styles.empty}>
            <Ionicons name="checkmark-circle-outline" size={52} color={colors.success} />
            <Text style={styles.emptyTitle}>No open exceptions</Text>
            <Text style={styles.emptySubtitle}>
              Items you report during pick, pack, or stow will appear here with their PROB label and bin location.
            </Text>
          </View>
        )}

        {/* Problem task cards */}
        {tasks.map(task => {
          const badge   = SOURCE_BADGE[task.source] ?? SOURCE_BADGE.pick;
          const label   = task.variant_title ?? task.sku ?? task.problem_task_id.slice(0, 8).toUpperCase();
          const exLabel = task.exception_type.replace(/_/g, ' ');

          return (
            <Card key={task.problem_task_id} style={styles.taskCard}>
              {/* Header row */}
              <Row style={styles.cardHeader}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitle} numberOfLines={2}>{label}</Text>
                  {task.sku && task.sku !== task.variant_title && (
                    <Text style={styles.itemSku}>{task.sku}</Text>
                  )}
                </View>
                <View style={styles.badges}>
                  <Badge label={badge.label} variant={badge.variant} />
                  <Badge
                    label={task.status.toUpperCase()}
                    variant={task.status === 'open' ? 'error' : 'warning'}
                  />
                </View>
              </Row>

              <View style={{ height: 1, backgroundColor: colors.rule, marginVertical: spacing.sm }} />

              {/* Exception details */}
              <Row style={styles.detailRow}>
                <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
                <Text style={styles.detailText}>
                  {exLabel} · {task.quantity} unit{task.quantity !== 1 ? 's' : ''}
                </Text>
              </Row>

              {/* PROB label + bin — most important for operator */}
              {task.prob_label && (
                <Row style={{ ...styles.detailRow, ...styles.probRow }}>
                  <Ionicons name="pricetag-outline" size={14} color={colors.accent} />
                  <Text style={styles.probLabel}>{task.prob_label}</Text>
                  {task.problem_bin_location && (
                    <>
                      <Ionicons name="arrow-forward-outline" size={12} color={colors.ink4} />
                      <Text style={styles.probBin}>{task.problem_bin_location}</Text>
                    </>
                  )}
                </Row>
              )}

              {/* Age + owner action note */}
              <Row style={{ ...styles.detailRow, marginTop: spacing.xs }}>
                <Ionicons name="time-outline" size={12} color={colors.ink4} />
                <Text style={styles.ageText}>{relativeAge(task.created_at)}</Text>
                <Text style={styles.ownerNote}>· Owner will resolve</Text>
              </Row>
            </Card>
          );
        })}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  summaryStrip: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    gap: spacing.sm,
  },
  summaryCard: {
    flex: 1, alignItems: 'center', gap: 2,
    backgroundColor: colors.bg2, borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    borderWidth: 1, borderColor: colors.rule,
  },
  summaryCardAlert: {
    borderColor: colors.errorBorder,
    backgroundColor: colors.errorGhost,
  },
  summaryCount: {
    color: colors.accent,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
    fontVariant: ['tabular-nums'],
  },
  summaryCountAlert: {
    color: colors.error,
  },
  summaryLabel: {
    color: colors.ink3,
    fontSize: font.size.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  list: {
    padding: spacing.md,
    paddingBottom: 100,
    gap: spacing.sm,
    flexGrow: 1,
  },
  taskCard: {
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  cardHeader: {
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  badges: {
    gap: spacing.xs,
    alignItems: 'flex-end',
    flexShrink: 0,
  },
  itemTitle: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  itemSku: {
    color: colors.ink4,
    fontSize: font.size.xs,
    fontFamily: 'monospace',
    marginTop: 2,
  },
  detailRow: {
    alignItems: 'center',
    gap: spacing.xs,
    marginTop: 2,
  },
  detailText: {
    color: colors.ink3,
    fontSize: font.size.sm,
    textTransform: 'capitalize',
  },
  probRow: {
    marginTop: spacing.sm,
    backgroundColor: colors.accentGhost,
    borderRadius: radius.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  probLabel: {
    color: colors.accent,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
    fontFamily: 'monospace',
  },
  probBin: {
    color: colors.accent,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
  },
  ageText: {
    color: colors.ink4,
    fontSize: font.size.xs,
  },
  ownerNote: {
    color: colors.ink4,
    fontSize: font.size.xs,
    fontStyle: 'italic',
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
    gap: spacing.md,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
  },
  emptySubtitle: {
    color: colors.ink3,
    fontSize: font.size.sm,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorBanner: {
    margin: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.errorGhost,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.errorBorder,
  },
  errorText: {
    color: colors.error,
    fontSize: font.size.sm,
  },
});
