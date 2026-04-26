// apps/mobile/src/ui/Row.tsx
import { View, StyleSheet, ViewStyle } from 'react-native';

/**
 * ROW — horizontal flex container.
 * justify defaults to 'space-between' — most common operator layout.
 */
export function Row({
  children,
  style,
  justify = 'space-between',
  align = 'center',
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  justify?: ViewStyle['justifyContent'];
  align?: ViewStyle['alignItems'];
}) {
  return (
    <View style={[styles.row, { justifyContent: justify, alignItems: align }, style]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
});