// apps/mobile/src/intelligence/components/ZoneError.tsx
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, radius } from '../../theme';

export function ZoneError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View style={styles.zoneError}>
      <Ionicons name="alert-circle-outline" size={18} color={colors.error} />
      <Text style={styles.zoneErrorText}>{message}</Text>
      <TouchableOpacity onPress={onRetry}>
        <Text style={styles.retryText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  zoneError: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.error + '12',
    borderRadius: radius.md,
  },
  zoneErrorText: { color: colors.error, fontSize: font.size.sm, flex: 1 },
  retryText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.semibold },
});