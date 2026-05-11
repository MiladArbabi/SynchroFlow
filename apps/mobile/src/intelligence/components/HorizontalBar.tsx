// apps/mobile/src/intelligence/components/HorizontalBar.tsx
import { View, Text } from 'react-native';
import { colors, font, spacing } from '../../theme';

export function HorizontalBar({ label, value, max, threshold, color }: {
  label: string;
  value: number;
  max: number;
  threshold?: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min(1, value / max) : 0;
  const thresholdPct = threshold && max > 0 ? Math.min(1, threshold / max) : null;
  return (
    <View style={{ marginBottom: spacing.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
        <Text style={{ color: colors.ink, fontSize: font.size.xs, fontWeight: font.weight.semibold }} numberOfLines={1}>{label}</Text>
        <Text style={{ color, fontSize: font.size.xs, fontWeight: font.weight.bold }}>{value}d</Text>
      </View>
      <View style={{ height: 8, backgroundColor: colors.bg2, borderRadius: 4, overflow: 'hidden' }}>
        <View style={{ height: 8, width: `${pct * 100}%`, backgroundColor: color, borderRadius: 4 }} />
        {thresholdPct !== null && (
          <View style={{
            position: 'absolute', left: `${thresholdPct * 100}%`,
            top: 0, width: 2, height: 8, backgroundColor: colors.error,
          }} />
        )}
      </View>
    </View>
  );
}