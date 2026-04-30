// apps/mobile/src/screens/TaskListScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl,
  ScrollView,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Screen, Card, Badge, Row, Divider, AppHeader } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { TaskStackParamList } from '../navigation/types';
import { useAuth } from '../hooks/useAuth';

/**
 * TASK LIST SCREEN (Mobile v1)
 * ----------------------------
 * Operator's pending tasks for today.
 * Sources: pick batches + stow tasks from WMS endpoints.
 *
 * onSelectTask → ScanScreen (Sprint 1 M5)
 * onLogout → clears SecureStore token via useAuth
 */

export type Task = {
  id: string;
  type: 'pick' | 'stow' | 'receive' | 'pack';
  title: string;
  subtitle: string;
  assigned: boolean;
};

async function fetchTasks(userId?: number, roles?: string[]): Promise<Task[]> {
  const tasks: Task[] = [];
  const isOperator = roles?.includes('operator') && !roles?.includes('owner') && !roles?.includes('admin');

  const [batchRes, stowRes, receiveRes] = await Promise.all([
    apiClient.get('/api/v1/wms/batches'),
    apiClient.get('/api/v1/wms/stow-tasks'),
    apiClient.get('/api/v1/suppliers/receive-jobs?status=pending,in_progress,inspection'),
  ]);

  // ── Pick batches ──────────────────────────────────────────────────────────
  for (const batch of batchRes.data.batches ?? []) {
    const assignedPicker = batch.assigned_operator_id;
    const assignedPacker = batch.assigned_packer_id;

    // Pick phase
    if (batch.status === 'pending' || batch.status === 'picking') {
      if (!isOperator || !assignedPicker || assignedPicker === userId) {
        tasks.push({
          id: batch.pick_batch_id,
          type: 'pick',
          title: batch.status === 'picking' ? 'Continue picking' : 'Pick batch',
          subtitle: `${batch.total_line_items} lines · ${batch.total_units} units`,
          assigned: !!assignedPicker,
        });
      }
    }

    // Pack phase
    if (batch.status === 'pick_complete' || batch.status === 'packing' || batch.status === 'pack_complete') {
      if (!isOperator || !assignedPacker || assignedPacker === userId) {
        tasks.push({
          id: batch.pick_batch_id,
          type: 'pack',
          title: batch.status === 'pack_complete' ? 'Pack complete ✓' :
                 batch.status === 'packing' ? 'Continue packing' : 'Pack batch',
          subtitle: batch.status === 'pack_complete'
            ? `${batch.total_units} units shipped`
            : `${batch.total_units} units · ${batch.units_picked} picked`,
          assigned: !!assignedPacker,
        });
      }
    }
  }

  // ── Stow tasks — grouped into single session ──────────────────────────────
  const stowTasks = stowRes.data.stow_tasks ?? [];
  if (stowTasks.length > 0) {
    const totalUnits = stowTasks.reduce((s: number, t: any) => s + t.quantity, 0);
    const hasInProgress = stowTasks.some((t: any) => t.status === 'in_progress');
    tasks.push({
      id: stowTasks[0].stow_task_id,  // use first task id as entry point
      type: 'stow',
      title: hasInProgress ? 'Continue stowing' : 'Stow session',
      subtitle: `${stowTasks.length} variant${stowTasks.length !== 1 ? 's' : ''} · ${totalUnits} units`,
      assigned: false,
    });
  }

  // ── Receive jobs ──────────────────────────────────────────────────────────
  for (const job of receiveRes.data.receive_jobs ?? []) {
    const assignedOp = job.assigned_operator_id;
    if (!isOperator || !assignedOp || assignedOp === userId) {
      tasks.push({
        id: job.receive_job_id,
        type: 'receive',
        title: job.status === 'in_progress' ? 'Continue receiving' : 'Receive shipment',
        subtitle: `${job.supplier_name} · ${job.total_variants} variants`,
        assigned: !!assignedOp,
      });
    }
  }

  return tasks;
}

const TYPE_BADGE: Record<Task['type'], { label: string; variant: 'info' | 'warning' | 'success' }> = {
  pick:    { label: 'PICK',    variant: 'info' },
  stow:    { label: 'STOW',   variant: 'warning' },
  receive: { label: 'RECEIVE', variant: 'success' },
  pack:    { label: 'PACK',   variant: 'warning' },
};

