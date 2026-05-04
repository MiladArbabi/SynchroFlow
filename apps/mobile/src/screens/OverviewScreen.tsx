// apps/mobile/src/screens/OverviewScreen.tsx
import { useEffect, useState, useCallback } from 'react';
import { useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Screen, AppHeader, Card, Badge } from '../ui';
import { colors, font, spacing, radius } from '../theme';
import { apiClient } from '@lasyncro/mobile-core';

interface BriefSignal {
  id: string;
  alertType: string;
  priority: 1 | 2 | 3 | 4 | 5;
  title: string;
  detail: string;
  module: string;
  deepLink: string;
  revenueImpact: number | null;
}

interface MorningBrief {
  signals: BriefSignal[];
  hasUrgentIssues: boolean;
  generatedAt: string;
  greeting: string;
  summaryLine: string;
}

function signalVariant(priority: number): 'error' | 'warning' | 'info' {
  if (priority <= 2) return 'error';
  if (priority <= 4) return 'warning';
  return 'info';
}

export default function OverviewScreen() {
  const navigation = useNavigation<any>();

  const [brief, setBrief] = useState<MorningBrief | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const navigateToModule = useCallback((module: string, alertType: string) => {
    const WMS_TAB_MAP: Record<string, 'inbound' | 'outbound' | 'exceptions'> = {
      wms_receive_arrived:     'inbound',
      wms_stow_pending:        'inbound',
      wms_supplier_rating:     'inbound',
      wms_batch_ready_to_pack: 'outbound',
      wms_batch_ready_to_ship: 'outbound',
      wms_batch_released:      'outbound',
      wms_receive_exception:   'exceptions',
      wms_pick_exception:      'exceptions',
      wms_pack_exception:      'exceptions',
      wms_stow_exception:      'exceptions',
    };
    switch (module) {
      case 'wms': {
        const parent = navigation.getParent() ?? navigation;
        parent.navigate('OwnerTabs', { screen: 'Tasks', params: { initialTab: WMS_TAB_MAP[alertType] ?? 'inbound' } });
        break;
      }
      case 'order-nexus': {
        const p = navigation.getParent() ?? navigation;
        p.navigate('OwnerTabs', { screen: 'Tasks', params: { initialTab: 'outbound' } });
        break;
      }
      default: {
        const p = navigation.getParent() ?? navigation;
        p.navigate('OwnerTabs', { screen: 'Alerts' });
      }
    }
  }, [navigation]);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const { data } = await apiClient.get(`/api/v1/modules/overview/morning-brief${force ? '?force=true' : ''}`);
      setBrief(data ?? null);
    } catch {
      setError('Failed to load morning brief.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(true); }, [load]));

  return (
    <Screen>
      <AppHeader showLogo onRefresh={() => void load(true)} />
      <ScrollView contentContainerStyle={styles.container} showsVerticalScrollIndicator={false}>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : error ? (
          <View style={styles.center}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.error} />
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity onPress={() => void load()}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : !brief ? (
          <View style={styles.center}>
            <Ionicons name="partly-sunny-outline" size={48} color={colors.ink3} />
            <Text style={styles.emptyTitle}>No brief available</Text>
            <Text style={styles.emptySubtitle}>Check back once your store data has synced.</Text>
          </View>
        ) : (
          <>
            {/* Greeting */}
            <View style={styles.greetingBlock}>
              <Text style={styles.greeting}>{brief.greeting}</Text>
              <Text style={styles.summaryLine}>{brief.summaryLine}</Text>
              <Text style={styles.generatedAt}>
                Updated {new Date(brief.generatedAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>

            {/* Signals */}
            {brief.signals.length === 0 ? (
              <View style={styles.center}>
                <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
                <Text style={styles.emptyTitle}>All clear</Text>
                <Text style={styles.emptySubtitle}>No issues to review today.</Text>
              </View>
            ) : (
              <>
                <Text style={styles.sectionTitle}>
                  {brief.hasUrgentIssues ? '⚠️ Needs attention' : 'To review'}
                </Text>
                {brief.signals.map(signal => (<TouchableOpacity key={signal.id} onPress={() => navigateToModule(signal.module, signal.alertType)} activeOpacity={0.7}>
                  <Card style={styles.signalCard}>
                    <View style={styles.signalHeader}>
                      <Text style={styles.signalTitle} numberOfLines={1}>{signal.title}</Text>
                      <Badge
                        label={`P${signal.priority}`}
                        variant={signalVariant(signal.priority)}
                      />
                    </View>
                    <Text style={styles.signalDetail}>{signal.detail}</Text>
                    {signal.revenueImpact != null && (
                      <Text style={styles.revenueImpact}>
                        ${signal.revenueImpact.toLocaleString()} at risk
                      </Text>
                    )}
                  </Card>
                  </TouchableOpacity>
                ))}
              </>
            )}
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  greetingBlock: { gap: spacing.xs, paddingBottom: spacing.sm },
  greeting: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold },
  summaryLine: { color: colors.ink2, fontSize: font.size.md },
  generatedAt: { color: colors.ink4, fontSize: font.size.xs, marginTop: spacing.xs },
  refreshRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xs },
  refreshText: { color: colors.ink3, fontSize: font.size.xs },
  sectionTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, marginBottom: spacing.xs },
  signalCard: { gap: spacing.xs },
  signalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  signalTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, flex: 1 },
  signalDetail: { color: colors.ink3, fontSize: font.size.sm },
  revenueImpact: { color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },
  center: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  errorText: { color: colors.error, fontSize: font.size.sm },
  retryText: { color: colors.accent, fontSize: font.size.sm, fontWeight: font.weight.semibold },
  emptyTitle: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold },
  emptySubtitle: { color: colors.ink3, fontSize: font.size.sm, textAlign: 'center' },
});