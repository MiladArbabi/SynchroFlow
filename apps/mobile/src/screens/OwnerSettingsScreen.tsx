// apps/mobile/src/screens/OwnerSettingsScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Switch,
  Modal, TextInput, Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, Card, Badge, Row, Divider, AppHeader } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

type SettingsTab = 'team' | 'wms' | 'preferences';

type Operator = {
  id: number;
  name: string;
  email: string;
  role: string;
};

type OperatorStatus = {
  operator_id: number;
  current_task: string;
  status: 'idle' | 'picking' | 'packing' | 'stowing' | 'receiving';
};

type WmsSettings = {
  max_batch_line_items: number;
  auto_release_enabled: boolean;
  auto_release_interval_minutes: number;
  idle_alert_threshold_minutes: number;
  problem_bin_location: string | null;
};

const STATUS_COLOR: Record<string, string> = {
  picking: colors.accent,
  packing: colors.warning,
  stowing: colors.info,
  receiving: colors.success,
  idle: colors.ink4,
};

const STATUS_LABEL: Record<string, string> = {
  picking: 'Picking',
  packing: 'Packing',
  stowing: 'Stowing',
  receiving: 'Receiving',
  idle: 'Idle',
};

export default function OwnerSettingsScreen() {
  const navigation = useNavigation();
  const [tab, setTab] = useState<SettingsTab>('team');
  const [operators, setOperators] = useState<Operator[]>([]);
  const [statuses, setStatuses] = useState<OperatorStatus[]>([]);
  const [wmsSettings, setWmsSettings] = useState<WmsSettings | null>(null);
  const [loading, setLoading] = useState(true);

  // Team management state
  const [inviteModal, setInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteFirstName, setInviteFirstName] = useState('');
  const [inviteLastName, setInviteLastName] = useState('');
  const [inviteRole, setInviteRole] = useState<'operator' | 'admin'>('operator');
  const [inviting, setInviting] = useState(false);  

  // Preferences state (local only for now)
  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [alertTone, setAlertTone] = useState<'urgent' | 'standard' | 'silent'>('standard');
  const [alertTypes, setAlertTypes] = useState({
    exceptions: true,
    idle: true,
    batchReady: true,
    shipmentReady: true,
  });

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [opsRes, batchRes, stowRes, receiveRes, wmsRes] = await Promise.all([
        apiClient.get('/api/v1/operators/team'),
        apiClient.get('/api/v1/wms/batches'),
        apiClient.get('/api/v1/wms/stow-tasks'),
        apiClient.get('/api/v1/suppliers/receive-jobs?status=in_progress'),
        apiClient.get('/api/v1/wms/settings').catch(() => ({ data: null })),
      ]);

      const members: Operator[] = opsRes.data.members ?? [];
      setOperators(members);

      const batches = batchRes.data.batches ?? [];
      const stowTasks = stowRes.data.stow_tasks ?? [];
      const receiveJobs = receiveRes.data.receive_jobs ?? [];

      const statusMap: Record<number, OperatorStatus> = {};
      for (const b of batches) {
        if (b.picked_by && b.status === 'picking') {
          statusMap[b.picked_by] = { operator_id: b.picked_by, current_task: 'Picking batch', status: 'picking' };
        }
        if (b.packed_by && b.status === 'packing') {
          statusMap[b.packed_by] = { operator_id: b.packed_by, current_task: 'Packing batch', status: 'packing' };
        }
      }
      for (const t of stowTasks) {
        if (t.claimed_by && t.status === 'in_progress') {
          statusMap[t.claimed_by] = { operator_id: t.claimed_by, current_task: 'Stowing', status: 'stowing' };
        }
      }
      for (const j of receiveJobs) {
        if (j.assigned_operator_id) {
          statusMap[j.assigned_operator_id] = {
            operator_id: j.assigned_operator_id,
            current_task: `Receiving from ${j.supplier_name}`,
            status: 'receiving',
          };
        }
      }
      setStatuses(Object.values(statusMap));
      setWmsSettings(wmsRes.data?.settings ?? null);
    } catch {
      // silent fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(true); }, [load]));

  const handleInvite = useCallback(async () => {
    if (!inviteEmail.trim()) return Alert.alert('Error', 'Email is required.');
    setInviting(true);
    try {
      await apiClient.post('/api/v1/members', {
        email: inviteEmail.trim().toLowerCase(),
        first_name: inviteFirstName.trim() || undefined,
        last_name: inviteLastName.trim() || undefined,
        role: inviteRole,
      });
      setInviteModal(false);
      setInviteEmail(''); setInviteFirstName(''); setInviteLastName('');
      await load(true);
    } catch (err: any) {
      const code = err?.response?.data?.error;
      Alert.alert('Error', code === 'EMAIL_ALREADY_IN_USE' ? 'That email is already in use.' :
        code === 'SEAT_LIMIT_REACHED' ? 'Seat limit reached for your plan.' : 'Failed to invite member.');
    } finally {
      setInviting(false);
    }
  }, [inviteEmail, inviteFirstName, inviteLastName, inviteRole, load]);

  const handleRevoke = useCallback((op: Operator) => {
    Alert.alert('Revoke access', `Remove ${op.name ?? op.email} from your team? They will lose access immediately.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Revoke', style: 'destructive', onPress: async () => {
        try {
          await apiClient.delete(`/api/v1/members/${op.id}`);
          await load(true);
        } catch {
          Alert.alert('Error', 'Failed to revoke access.');
        }
      }},
    ]);
  }, [load]);

  const getOperatorStatus = (opId: number) =>
    statuses.find(s => s.operator_id === opId);

  return (
    <Screen>
      <AppHeader onBack={() => navigation.goBack()} title="Settings" onRefresh={() => void load()} showProfile={false} />

      {/* Top nav */}
      <View style={styles.topNav}>
        {(['team', 'wms', 'preferences'] as SettingsTab[]).map(t => (
          <TouchableOpacity
            key={t}
            style={t === tab ? styles.topNavItemActive : styles.topNavItem}
            onPress={() => setTab(t)}
          >
            <Text style={t === tab ? styles.topNavTextActive : styles.topNavText}>
              {t === 'team' ? 'Team' : t === 'wms' ? 'Warehouse' : 'Preferences'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* ── TEAM ── */}
          {tab === 'team' && (
            <>
              <Row style={styles.summaryRow}>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCount}>{operators.length}</Text>
                  <Text style={styles.summaryLabel}>Members</Text>
                </View>
                <View style={styles.summaryCard}>
                  <Text style={styles.summaryCount}>{statuses.length}</Text>
                  <Text style={styles.summaryLabel}>Active now</Text>
                </View>
              </Row>
              <Divider />

              <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={styles.sectionTitle}>Team members</Text>
                <TouchableOpacity style={styles.inviteBtn} onPress={() => setInviteModal(true)}>
                  <Ionicons name="person-add-outline" size={14} color={colors.bg} />
                  <Text style={styles.inviteBtnText}>Invite</Text>
                </TouchableOpacity>
              </Row>
              {operators.map(op => {
                const status = getOperatorStatus(op.id);
                const statusKey = status?.status ?? 'idle';
                return (
                  <Card key={op.id} style={styles.memberCard}>
                    <Row style={{ alignItems: 'center', gap: spacing.sm }}>
                      {/* Avatar */}
                      <View style={styles.memberAvatar}>
                        <Text style={styles.memberAvatarText}>
                          {(op.name ?? op.email).charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      {/* Name + status */}
                      <View style={{ flex: 1 }}>
                        <Text style={styles.memberName} numberOfLines={1}>
                          {op.name ?? op.email.split('@')[0]}
                        </Text>
                        <Text style={styles.memberEmail} numberOfLines={1}>{op.email}</Text>
                        {status && (
                          <Text style={[styles.memberStatus, { color: STATUS_COLOR[statusKey] }]}>
                            ● {STATUS_LABEL[statusKey]}
                          </Text>
                        )}
                      </View>
                      {/* Role badge */}
                      <Badge label={op.role.toUpperCase()} variant="info" />
                      {/* Actions */}
                      <TouchableOpacity
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                        onPress={() => (navigation as any).navigate('OperatorPerformance', { operatorId: op.id, operatorName: op.name ?? op.email })}
                      >
                        <Ionicons name="bar-chart-outline" size={18} color={colors.accent} />
                      </TouchableOpacity>
                      {op.role !== 'owner' && (
                        <TouchableOpacity
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                          onPress={() => handleRevoke(op)}
                        >
                          <Ionicons name="person-remove-outline" size={18} color={colors.error} />
                        </TouchableOpacity>
                      )}
                    </Row>
                  </Card>
                );
              })}
              {operators.length === 0 && (
                <Text style={styles.emptyText}>No team members yet.</Text>
              )}
            </>
          )}

          {/* ── WAREHOUSE ── */}
          {tab === 'wms' && (
            <>
              <Text style={styles.sectionTitle}>Warehouse settings</Text>
              <Text style={styles.sectionHint}>Configure how your warehouse operations run.</Text>

              <Card style={styles.settingCard}>
                <Text style={styles.settingLabel}>Problem bin location</Text>
                <TextInput
                  style={styles.settingInput}
                  value={wmsSettings?.problem_bin_location ?? ''}
                  placeholder="e.g. WH-1-PROBLEM"
                  placeholderTextColor={colors.ink4}
                  onChangeText={v => setWmsSettings(s => s ? { ...s, problem_bin_location: v } : s)}
                />
                <Text style={styles.settingHint}>Where operators physically place flagged items.</Text>
              </Card>
              <Card style={styles.settingCard}>
                <Text style={styles.settingLabel}>Max batch line items</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(wmsSettings?.max_batch_line_items ?? 108)}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.ink4}
                  onChangeText={v => setWmsSettings(s => s ? { ...s, max_batch_line_items: Number(v) || 108 } : s)}
                />
                <Text style={styles.settingHint}>Maximum line items per pick batch (1–500).</Text>
              </Card>
              <Card style={styles.settingCard}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingLabel}>Auto-release batches</Text>
                    <Text style={styles.settingHint}>Auto-release every {wmsSettings?.auto_release_interval_minutes ?? 30} min.</Text>
                  </View>
                  <Switch
                    value={wmsSettings?.auto_release_enabled ?? false}
                    onValueChange={v => setWmsSettings(s => s ? { ...s, auto_release_enabled: v } : s)}
                    trackColor={{ true: colors.accent, false: colors.bg3 }}
                  />
                </Row>
                {wmsSettings?.auto_release_enabled && (
                  <>
                    <Text style={styles.settingLabel}>Interval (minutes)</Text>
                    <TextInput
                      style={styles.settingInput}
                      value={String(wmsSettings?.auto_release_interval_minutes ?? 30)}
                      keyboardType="number-pad"
                      placeholderTextColor={colors.ink4}
                      onChangeText={v => setWmsSettings(s => s ? { ...s, auto_release_interval_minutes: Number(v) || 30 } : s)}
                    />
                  </>
                )}
              </Card>
              <Card style={styles.settingCard}>
                <Text style={styles.settingLabel}>Idle alert threshold (minutes)</Text>
                <TextInput
                  style={styles.settingInput}
                  value={String(wmsSettings?.idle_alert_threshold_minutes ?? 20)}
                  keyboardType="number-pad"
                  placeholderTextColor={colors.ink4}
                  onChangeText={v => setWmsSettings(s => s ? { ...s, idle_alert_threshold_minutes: Number(v) || 20 } : s)}
                />
                <Text style={styles.settingHint}>Alert when operator inactive for this long (1–480).</Text>
              </Card>

              <TouchableOpacity
                style={styles.saveBtn}
                onPress={async () => {
                  try {
                    await apiClient.patch('/api/v1/wms/settings', {
                      problem_bin_location: wmsSettings?.problem_bin_location,
                      max_batch_line_items: wmsSettings?.max_batch_line_items,
                      auto_release_enabled: wmsSettings?.auto_release_enabled,
                      auto_release_interval_minutes: wmsSettings?.auto_release_interval_minutes,
                      idle_alert_threshold_minutes: wmsSettings?.idle_alert_threshold_minutes,
                    });
                    Alert.alert('Saved', 'Warehouse settings updated.');
                  } catch {
                    Alert.alert('Error', 'Failed to save settings.');
                  }
                }}
              >
                <Text style={styles.saveBtnText}>Save changes</Text>
              </TouchableOpacity>
            </>
          )}

          {/* ── PREFERENCES ── */}
          {tab === 'preferences' && (
            <>
              <Text style={styles.sectionTitle}>Notifications</Text>

              <Card style={styles.settingCard}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingLabel}>Push notifications</Text>
                    <Text style={styles.settingHint}>Receive alerts on this device.</Text>
                  </View>
                  <Switch
                    value={notificationsEnabled}
                    onValueChange={setNotificationsEnabled}
                    trackColor={{ true: colors.accent, false: colors.bg3 }}
                  />
                </Row>
              </Card>

              <Card style={styles.settingCard}>
                <Text style={styles.settingLabel}>Alert tone</Text>
                <Row style={styles.toneRow}>
                  {(['urgent', 'standard', 'silent'] as const).map(tone => (
                    <TouchableOpacity
                      key={tone}
                      style={[styles.toneChip, alertTone === tone && styles.toneChipActive]}
                      onPress={() => setAlertTone(tone)}
                    >
                      <Text style={[styles.toneChipText, alertTone === tone && styles.toneChipTextActive]}>
                        {tone.charAt(0).toUpperCase() + tone.slice(1)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </Row>
              </Card>

              <Text style={styles.sectionTitle}>Alert types</Text>

              {[
                { key: 'exceptions', label: 'Exceptions & problems', icon: 'warning-outline' },
                { key: 'idle', label: 'Operator idle alerts', icon: 'timer-outline' },
                { key: 'batchReady', label: 'Batch ready to pack', icon: 'cube-outline' },
                { key: 'shipmentReady', label: 'Shipment ready', icon: 'airplane-outline' },
              ].map(({ key, label, icon }) => (
                <Card key={key} style={styles.settingCard}>
                  <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                    <Row style={{ gap: spacing.md, flex: 1, alignItems: 'center' }}>
                      <Ionicons name={icon as any} size={20} color={colors.ink3} />
                      <Text style={styles.settingLabel}>{label}</Text>
                    </Row>
                    <Switch
                      value={alertTypes[key as keyof typeof alertTypes]}
                      onValueChange={(val) => setAlertTypes(prev => ({ ...prev, [key]: val }))}
                      trackColor={{ true: colors.accent, false: colors.bg3 }}
                    />
                  </Row>
                </Card>
              ))}

              <Divider />

              <Card style={styles.settingCard}>
                <Text style={styles.settingLabel}>App version</Text>
                <Text style={styles.settingValue}>1.0.0</Text>
              </Card>

              <Text style={styles.comingSoon}>
                Preferences sync to cloud — coming soon
              </Text>
            </>
          )}
        </ScrollView>
      )}

      {/* Invite Member Modal */}
      <Modal visible={inviteModal} transparent animationType="slide" onRequestClose={() => setInviteModal(false)}>
        <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setInviteModal(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.modalTitle}>Invite team member</Text>
          <TextInput
            style={styles.input}
            placeholder="Email address *"
            placeholderTextColor={colors.ink4}
            keyboardType="email-address"
            autoCapitalize="none"
            value={inviteEmail}
            onChangeText={setInviteEmail}
          />
          <TextInput
            style={styles.input}
            placeholder="First name"
            placeholderTextColor={colors.ink4}
            value={inviteFirstName}
            onChangeText={setInviteFirstName}
          />
          <TextInput
            style={styles.input}
            placeholder="Last name"
            placeholderTextColor={colors.ink4}
            value={inviteLastName}
            onChangeText={setInviteLastName}
          />
          <Text style={styles.inputLabel}>Role</Text>
          <Row style={{ gap: spacing.sm, marginBottom: spacing.md }}>
            {(['operator', 'admin'] as const).map(r => (
              <TouchableOpacity
                key={r}
                style={[styles.roleChip, inviteRole === r && styles.roleChipActive]}
                onPress={() => setInviteRole(r)}
              >
                <Text style={[styles.roleChipText, inviteRole === r && styles.roleChipTextActive]}>
                  {r.charAt(0).toUpperCase() + r.slice(1)}
                </Text>
              </TouchableOpacity>
            ))}
          </Row>
          <TouchableOpacity
            style={[styles.inviteSubmitBtn, inviting && { opacity: 0.6 }]}
            onPress={() => void handleInvite()}
            disabled={inviting}
          >
            <Text style={styles.inviteSubmitText}>{inviting ? 'Sending invite…' : 'Send invite'}</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </Screen>
  );
}

const styles = StyleSheet.create({
  topNav: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.rule,
  },
  topNavItem: {
    flex: 1, paddingVertical: spacing.sm,
    alignItems: 'center', borderRadius: radius.sm,
    backgroundColor: colors.bg2,
  },
  topNavItemActive: {
    flex: 1, paddingVertical: spacing.sm,
    alignItems: 'center', borderRadius: radius.sm,
    backgroundColor: colors.accent,
  },
  topNavText: { color: colors.ink3, fontSize: font.size.xs, fontWeight: font.weight.medium },
  topNavTextActive: { color: colors.bg, fontSize: font.size.xs, fontWeight: font.weight.bold },
  content: { padding: spacing.lg, paddingBottom: 100, gap: spacing.md },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: spacing.xl, gap: spacing.md },
  summaryRow: { gap: spacing.md },
  summaryCard: {
    flex: 1, backgroundColor: colors.bg2, borderRadius: radius.md,
    padding: spacing.md, alignItems: 'center', gap: spacing.xs,
    borderWidth: 1, borderColor: colors.rule,
  },
  summaryCount: { color: colors.accent, fontSize: font.size.xl, fontWeight: font.weight.bold },
  summaryLabel: { color: colors.ink3, fontSize: font.size.xs },
  sectionTitle: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold },
  sectionHint: { color: colors.ink3, fontSize: font.size.sm, marginTop: -spacing.xs },
  memberCard: { gap: spacing.xs },
  memberAvatar: {
    width: 40, height: 40, borderRadius: 20,
    backgroundColor: colors.accentGhost,
    borderWidth: 1, borderColor: colors.accentBorder,
    justifyContent: 'center', alignItems: 'center',
  },
  memberAvatarText: { color: colors.accent, fontSize: font.size.md, fontWeight: font.weight.bold },
  memberName: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold },
  memberEmail: { color: colors.ink3, fontSize: font.size.sm },
  memberStatus: { fontSize: font.size.sm, marginLeft: 40 + spacing.md },
  statusDot: { width: 8, height: 8, borderRadius: 4 },
  settingCard: { gap: spacing.xs },
  settingLabel: { color: colors.ink, fontSize: font.size.md, fontWeight: font.weight.semibold },
  settingValue: { color: colors.accent, fontSize: font.size.lg, fontWeight: font.weight.bold },
  settingHint: { color: colors.ink3, fontSize: font.size.sm },
  toneRow: { gap: spacing.sm, marginTop: spacing.xs },
  toneChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs,
    borderRadius: radius.sm, backgroundColor: colors.bg3,
    borderWidth: 1, borderColor: colors.rule,
  },
  toneChipActive: { borderColor: colors.accent, backgroundColor: colors.accentGhost },
  toneChipText: { color: colors.ink3, fontSize: font.size.sm },
  toneChipTextActive: { color: colors.accent, fontWeight: font.weight.semibold },
  comingSoon: { color: colors.ink4, fontSize: font.size.sm, textAlign: 'center', paddingVertical: spacing.md },
  emptyText: { color: colors.ink3, fontSize: font.size.sm, textAlign: 'center', paddingVertical: spacing.md },
  inviteBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, backgroundColor: colors.accent, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
    inviteBtnText: { color: colors.bg, fontSize: font.size.xs, fontWeight: font.weight.semibold },
    modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
    modalSheet: { backgroundColor: colors.bg2, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
    sheetHandle: { width: 40, height: 4, backgroundColor: colors.bg3, borderRadius: 2, alignSelf: 'center', marginBottom: spacing.sm },
    modalTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold, marginBottom: spacing.xs },
    input: { backgroundColor: colors.bg3, borderRadius: radius.sm, padding: spacing.md, color: colors.ink, fontSize: font.size.sm },
    inputLabel: { color: colors.ink3, fontSize: font.size.xs, fontWeight: font.weight.medium },
    roleChip: { flex: 1, padding: spacing.sm, borderRadius: radius.sm, backgroundColor: colors.bg3, alignItems: 'center', borderWidth: 1, borderColor: 'transparent' },
    roleChipActive: { borderColor: colors.accent, backgroundColor: colors.accentGhost },
    roleChipText: { color: colors.ink3, fontSize: font.size.sm },
    roleChipTextActive: { color: colors.accent, fontWeight: font.weight.semibold },
    inviteSubmitBtn: { backgroundColor: colors.accent, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center' },
    inviteSubmitText: { color: colors.bg, fontSize: font.size.sm, fontWeight: font.weight.bold },
    settingInput: { backgroundColor: colors.bg3, borderRadius: radius.sm, padding: spacing.sm, color: colors.ink, fontSize: font.size.sm, marginTop: spacing.xs },
    saveBtn: { backgroundColor: colors.accent, borderRadius: radius.sm, padding: spacing.md, alignItems: 'center', marginTop: spacing.xs },
    saveBtnText: { color: colors.bg, fontSize: font.size.sm, fontWeight: font.weight.bold },
});