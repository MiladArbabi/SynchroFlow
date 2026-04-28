// apps/mobile/src/screens/OverviewScreen.tsx
import { View, Text, StyleSheet } from 'react-native';
import { Screen } from '../ui';
import { colors, font, spacing } from '../theme';

export default function OverviewScreen() {
  return (
    <Screen>
      <View style={styles.header}>
        <Text style={styles.title}>Overview</Text>
        <Text style={styles.subtitle}>Morning brief and KPIs — coming soon</Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    padding: spacing.lg,
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
  subtitle: {
    color: colors.ink3,
    fontSize: font.size.md,
  },
});