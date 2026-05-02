// apps/mobile/src/screens/OperatorSettingsScreen.tsx
import { useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, AppHeader, Card, Row, Divider } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { useAuth } from '../hooks/useAuth';
import { useEffect, useState } from 'react';
import { apiClient } from '@lasyncro/mobile-core';

export default function OperatorSettingsScreen() {
  const navigation = useNavigation<any>();
  const { logout, email, firstName } = useAuth();
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [alertTone, setAlertTone] = useState<'urgent' | 'standard' | 'silent'>('standard');
  const [prefsLoaded, setPrefsLoaded] = useState(false);

  // Load preferences on mount
  useEffect(() => {
    apiClient.get('/api/v1/members/me/preferences')
      .then(({ data }) => {
        const p = data.preferences ?? {};
        if (p.push_enabled !== undefined) setNotificationsEnabled(p.push_enabled);
        if (p.alert_tone) setAlertTone(p.alert_tone);
        setPrefsLoaded(true);
      })
      .catch(() => setPrefsLoaded(true));
  }, []);

  // Auto-save preferences when they change (after initial load)
  useEffect(() => {
    if (!prefsLoaded) return;
    apiClient.patch('/api/v1/members/me/preferences', {
      push_enabled: notificationsEnabled,
      alert_tone: alertTone,
    }).catch(() => {});
  }, [notificationsEnabled, alertTone, prefsLoaded]);

  return (
    <Screen>
      <AppHeader
        title="Settings"
        onBack={() => navigation.goBack()}
        showProfile={false}
      />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>

        {/* Profile */}
        <Text style={styles.sectionTitle}>Profile</Text>
        <Card style={styles.card}>
          <Row style={styles.profileRow}>
            <View style={styles.avatar}>
              <Ionicons name="person-outline" size={24} color={colors.accent} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.profileName}>{firstName ?? 'Operator'}</Text>
              <Text style={styles.profileEmail}>{email ?? ''}</Text>
              <Text style={styles.profileRole}>OPERATOR</Text>
            </View>
          </Row>
        </Card>

        <Divider />

        {/* Quick links */}
        <Text style={styles.sectionTitle}>Notifications</Text>
        <Card style={styles.card}>
          <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <View style={{ flex: 1 }}>
              <Text style={styles.menuItemText}>Push notifications</Text>
              <Text style={styles.menuItemSub}>Receive alerts on this device</Text>
            </View>
            <Switch
              value={notificationsEnabled}
              onValueChange={setNotificationsEnabled}
              trackColor={{ true: colors.accent, false: colors.bg3 }}
            />
          </Row>
        </Card>

        <Text style={styles.sectionTitle}>Alert tone</Text>
        <Card style={styles.card}>
          {(['urgent', 'standard', 'silent'] as const).map(tone => (
            <TouchableOpacity
              key={tone}
              style={styles.menuItem}
              onPress={() => setAlertTone(tone)}
            >
              <Ionicons
                name={tone === 'urgent' ? 'volume-high-outline' : tone === 'standard' ? 'volume-medium-outline' : 'volume-mute-outline'}
                size={20}
                color={alertTone === tone ? colors.accent : colors.ink3}
              />
              <Text style={[styles.menuItemText, alertTone === tone && { color: colors.accent }]}>
                {tone.charAt(0).toUpperCase() + tone.slice(1)}
              </Text>
              {alertTone === tone && <Ionicons name="checkmark" size={16} color={colors.accent} />}
            </TouchableOpacity>
          ))}
        </Card>

        <Divider />

        {/* Sign out */}
        <TouchableOpacity style={styles.signOutBtn} onPress={logout}>
          <Ionicons name="log-out-outline" size={20} color={colors.error} />
          <Text style={styles.signOutText}>Sign out</Text>
        </TouchableOpacity>

      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  card: { gap: spacing.sm },
  profileRow: { alignItems: 'center', gap: spacing.md },
  avatar: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.accentGhost,
    borderWidth: 1, borderColor: colors.accentBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  profileName: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold },
  profileEmail: { color: colors.ink3, fontSize: font.size.sm },
  profileRole: { color: colors.accent, fontSize: font.size.xs, fontWeight: font.weight.bold, marginTop: 2 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  menuItemText: { flex: 1, color: colors.ink, fontSize: font.size.sm },
  signOutBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  signOutText: { color: colors.error, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  menuItemSub: { color: colors.ink3, fontSize: font.size.xs, marginTop: 2 },
});