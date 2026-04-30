// apps/mobile/src/screens/OwnerSettingsScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, ActivityIndicator, Switch,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
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
  const [tab, setTab] = useState<SettingsTab>('team');
  const [operators, setOperators] = useState<Operator[]>([]);
  const [statuses, setStatuses] = useState<OperatorStatus[]>([]);
  const [wmsSettings, setWmsSettings] = useState<WmsSettings | null>(null);
  const [loading, setLoading] = useState(true);

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

  const getOperatorStatus = (opId: number) =>
    statuses.find(s => s.operator_id === opId);

  return (
    <Screen>
      <AppHeader showLogo onRefresh={() => void load()} />

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

              <Text style={styles.sectionTitle}>Team members</Text>
              {operators.map(op => {
                const status = getOperatorStatus(op.id);
                const statusKey = status?.status ?? 'idle';
                return (
                  <Card key={op.id} style={styles.memberCard}>
                    <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                      <View style={styles.memberAvatar}>
                        <Text style={styles.memberAvatarText}>
                          {(op.name ?? op.email).charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <View style={{ flex: 1, marginLeft: spacing.md }}>
                        <Text style={styles.memberName}>
                          {op.name ?? op.email.split('@')[0]}
                        </Text>
                        <Text style={styles.memberEmail}>{op.email}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end', gap: spacing.xs }}>
                        <Badge label={op.role.toUpperCase()} variant="info" />
                        <View style={[styles.statusDot, { backgroundColor: STATUS_COLOR[statusKey] }]} />
                      </View>
                    </Row>
                    {status && (
                      <Text style={[styles.memberStatus, { color: STATUS_COLOR[statusKey] }]}>
                        ● {STATUS_LABEL[statusKey]} — {status.current_task}
                      </Text>
                    )}
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
                <Text style={styles.settingValue}>
                  {wmsSettings?.problem_bin_location ?? 'Not configured'}
                </Text>
                <Text style={styles.settingHint}>
                  Where operators physically place flagged items.
                </Text>
              </Card>

              <Card style={styles.settingCard}>
                <Text style={styles.settingLabel}>Max batch line items</Text>
                <Text style={styles.settingValue}>
                  {wmsSettings?.max_batch_line_items ?? 108}
                </Text>
                <Text style={styles.settingHint}>Maximum line items per pick batch.</Text>
              </Card>

              <Card style={styles.settingCard}>
                <Row style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.settingLabel}>Auto-release batches</Text>
                    <Text style={styles.settingHint}>
                      Auto-release every {wmsSettings?.auto_release_interval_minutes ?? 30} min.
                    </Text>
                  </View>
                  <Switch
                    value={wmsSettings?.auto_release_enabled ?? false}
                    disabled
                    trackColor={{ true: colors.accent, false: colors.bg3 }}
                  />
                </Row>
              </Card>

              <Card style={styles.settingCard}>
                <Text style={styles.settingLabel}>Idle alert threshold</Text>
                <Text style={styles.settingValue}>
                  {wmsSettings?.idle_alert_threshold_minutes ?? 20} min
                </Text>
                <Text style={styles.settingHint}>
                  Alert when operator is inactive for this long.
                </Text>
              </Card>

              <Text style={styles.comingSoon}>✎ Editing coming soon</Text>
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
});