// apps/mobile/src/intelligence/components/MiniSparkline.tsx
import { View, Text } from 'react-native';
import { colors, font } from '../../theme';

export function MiniSparkline({ values, color, height = 60 }: {
  values: number[];
  color: string;
  height?: number;
}) {
  if (values.length < 2 || values.every(v => v === 0)) {
    return (
      <View style={{ height, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: colors.ink4, fontSize: font.size.xs }}>No trend data yet</Text>
      </View>
    );
  }
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const width = 280;
  const stepX = width / (values.length - 1);

  const points = values.map((v, i) => ({
    x: i * stepX,
    y: height - ((v - min) / range) * (height - 8) - 4,
  }));

  return (
    <View style={{ height, width: '100%' }}>
      {points.slice(0, -1).map((p, i) => {
        const next = points[i + 1];
        const dx = next.x - p.x;
        const dy = next.y - p.y;
        const len = Math.sqrt(dx * dx + dy * dy);
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        return (
          <View key={i} style={{
            position: 'absolute',
            left: p.x,
            top: p.y,
            width: len,
            height: 2,
            backgroundColor: color,
            borderRadius: 1,
            transform: [{ rotate: `${angle}deg` }],
          }} />
        );
      })}
      {points.map((p, i) => (
        <View key={i} style={{
          position: 'absolute',
          left: p.x - 3,
          top: p.y - 3,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: color,
        }} />
      ))}
    </View>
  );
}