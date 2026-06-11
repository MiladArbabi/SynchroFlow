// apps/mobile/src/ui/ResumeBanner.tsx
//
// RESUME BANNER — §10.7 shared component (MOB-HOME-01)
// ─────────────────────────────────────────────────────
// Pinned above the task feed whenever a session is live.
// §10.4.1: always the topmost element in the Feed screen.
//
// Pure display — parent (TaskListScreen) owns AsyncStorage
// lookup and passes the active task + resume callback.

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, radius } from '../theme';
import type { Task } from '../screens/TaskListScreen';

export type ResumeBannerProps = {
  task: Task;
  onResume: () => void;
};

export function ResumeBanner({ task, onResume }: ResumeBannerProps) {
  return (
    <TouchableOpacity
      style={styles.root}
      onPress={onResume}
      activeOpacity={0.8}
    >
      <View style={styles.dot} />
      <View style={styles.textWrap}>
        <Text style={styles.label}>Session in progress</Text>
        <Text style={styles.title} numberOfLines={1}>{task.title}</Text>
      </View>
      <View style={styles.resumeBtn}>
        <Text style={styles.resumeLabel}>Resume</Text>
        <Ionicons name="arrow-forward" size={14} color={colors.accent} />
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.accentGhost,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    flexShrink: 0,
  },
  textWrap: {
    flex: 1,
    gap: 2,
  },
  label: {
    color: colors.accent,
    fontSize: font.size.xs,
    fontWeight: font.weight.semibold,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.ink,
    fontSize: font.size.sm,
    fontWeight: font.weight.medium,
  },
  resumeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.accentBorder,
  },
  resumeLabel: {
    color: colors.accent,
    fontSize: font.size.sm,
    fontWeight: font.weight.semibold,
  },
});
