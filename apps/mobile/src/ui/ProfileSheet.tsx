// apps/mobile/src/ui/ProfileSheet.tsx
import { Modal, View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, font, spacing, radius } from '../theme';
import { useAuth } from '../hooks/useAuth';

type Props = {
  visible: boolean;
  onClose: () => void;
  onSettings?: () => void;
};

export function ProfileSheet({ visible, onClose, onSettings }: Props) {
  const { logout, role, userId } = useAuth();

  const handleLogout = async () => {
    onClose();
    await logout();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.backdrop} />
      </TouchableWithoutFeedback>

      <View style={styles.sheet}>
        {/* Handle */}
        <View style={styles.handle} />

        {/* Profile info */}
        <View style={styles.profileRow}>
          <View style={styles.avatar}>
            <Ionicons name="person-outline" size={24} color={colors.accent} />
          </View>
          <View style={styles.profileInfo}>
            <Text style={styles.profileRole}>
              {role ? role.charAt(0).toUpperCase() + role.slice(1) : 'User'}
            </Text>
            <Text style={styles.profileId}>ID #{userId}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        {/* Menu items */}
        <TouchableOpacity style={styles.menuItem} onPress={() => { onClose(); onSettings?.(); }}>
          <Ionicons name="settings-outline" size={20} color={colors.ink3} />
          <Text style={styles.menuItemText}>Settings</Text>
          <Ionicons name="chevron-forward-outline" size={16} color={colors.ink4} />
        </TouchableOpacity>

        <TouchableOpacity style={styles.menuItem} onPress={onClose}>
          <Ionicons name="help-circle-outline" size={20} color={colors.ink3} />
          <Text style={styles.menuItemText}>Help & support</Text>
          <Text style={styles.menuItemSub}>Coming soon</Text>
        </TouchableOpacity>

        <View style={styles.divider} />

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={() => void handleLogout()}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

        {/* Cancel */}
        <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
          <Text style={styles.cancelText}>Cancel</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: colors.bg2,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  handle: {
    width: 40, height: 4,
    backgroundColor: colors.ink4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.accentGhost,
    borderWidth: 1, borderColor: colors.accentBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  profileInfo: { gap: spacing.xs },
  profileRole: {
    color: colors.ink,
    fontSize: font.size.lg,
    fontWeight: font.weight.bold,
  },
  profileId: { color: colors.ink3, fontSize: font.size.sm },
  divider: {
    height: 1,
    backgroundColor: colors.rule,
    marginVertical: spacing.xs,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  menuItemText: {
    flex: 1,
    color: colors.ink,
    fontSize: font.size.md,
    fontWeight: font.weight.medium,
  },
  menuItemSub: {
    color: colors.ink4,
    fontSize: font.size.sm,
  },
  signOutBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  signOutText: {
    color: colors.error,
    fontSize: font.size.md,
    fontWeight: font.weight.semibold,
  },
  cancelBtn: {
    alignItems: 'center',
    paddingVertical: spacing.md,
    marginTop: spacing.xs,
  },
  cancelText: {
    color: colors.ink3,
    fontSize: font.size.md,
  },
});