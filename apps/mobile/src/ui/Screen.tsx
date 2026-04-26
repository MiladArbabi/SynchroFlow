// apps/mobile/src/ui/Screen.tsx
import { View, StyleSheet, SafeAreaView, StatusBar } from 'react-native';
import { colors } from '../theme';

/**
 * SCREEN
 * ------
 * Base wrapper for every screen.
 * Handles safe area, status bar, background.
 */
export function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={colors.bg} />
      <View style={styles.root}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  root: { flex: 1, backgroundColor: colors.bg },
});