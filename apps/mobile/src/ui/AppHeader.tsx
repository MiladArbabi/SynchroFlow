// apps/mobile/src/ui/AppHeader.tsx
import { useCallback, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing } from '../theme';
import { ProfileSheet } from './ProfileSheet';
import { useNavigation } from '@react-navigation/native';

type Props = {
  title?: string;
  showLogo?: boolean;
  onRefresh?: () => void;
  showProfile?: boolean;
  onBack?: () => void;
  rightAction?: {
    icon: keyof typeof Ionicons.glyphMap;
    onPress: () => void;
  };
};

export function AppHeader({ title, showLogo, onRefresh, showProfile = true, onBack, rightAction }: Props) {
  const [profileOpen, setProfileOpen] = useState(false);
  const navigation = useNavigation<any>();

  const handleSettings = useCallback(() => {
    try {
      // Navigate to Settings tab in the root tab navigator
      navigation.getParent()?.navigate('Settings') ??
      navigation.navigate('Settings' as never);
    } catch {
      // not available on this navigator
    }
  }, [navigation]);
  
  return (
    <View style={styles.header}>
      {/* LEFT — logo or title */}
      {onBack ? (
        <TouchableOpacity onPress={onBack} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
          <Ionicons name="arrow-back-outline" size={24} color={colors.ink} />
        </TouchableOpacity>
      ) : showLogo ? (
        <Image
          source={require('../../assets/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      ) : (
        <Text style={styles.title}>{title ?? ''}</Text>
      )}

      {/* RIGHT — actions */}
      <View style={styles.actions}>
        {onRefresh && (
          <TouchableOpacity onPress={onRefresh} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name="refresh-outline" size={22} color={colors.ink3} />
          </TouchableOpacity>
        )}
        {rightAction && (
          <TouchableOpacity onPress={rightAction.onPress} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Ionicons name={rightAction.icon} size={22} color={colors.accent} />
          </TouchableOpacity>
        )}
        {showProfile && (
          <TouchableOpacity onPress={() => setProfileOpen(true)} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <View style={styles.avatar}>
              <Ionicons name="person-outline" size={16} color={colors.accent} />
            </View>
          </TouchableOpacity>
        )}
      </View>
    <ProfileSheet
        visible={profileOpen}
        onClose={() => setProfileOpen(false)}
        onSettings={handleSettings}
      />
  </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  logo: {
    height: 24,
    width: 120,
  },
  title: {
    color: colors.ink,
    fontSize: font.size.xl,
    fontWeight: font.weight.bold,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    alignItems: 'center',
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accentGhost,
    borderWidth: 1,
    borderColor: colors.accentBorder,
    justifyContent: 'center',
    alignItems: 'center',
  },
});