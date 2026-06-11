// apps/mobile/App.tsx
import { useState, useCallback, useEffect, useRef } from 'react';
import { AppHeader, Screen } from './src/ui';
import {
  NavigationContainer,
  useFocusEffect,
  useNavigation,
  createNavigationContainerRef,
  CommonActions,
} from '@react-navigation/native';
import {
  View, Text, StyleSheet, TouchableOpacity, ActivityIndicator,
  ScrollView,
} from 'react-native';
import * as Notifications from 'expo-notifications';

import { apiClient } from '@lasyncro/mobile-core';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { colors, font, radius, spacing } from './src/theme';

// Screens
import LoginScreen from './src/screens/LoginScreen';
import TaskListScreen from './src/screens/TaskListScreen';
import AvailabilityScreen from './src/screens/AvailabilityScreen';
import PickBriefScreen from './src/screens/PickBriefScreen';
import ReceiveJobScreen from './src/screens/ReceiveJobScreen';
import StowScreen from './src/screens/StowScreen';
import OverviewScreen from './src/screens/OverviewScreen';
import DispatchScreen from './src/screens/DispatchScreen';
import ScannerScreen from './src/screens/ScannerScreen';
import OwnerSettingsScreen from './src/screens/OwnerSettingsScreen';
import OperatorSettingsScreen from './src/screens/OperatorSettingsScreen';
import OperatorProblemCenterScreen from './src/screens/OperatorProblemCenterScreen';
import OperatorPerformanceScreen from './src/screens/OperatorPerformanceScreen';
import IntelligenceScreen from './src/intelligence/IntelligenceScreen';

import { usePushRegistration } from './src/hooks/usePushRegistration';
import { useForegroundToast } from './src/hooks/useForegroundToast';

// ─── Notification handler (foreground display) — must be set at module level ─
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: false, // we show our own non-blocking toast (§4)
    shouldShowList:   false,
    shouldPlaySound:  false,
    shouldSetBadge:   false,
  }),
});

// ─── Navigation ref — enables out-of-component navigation on tap ──────────────
export const navigationRef = createNavigationContainerRef();

// ─── Deep link helper — routes notification tap to the correct Brief ──────────
function handleNotificationTap(
  data: Record<string, unknown>,
  role: string | null
): void {
  if (!navigationRef.isReady()) return;

  const screen = data.screen as string | undefined;
  const taskId = (data.taskId ?? data.batchId ?? data.jobId) as string | undefined;
  const title  = (data.title  ?? '')                          as string;
  const type   = (data.type   ?? screen?.toLowerCase() ?? 'pick') as string;

  if (!screen || !taskId) return;

  const task = { id: taskId, title, type };

  // Operator: Home tab → TaskStack → Brief screen
  // Owner/admin: no task deep link (they don't pick/stow/receive)
  const isOperator = role !== 'owner' && role !== 'admin';
  if (!isOperator) return;

  const targetScreen =
    screen === 'PickBrief'  ? 'PickBrief'  :
    screen === 'ReceiveJob' ? 'ReceiveJob' :
    screen === 'Stow'       ? 'Stow'       : null;

  if (!targetScreen) return;

  navigationRef.dispatch(
    CommonActions.navigate('OperatorTabs', {
      screen: 'Home',
      params: {
        screen: targetScreen,
        params: { task },
      },
    })
  );
}

// ─── Tab icon ─────────────────────────────────────────────────────────────────
function TabIcon({ name, focused }: { name: keyof typeof Ionicons.glyphMap; focused: boolean }) {
  return (
    <Ionicons name={name} size={22} color={focused ? colors.accent : colors.ink4} />
  );
}

// ─── Alert feed ───────────────────────────────────────────────────────────────
interface AlertItem {
  id:             string;
  alert_type:     string;
  severity:       'critical' | 'warning' | 'info';
  title:          string;
  message:        string;
  revenue_impact: number | null;
  created_at:     string;
  is_active:      boolean;
}

