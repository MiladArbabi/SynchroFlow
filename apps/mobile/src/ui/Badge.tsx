// apps/mobile/src/ui/Badge.tsx
import { View, Text, StyleSheet } from 'react-native';
import { colors, radius, font } from '../theme';

type Variant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'accent';

const variantColors: Record<Variant, { bg: string; text: string }> = {
  default: { bg: colors.bg3,              text: colors.ink2 },
  success: { bg: 'rgba(34,197,94,0.15)',  text: colors.success },
  warning: { bg: 'rgba(245,158,11,0.15)', text: colors.warning },
  error:   { bg: 'rgba(239,68,68,0.15)',  text: colors.error },
  info:    { bg: 'rgba(96,165,250,0.15)', text: colors.info },
  accent:  { bg: colors.accentGhost,      text: colors.accent },
};

export function Badge({ label, variant = 'default' }: { label: string; variant?: Variant }) {
  const v = variantColors[variant];
  return (
    <View style={[styles.badge, { backgroundColor: v.bg }]}>
      <Text style={[styles.label, { color: v.text }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: font.size.xs,
    fontWeight: font.weight.bold,
    letterSpacing: 0.4,
  },
});