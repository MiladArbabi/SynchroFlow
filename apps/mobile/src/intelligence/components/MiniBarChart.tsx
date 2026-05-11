// apps/mobile/src/intelligence/components/MiniBarChart.tsx
import { View, Text } from 'react-native';
import { colors, font } from '../../theme';

export function MiniBarChart({ values, labels, color, height = 80 }: {
  values: number[];
  labels: string[];
  color: string;
  height?: number;
}) {
  if (values.length === 0 || values.every(v => v === 0)) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.ink4, fontSize: font.size.xs }}>No data yet</Text>
      </View>
    );
  }
  const max = Math.max(...values);
  return (
    <View style={{ height: height + 20 }}>
      <View style={{ height, flexDirection: 'row', alignItems: 'flex-end', gap: 4 }}>
        {values.map((v, i) => (
          <View key={i} style={{ flex: 1, alignItems: 'center' }}>
            <View style={{
              width: '80%',
              height: max > 0 ? Math.max(3, (v / max) * height) : 3,
              backgroundColor: v === max ? color : color + '66',
              borderRadius: 3,
            }} />
          </View>
        ))}
      </View>
      <View style={{ flexDirection: 'row', marginTop: 4 }}>
        {labels.map((l, i) => (
          <Text key={i} style={{ flex: 1, textAlign: 'center', fontSize: 9, color: colors.ink4 }} numberOfLines={1}>
            {l}
          </Text>
        ))}
      </View>
    </View>
  );
}