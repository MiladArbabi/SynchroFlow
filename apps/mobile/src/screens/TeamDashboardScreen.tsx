// apps/mobile/src/screens/TeamDashboardScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ActivityIndicator,
  ScrollView, TouchableOpacity,
} from 'react-native';
import { Screen, Card, Badge, Row, Divider, Button } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

type Operator = {
  user_id: number;
  first_name: string;
  last_name: string;
  role: string;
};

type OperatorStatus = {
  operator: Operator;
  picking: number;    // batches currently picking
  packing: number;    // batches currently packing
  stowing: number;    // stow tasks in progress
  receiving: number;  // receive jobs in progress
  idle: boolean;
};

export default function TeamDashboardScreen() {
  const [operators, setOperators] = useState<Operator[]>([]);
  const [statuses, setStatuses] = useState<OperatorStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [opsRes, batchRes, stowRes, receiveRes] = await Promise.all([
        apiClient.get('/api/v1/operators/team'),
        apiClient.get('/api/v1/wms/batches'),
        apiClient.get('/api/v1/wms/stow-tasks'),
        apiClient.get('/api/v1/suppliers/receive-jobs?status=in_progress'),
      ]);

      const ops: Operator[] = opsRes.data.operators ?? [];
      const batches = batchRes.data.batches ?? [];
      const stowTasks = stowRes.data.stow_tasks ?? [];
      const receiveJobs = receiveRes.data.receive_jobs ?? [];

      // Aggregate per operator
      const statusMap: OperatorStatus[] = ops.map((op) => {
        const picking = batches.filter(
          (b: any) => b.assigned_operator_id === op.user_id &&
          (b.status === 'pending' || b.status === 'picking')
        ).length;

        const packing = batches.filter(
          (b: any) => b.assigned_packer_id === op.user_id &&
          (b.status === 'pick_complete' || b.status === 'packing')
        ).length;

        // Also count self-claimed batches not assigned
        const selfPicking = batches.filter(
          (b: any) => b.picked_by === op.user_id &&
          b.status === 'picking' &&
          !b.assigned_operator_id
        ).length;

        const selfPacking = batches.filter(
          (b: any) => b.packed_by === op.user_id &&
          b.status === 'packing' &&
          !b.assigned_packer_id
        ).length;

        const stowing = stowTasks.filter(
          (t: any) => t.claimed_by === op.user_id && t.status === 'in_progress'
        ).length;

        const receiving = receiveJobs.filter(
          (j: any) => j.assigned_operator_id === op.user_id
        ).length;

        const totalPicking = picking + selfPicking;
        const totalPacking = packing + selfPacking;

        return {
          operator: op,
          picking: totalPicking,
          packing: totalPacking,
          stowing,
          receiving,
          idle: totalPicking === 0 && totalPacking === 0 && stowing === 0 && receiving === 0,
        };
      });

      setOperators(ops);
      setStatuses(statusMap);
      setLastRefresh(new Date());
    } catch {
      // Silently retain previous data on refresh failure
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const activeCount = statuses.filter(s => !s.idle).length;
  const idleCount = statuses.filter(s => s.idle).length;

  return (
    <Screen>
      {/* HEADER */}
      <Row style={styles.header}>
        <Text style={styles.headerTitle}>Team</Text>
        <TouchableOpacity onPress={() => void load()}>
          <Text style={styles.refreshText}>↻ Refresh</Text>
        </TouchableOpacity>
      </Row>

      {/* SUMMARY ROW */}
      <Row style={styles.summary}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{operators.length}</Text>
          <Text style={styles.summaryLabel}>Members</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={[styles.summaryValue, { color: colors.success }]}>{activeCount}</Text>
          <Text style={styles.summaryLabel}>Active</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>{idleCount}</Text>
          <Text style={styles.summaryLabel}>Idle</Text>
        </View>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryValue}>
            {lastRefresh.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </Text>
          <Text style={styles.summaryLabel}>Updated</Text>
        </View>
      </Row>

      <Divider />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={colors.accent} />
        </View>
      ) : statuses.length === 0 ? (
        <View style={styles.center}>
          <Text style={styles.emptyText}>No team members found.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {/* Active operators first */}
          {statuses
            .sort((a, b) => Number(a.idle) - Number(b.idle))
            .map((s) => (
              <Card key={s.operator.user_id} style={styles.operatorCard}>
                {/* Operator header */}
                <Row style={styles.operatorHeader}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>
                      {s.operator.first_name[0]}{s.operator.last_name[0]}
                    </Text>
                  </View>
                  <View style={styles.operatorInfo}>
                    <Text style={styles.operatorName}>
                      {s.operator.first_name} {s.operator.last_name}
                    </Text>
                    <Text style={styles.operatorRole}>{s.operator.role}</Text>
                  </View>
                  <Badge
                    label={s.idle ? 'IDLE' : 'ACTIVE'}
                    variant={s.idle ? 'info' : 'success'}
                  />
                </Row>

                {/* Task breakdown */}
                {!s.idle && (
                  <>
                    <Divider />
                    <Row style={styles.taskRow}>
                      {s.picking > 0 && (
                        <View style={styles.taskChip}>
                          <Text style={styles.taskChipCount}>{s.picking}</Text>
                          <Text style={styles.taskChipLabel}>picking</Text>
                        </View>
                      )}
                      {s.packing > 0 && (
                        <View style={[styles.taskChip, { backgroundColor: colors.warningGhost }]}>
                          <Text style={[styles.taskChipCount, { color: colors.warning }]}>
                            {s.packing}
                          </Text>
                          <Text style={styles.taskChipLabel}>packing</Text>
                        </View>
                      )}
                      {s.stowing > 0 && (
                        <View style={[styles.taskChip, { backgroundColor: colors.successGhost }]}>
                          <Text style={[styles.taskChipCount, { color: colors.success }]}>
                            {s.stowing}
                          </Text>
                          <Text style={styles.taskChipLabel}>stowing</Text>
                        </View>
                      )}
                      {s.receiving > 0 && (
                        <View style={[styles.taskChip, { backgroundColor: colors.purpleGhost }]}>
                          <Text style={[styles.taskChipCount, { color: colors.purple }]}>
                            {s.receiving}
                          </Text>
                          <Text style={styles.taskChipLabel}>receiving</Text>
                        </View>
                      )}
                    </Row>
                  </>
                )}
              </Card>
            ))}
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerTitle: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
  refreshText: {
    color: colors.accent,
    fontSize: font.size.sm,
  },
  summary: {
    justifyContent: 'space-around',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  summaryItem: { alignItems: 'center', gap: spacing.xs },
  summaryValue: {
    color: colors.accent,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
  },
  summaryLabel: { color: colors.ink3, fontSize: font.size.xs ?? 11 },
  list: { padding: spacing.md, gap: spacing.sm, paddingBottom: spacing.xl },
  operatorCard: { gap: spacing.sm },
  operatorHeader: { alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.bg3,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    color: colors.accent,
    fontSize: font.size.sm,
    fontWeight: font.weight.bold,
  },
  operatorInfo: { flex: 1, gap: 2 },
  operatorName: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  operatorRole: { color: colors.ink3, fontSize: font.size.sm },
  taskRow: { gap: spacing.sm, flexWrap: 'wrap' },
  taskChip: {
    backgroundColor: colors.infoGhost,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    alignItems: 'center',
    minWidth: 60,
  },
  taskChipCount: {
    color: colors.accent,
    fontSize: font.size.md,
    fontWeight: font.weight.bold,
  },
  taskChipLabel: {
    color: colors.ink3,
    fontSize: font.size.xs ?? 11,
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  emptyText: { color: colors.ink3, fontSize: font.size.md, textAlign: 'center' },
});