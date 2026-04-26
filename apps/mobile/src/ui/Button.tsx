// apps/mobile/src/ui/Button.tsx
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, ViewStyle } from 'react-native';
import { colors, radius, font, spacing } from '../theme';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: ViewStyle;
};

const variantStyles: Record<Variant, { bg: string; border: string; text: string }> = {
  primary:   { bg: colors.accent,  border: colors.accent,  text: '#fff' },
  secondary: { bg: colors.bg3,     border: colors.rule2,   text: colors.ink },
  ghost:     { bg: 'transparent',  border: colors.rule,    text: colors.ink2 },
  danger:    { bg: colors.error,   border: colors.error,   text: '#fff' },
};

export function Button({ label, onPress, variant = 'primary', loading, disabled, style }: Props) {
  const v = variantStyles[variant];
  const isDisabled = disabled || loading;

  return (
    <TouchableOpacity
      style={[
        styles.base,
        { backgroundColor: v.bg, borderColor: v.border },
        isDisabled && styles.disabled,
        style,
      ]}
      onPress={onPress}
      disabled={isDisabled}
      activeOpacity={0.75}
    >
      {loading
        ? <ActivityIndicator color={v.text} size="small" />
        : <Text style={[styles.label, { color: v.text }]}>{label}</Text>
      }
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.sm + 4,
    paddingHorizontal: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  disabled: { opacity: 0.5 },
});