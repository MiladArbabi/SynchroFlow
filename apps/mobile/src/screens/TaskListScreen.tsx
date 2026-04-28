// apps/mobile/src/screens/TaskListScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, RefreshControl,
} from 'react-native';
import { Screen, Card, Badge, Row, Divider } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

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
  type: 'pick' | 'stow' | 'receive';
  title: string;
  subtitle: string;
};

type Props = {
  onSelectTask: (task: Task) => void;
  onLogout: () => void;
  onOpenAvailability: () => void;
};

async function fetchTasks(): Promise<Task[]> {
  const tasks: Task[] = [];

  const [batchRes, stowRes] = await Promise.all([
    apiClient.get('/api/v1/wms/batches'),
    apiClient.get('/api/v1/wms/stow-tasks'),
  ]);

  for (const batch of batchRes.data.batches ?? []) {
    if (batch.status === 'pending' || batch.status === 'picking') {
      tasks.push({
        id: batch.pick_batch_id,
        type: 'pick',
        title: batch.status === 'picking' ? 'Continue picking' : 'Pick batch',
        subtitle: `${batch.total_line_items} lines · ${batch.total_units} units`,
      });
    }
  }

  for (const task of stowRes.data.stow_tasks ?? []) {
    tasks.push({
      id: task.stow_task_id,
      type: 'stow',
      title: task.variant_title ?? 'Stow stock',
      subtitle: `${task.quantity} units → ${task.location_code ?? 'Unassigned'}`,
    });
  }

  return tasks;
}

const TYPE_BADGE: Record<Task['type'], { label: string; variant: 'info' | 'warning' | 'success' }> = {
  pick:    { label: 'PICK',    variant: 'info' },
  stow:    { label: 'STOW',   variant: 'warning' },
  receive: { label: 'RECEIVE', variant: 'success' },
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

export default function TaskListScreen({ onSelectTask, onLogout, onOpenAvailability }: Props) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      setTasks(await fetchTasks());
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

  return (
    <Screen>
      {/* HEADER */}
      <Row style={styles.header}>
        <Text style={styles.headerTitle}>My tasks</Text>
        <Row justify="flex-end" style={{ gap: spacing.md }}>
          <TouchableOpacity onPress={onOpenAvailability} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.calendarText}>Calendar</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={onLogout} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.logoutText}>Sign out</Text>
          </TouchableOpacity>
        </Row>
      </Row>

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
        data={tasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl
            refreshing={refreshing || loading}
            onRefresh={() => { setRefreshing(true); void load(true); }}
            tintColor={colors.accent}
          />
        }
        renderItem={({ item }) => (
          <TaskCard task={item} onPress={() => onSelectTask(item)} />
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerTitle: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
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
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
  },
  errorText: {
    color: colors.error,
    fontSize: font.size.sm,
  },
});