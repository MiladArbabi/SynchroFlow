// apps/mobile/src/intelligence/components/StatRow.tsx
import { View, Text, StyleSheet } from 'react-native';
import { colors, font, spacing } from '../../theme';

export function StatRow({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={[styles.statValue, accent ? { color: accent } : undefined]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  statLabel: { color: colors.ink3, fontSize: font.size.sm },
  statValue: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
});