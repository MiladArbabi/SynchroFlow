// apps/mobile/src/ui/Divider.tsx
import { View, StyleSheet } from 'react-native';
import { colors } from '../theme';

export function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  divider: {
    height: 1,
    backgroundColor: colors.rule,
  },
});