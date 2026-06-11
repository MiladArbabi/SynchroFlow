// apps/mobile/src/ui/TaskCard.tsx
//
// TASK CARD — §10.7 shared component, §10.5.1 anatomy (MOB-HOME-01)
// ─────────────────────────────────────────────────────────────────
// Feed card for Task Inbox. Replaces the inline TaskCard in TaskListScreen.
//
// §10.5.1 anatomy (top → bottom):
//   [workflow icon]  [type label]
//   [title — display scale, ONE critical fact]
//   [subtitle — secondary context, max one line]
//   [full-width CTA]
//
// CHANGE CONTROL: rendered for every task in the operator feed.

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, radius } from '../theme';
import type { Task } from '../screens/TaskListScreen';

// ─── Workflow metadata ────────────────────────────────────────────────────────

const WORKFLOW_META: Record<
  Task['type'],
  { icon: keyof typeof Ionicons.glyphMap; label: string; color: string; bg: string }
> = {
  pick:    { icon: 'git-branch-outline',  label: 'PICK',    color: colors.info,    bg: 'rgba(96,165,250,0.12)'  },
  stow:    { icon: 'archive-outline',     label: 'STOW',    color: colors.warn,    bg: colors.warnSoft          },
  receive: { icon: 'download-outline',    label: 'RECEIVE', color: colors.ok,      bg: colors.okSoft            },
  pack:    { icon: 'cube-outline',        label: 'PACK',    color: colors.warn,    bg: colors.warnSoft          },
};

// ─── Props ────────────────────────────────────────────────────────────────────

export type TaskCardProps = {
  task: Task;
  onPress: () => void;
};

// ─── TaskCard ─────────────────────────────────────────────────────────────────

export function TaskCard({ task, onPress }: TaskCardProps) {
  const meta = WORKFLOW_META[task.type];

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.75}
      style={styles.root}
    >
      {/* Top row — icon + type label */}
      <View style={styles.topRow}>
        <View style={[styles.iconWrap, { backgroundColor: meta.bg }]}>
          <Ionicons name={meta.icon} size={18} color={meta.color} />
        </View>
        <Text style={[styles.typeLabel, { color: meta.color }]}>{meta.label}</Text>
      </View>

      {/* Title — §10.5.2 display scale, the ONE critical fact */}
      <Text style={styles.title} numberOfLines={2}>
        {task.title}
      </Text>

      {/* Subtitle — secondary context */}
      <Text style={styles.subtitle} numberOfLines={1}>
        {task.subtitle}
      </Text>

      {/* Full-width CTA */}
      <View style={styles.cta}>
        <Text style={styles.ctaLabel}>
          {task.title.startsWith('Continue') ? 'Resume' : 'Start'}
        </Text>
        <Ionicons name="arrow-forward" size={15} color={colors.bg} />
      </View>
    </TouchableOpacity>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    backgroundColor: colors.bg2,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.rule,
    padding: spacing.md,
    gap: spacing.xs,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    marginBottom: 2,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  typeLabel: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    letterSpacing: 0.6,
  },
  title: {
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.semibold,
    lineHeight: 22,
  },
  subtitle: {
    color: colors.ink3,
    fontSize: font.size.sm,
    marginBottom: spacing.xs,
  },
  cta: {
    height: 44,
    borderRadius: radius.sm,
    backgroundColor: colors.accent,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  ctaLabel: {
    color: colors.bg,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
});
