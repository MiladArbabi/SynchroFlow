// apps/mobile/src/intelligence/components/ReturnRateBar.tsx
import { View, Text } from 'react-native';
import { colors, font, spacing } from '../../theme';
import { returnRateColor } from '../helpers';

export function ReturnRateBar({ rate, threshold = 10 }: { rate: number; threshold?: number }) {
  const cappedRate = Math.min(rate, 100);
  const color = returnRateColor(rate);
  return (
    <View style={{ gap: spacing.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: colors.ink3, fontSize: font.size.xs }}>0%</Text>
        <Text style={{ color: colors.ink4, fontSize: font.size.xs }}>Healthy threshold: {threshold}%</Text>
        <Text style={{ color: colors.ink3, fontSize: font.size.xs }}>100%</Text>
      </View>
      <View style={{ height: 12, backgroundColor: colors.bg2, borderRadius: 6, overflow: 'hidden' }}>
        <View style={{ height: 12, width: `${cappedRate}%`, backgroundColor: color, borderRadius: 6 }} />
        <View style={{
          position: 'absolute', left: `${threshold}%`,
          top: 0, width: 2, height: 12, backgroundColor: colors.ink3,
        }} />
      </View>
      <Text style={{ color, fontSize: font.size.xs, fontWeight: font.weight.semibold, textAlign: 'center' }}>
        {rate.toFixed(1)}% return rate
        {rate > threshold ? ` — ${(rate - threshold).toFixed(1)}% above threshold` : ' — within healthy range'}
      </Text>
    </View>
  );
}