function TaskCard({ task, onPress }: { task: Task; onPress: () => void }) {
  const badge = TYPE_BADGE[task.type];
  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.7}>
      <Card style={styles.taskCard}>
        <Row>
          <View style={styles.taskContent}>
            <Badge label={badge.label} variant={badge.variant} />
            <Text style={styles.taskTitle}>{task.title}</Text>
            <Text style={styles.taskSubtitle}>{task.subtitle}</Text>
          </View>
          <Text style={styles.chevron}>›</Text>
        </Row>
      </Card>
    </TouchableOpacity>
  );
}

export default function TaskListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<TaskStackParamList>>();
  const { userId, roles } = useAuth();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setTasks(await fetchTasks(userId ?? undefined, roles));
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: unknown }; message?: string });
      console.error('[TASKS] fetch failed', JSON.stringify(msg?.response?.data ?? msg?.message ?? err));
      setError('Failed to load tasks. Check your connection.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(
    useCallback(() => {
      void load(true);
    }, [load])
  );

  return (
    <Screen>
      {/* HEADER */}
      <AppHeader showLogo onRefresh={() => { setRefreshing(true); void load(true); }} />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.filterRow}
        style={styles.filterScroll}
      >
        {[null, 'pick', 'stow', 'receive', 'pack'].map(filter => (
          <TouchableOpacity
            key={filter ?? 'all'}
            style={[styles.filterChip, activeFilter === filter && styles.filterChipActive]}
            onPress={() => setActiveFilter(filter)}
          >
            <Text style={[styles.filterChipText, activeFilter === filter && styles.filterChipTextActive]}>
              {filter === null ? 'All' : filter.charAt(0).toUpperCase() + filter.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      <Divider />

      {/* ERROR */}
      {error && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {/* EMPTY */}
      {!loading && !error && tasks.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>All clear</Text>
          <Text style={styles.emptySubtitle}>No tasks right now. Pull to refresh.</Text>
        </View>
      )}

      {/* TASK LIST */}
      <FlatList
          data={activeFilter ? tasks.filter(t => t.type === activeFilter) : tasks}
          keyExtractor={(item) => item.id}
          contentContainerStyle={[styles.list, { flexGrow: 1 }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing || loading}
              onRefresh={() => { setRefreshing(true); void load(true); }}
              tintColor={colors.accent}
            />
          }
        renderItem={({ item }) => (
          <TaskCard
            task={item}
            onPress={() =>
              item.type === 'pick'
                ? navigation.navigate('PickBrief', { task: item })
                : item.type === 'receive'
                ? navigation.navigate('ReceiveJob', { task: item })
                : item.type === 'stow'
                ? navigation.navigate('Stow', { task: item })
                : item.type === 'pack'
                ? navigation.navigate('Pack', { task: item })
                : navigation.navigate('Scan', { task: item })
            }
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoutText: {
    color: colors.ink3,
    fontSize: font.size.sm,
  },
  list: {
    padding: spacing.md,
  },
  taskCard: {
    paddingVertical: spacing.md,
  },
  taskContent: {
    flex: 1,
    gap: spacing.xs,
  },
  taskTitle: {
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
    marginTop: spacing.xs,
  },
  taskSubtitle: {
    color: colors.ink3,
    fontSize: font.size.sm,
  },
  calendarText: {
    color: colors.accent,
    fontSize: font.size.sm,
  },
  chevron: {
    color: colors.ink4,
    fontSize: 24,
    marginLeft: spacing.sm,
  },
  separator: {
    height: spacing.sm,
  },
  empty: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
    marginBottom: spacing.xs,
  },
  emptySubtitle: {
    color: colors.ink3,
    fontSize: font.size.sm,
    textAlign: 'center',
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
  filterScroll: {
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
    flexGrow: 0,
  },
  filterRow: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
  },
  filterChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    backgroundColor: colors.bg2,
    borderWidth: 1,
    borderColor: colors.rule,
    alignSelf: 'flex-start',
  },
  filterChipActive: {
    borderColor: colors.accent,
    backgroundColor: colors.accentGhost,
  },
  filterChipText: {
    color: colors.ink3,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
  },
  filterChipTextActive: {
    color: colors.accent,
    fontWeight: font.weight.bold,
  },
});