function AlertFeed({
  title, emptyMessage, showBack,
}: {
  title: string; emptyMessage: string; showBack?: boolean;
}) {
  const [alerts, setAlerts]   = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const navigation            = useNavigation<any>();

  const navigateToModule = useCallback((alertType: string) => {
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
    const parent = navigation.getParent() ?? navigation;
    if (alertType.startsWith('wms_')) {
      parent.navigate('OwnerTabs', {
        screen: 'Tasks',
        params: { initialTab: WMS_TAB_MAP[alertType] ?? 'inbound' },
      });
    } else if (alertType === 'stockout_risk' || alertType === 'sla_breach' || alertType === 'operational') {
      parent.navigate('OwnerTabs', {
        screen: 'Tasks',
        params: { initialTab: alertType === 'stockout_risk' ? 'inbound' : 'outbound' },
      });
    } else {
      parent.navigate('OwnerTabs', { screen: 'Intelligence' });
    }
  }, [navigation]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await apiClient.get('/api/v1/alerts?active_only=true&limit=50');
      setAlerts(data.data ?? []);
    } catch {
      setAlerts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <Screen>
      <AppHeader showLogo={!showBack} onBack={showBack ? () => navigation.goBack() : undefined} />
      <ScrollView
        contentContainerStyle={alertStyles.container}
        showsVerticalScrollIndicator={false}
      >
        <Text style={alertStyles.heading}>{title}</Text>
        {loading ? (
          <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.xl }} />
        ) : alerts.length === 0 ? (
          <View style={alertStyles.empty}>
            <Ionicons name="checkmark-circle-outline" size={48} color={colors.success} />
            <Text style={alertStyles.emptyText}>{emptyMessage}</Text>
          </View>
        ) : (
          alerts.map(alert => (
            <TouchableOpacity
              key={alert.id}
              onPress={() => navigateToModule(alert.alert_type)}
              activeOpacity={0.7}
            >
              <View style={[
                alertStyles.card,
                alert.severity === 'critical' && alertStyles.cardCritical,
              ]}>
                <View style={alertStyles.cardHeader}>
                  <Text style={alertStyles.cardTitle} numberOfLines={2}>{alert.title}</Text>
                  <View style={[alertStyles.badge, alertStyles[`badge_${alert.severity}`]]}>
                    <Text style={alertStyles.badgeText}>{alert.severity.toUpperCase()}</Text>
                  </View>
                </View>
                <Text style={alertStyles.cardMessage}>{alert.message}</Text>
                {alert.revenue_impact != null && (
                  <Text style={alertStyles.revenueImpact}>
                    ${alert.revenue_impact.toLocaleString()} at risk
                  </Text>
                )}
              </View>
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const alertStyles = StyleSheet.create({
  container:    { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  heading:      { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.xs },
  empty:        { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  emptyText:    { color: colors.ink3, fontSize: font.size.sm, textAlign: 'center' },
  card:         {
    backgroundColor: colors.bg2, borderRadius: radius.md, padding: spacing.md,
    gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.ink3,
  },
  cardCritical: { borderLeftColor: colors.error },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle:    { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, flex: 1 },
  cardMessage:  { color: colors.ink3, fontSize: font.size.sm },
  revenueImpact:{ color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },
  badge:        { borderRadius: radius.sm, paddingHorizontal: spacing.xs, paddingVertical: 2 },
  badge_critical: { backgroundColor: colors.error },
  badge_warning:  { backgroundColor: colors.warning },
  badge_info:     { backgroundColor: colors.info },
  badgeText:    { color: colors.bg, fontSize: 10, fontWeight: font.weight.bold },
});

// ─── Placeholder screens ──────────────────────────────────────────────────────
function NotificationsScreen() {
  return <AlertFeed title="Notifications" emptyMessage="No alerts for your account." />;
}
function AlertsScreen() {
  return <AlertFeed title="Alerts" emptyMessage="No alerts to review." showBack />;
}

// ─── Task stack ───────────────────────────────────────────────────────────────
const TaskStack = createNativeStackNavigator();
function TaskStackNavigator() {
  return (
    <TaskStack.Navigator screenOptions={{ headerShown: false }}>
      <TaskStack.Screen name="TaskList"   component={TaskListScreen}   />
      <TaskStack.Screen name="PickBrief"  component={PickBriefScreen}  />
      <TaskStack.Screen name="ReceiveJob" component={ReceiveJobScreen} />
      <TaskStack.Screen name="Stow"       component={StowScreen}       />
    </TaskStack.Navigator>
  );
}

// ─── Tab bar options ──────────────────────────────────────────────────────────
const tabBarStyle = (bottomInset: number) => ({
  backgroundColor: colors.bg2,
  borderTopColor:  colors.rule,
  borderTopWidth:  1,
  height:          60 + bottomInset,
  paddingBottom:   bottomInset + spacing.xs,
  paddingTop:      spacing.xs,
});

// ─── Operator root ────────────────────────────────────────────────────────────
const OperatorRootStack = createNativeStackNavigator();
function OperatorRoot() {
  return (
    <OperatorRootStack.Navigator screenOptions={{ headerShown: false }}>
      <OperatorRootStack.Screen name="OperatorTabs" component={OperatorTabs} />
      <OperatorRootStack.Screen name="Settings"     component={OperatorSettingsScreen} />
    </OperatorRootStack.Navigator>
  );
}

// ─── Operator tabs — §10.3 IA ─────────────────────────────────────────────────
// [Reserved] "Today" owner tab — 5th root, NOT rendered yet. Add here at MOB-TODAY-01.
const OperatorTab = createBottomTabNavigator();
function OperatorTabs() {
  const insets = useSafeAreaInsets();
  return (
    <OperatorTab.Navigator
      screenOptions={{
        headerShown:             false,
        tabBarStyle:             tabBarStyle(insets.bottom),
        tabBarActiveTintColor:   colors.accent,
        tabBarInactiveTintColor: colors.ink4,
        tabBarLabelStyle:        styles.tabLabel,
      }}
    >
      <OperatorTab.Screen
        name="Home"
        component={TaskStackNavigator}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="home-outline" focused={focused} />,
          tabBarLabel: 'Home',
        }}
      />
      <OperatorTab.Screen
        name="Problems"
        component={OperatorProblemCenterScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="warning-outline" focused={focused} />,
          tabBarLabel: 'Problems',
        }}
      />
      <OperatorTab.Screen
        name="Scan"
        component={ScannerScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="scan-outline" focused={focused} />,
          tabBarLabel: 'Scan',
        }}
      />
      <OperatorTab.Screen
        name="Me"
        component={AvailabilityScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="person-outline" focused={focused} />,
          tabBarLabel: 'Me',
        }}
      />
    </OperatorTab.Navigator>
  );
}

// ─── Owner root ───────────────────────────────────────────────────────────────
const OwnerRootStack = createNativeStackNavigator();
function OwnerRoot() {
  return (
    <OwnerRootStack.Navigator screenOptions={{ headerShown: false }}>
      <OwnerRootStack.Screen name="OwnerTabs"            component={OwnerTabs}                />
      <OwnerRootStack.Screen name="Settings"             component={OwnerSettingsScreen}      />
      <OwnerRootStack.Screen name="OperatorPerformance"  component={OperatorPerformanceScreen} />
      <OwnerRootStack.Screen name="AlertsInbox"          component={AlertsScreen}             />
    </OwnerRootStack.Navigator>
  );
}

// ─── Owner tabs ───────────────────────────────────────────────────────────────
const OwnerTab = createBottomTabNavigator();
function OwnerTabs() {
  const insets = useSafeAreaInsets();
  return (
    <OwnerTab.Navigator
      screenOptions={{
        headerShown:             false,
        tabBarStyle:             tabBarStyle(insets.bottom),
        tabBarActiveTintColor:   colors.accent,
        tabBarInactiveTintColor: colors.ink4,
        tabBarLabelStyle:        styles.tabLabel,
      }}
    >
      <OwnerTab.Screen
        name="Overview"
        component={OverviewScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="stats-chart-outline" focused={focused} />,
          tabBarLabel: 'Overview',
        }}
      />
      <OwnerTab.Screen
        name="Tasks"
        component={DispatchScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="rocket-outline" focused={focused} />,
          tabBarLabel: 'Tasks',
        }}
      />
      <OwnerTab.Screen
        name="Intelligence"
        component={IntelligenceScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="pulse-outline" focused={focused} />,
          tabBarLabel: 'Intelligence',
        }}
      />
      <OwnerTab.Screen
        name="Scanner"
        component={ScannerScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="scan-outline" focused={focused} />,
          tabBarLabel: 'Scanner',
        }}
      />
    </OwnerTab.Navigator>
  );
}

// ─── AppInner ─────────────────────────────────────────────────────────────────
function AppInner() {
  const { isAuthenticated, isLoading, error, login, role } = useAuth();
  const { toast, show: showToast } = useForegroundToast();

  // Push token registration (MOB-PUSH-01)
  usePushRegistration(isAuthenticated);

  // Notification listeners (MOB-PUSH-01)
  useEffect(() => {
    // Foreground received — show non-blocking toast (§4: never navigate away)
    const receivedSub = Notifications.addNotificationReceivedListener(notification => {
      const title = notification.request.content.title ?? 'New task';
      const body  = notification.request.content.body  ?? '';
      showToast(title, body);
    });

    // Background/killed tap — deep link to Brief (§4)
    const responseSub = Notifications.addNotificationResponseReceivedListener(response => {
      const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
      handleNotificationTap(data, role ?? null);
    });

    return () => {
      receivedSub.remove();
      responseSub.remove();
    };
  }, [role, showToast]);

  // Cold-start tap — notification that launched the app
  useEffect(() => {
    void (async () => {
      const response = await Notifications.getLastNotificationResponseAsync();
      if (response && isAuthenticated) {
        const data = (response.notification.request.content.data ?? {}) as Record<string, unknown>;
        // Delay to allow navigator to mount
        setTimeout(() => handleNotificationTap(data, role ?? null), 500);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  if (isLoading) {
    return (
      <SafeAreaProvider>
        <View style={styles.splash}>
          <StatusBar style="light" />
        </View>
      </SafeAreaProvider>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaProvider>
        <StatusBar style="light" />
        <LoginScreen onLogin={login} error={error} />
      </SafeAreaProvider>
    );
  }

  const isOwnerOrAdmin = role === 'owner' || role === 'admin';

  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <NavigationContainer ref={navigationRef}>
        {isOwnerOrAdmin ? <OwnerRoot /> : <OperatorRoot />}
      </NavigationContainer>
      {/* Foreground notification toast — §4: non-blocking, never interrupts scan */}
      {toast && (
        <View style={styles.toast} pointerEvents="none">
          <Ionicons name="notifications-outline" size={14} color={colors.bg} />
          <View style={{ flex: 1 }}>
            <Text style={styles.toastTitle} numberOfLines={1}>{toast.title}</Text>
            {toast.body ? (
              <Text style={styles.toastBody} numberOfLines={1}>{toast.body}</Text>
            ) : null}
          </View>
        </View>
      )}
    </SafeAreaProvider>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────
export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  splash: {
    flex: 1, backgroundColor: colors.bg,
    justifyContent: 'center', alignItems: 'center',
  },
  tabLabel: {
    fontSize: font.size.xs, fontWeight: font.weight.medium,
  },
  toast: {
    position: 'absolute', top: 52, left: spacing.md, right: spacing.md,
    backgroundColor: colors.ink,
    borderRadius: radius.md,
    padding: spacing.md,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25, shadowRadius: 4, elevation: 8,
  },
  toastTitle: {
    color: colors.bg, fontSize: font.size.sm, fontWeight: font.weight.semibold,
  },
  toastBody: {
    color: colors.ink3, fontSize: font.size.xs, marginTop: 1,
  },
});