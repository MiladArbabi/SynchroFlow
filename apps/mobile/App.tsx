// apps/mobile/App.tsx
import { useState, useCallback } from 'react';
import { AppHeader, Screen } from './src/ui';
import { NavigationContainer, useFocusEffect, useNavigation } from '@react-navigation/native';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';

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
import ScanScreen from './src/screens/ScanScreen';
import PickBriefScreen from './src/screens/PickBriefScreen';
import ReceiveJobScreen from './src/screens/ReceiveJobScreen';
import StowScreen from './src/screens/StowScreen';
import PackScreen from './src/screens/PackScreen';
import OverviewScreen from './src/screens/OverviewScreen';
import DispatchScreen from './src/screens/DispatchScreen';
import ScannerScreen from './src/screens/ScannerScreen';

import OwnerSettingsScreen from './src/screens/OwnerSettingsScreen';
import OperatorSettingsScreen from './src/screens/OperatorSettingsScreen';
import OperatorPerformanceScreen from './src/screens/OperatorPerformanceScreen';

// ─── Tab icon ────────────────────────────────────────────────────────────────
function TabIcon({ name, focused }: { name: keyof typeof Ionicons.glyphMap; focused: boolean }) {
  return (
    <Ionicons
      name={name}
      size={22}
      color={focused ? colors.accent : colors.ink4}
    />
  );
}

// ─── Alert feed (shared by Operator Notifications + Owner Alerts tabs) ────────
interface AlertItem {
  id: string;
  alert_type: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  revenue_impact: number | null;
  created_at: string;
  is_active: boolean;
}

function AlertFeed({ title, emptyMessage }: { title: string; emptyMessage: string }) {
  const [alerts, setAlerts] = useState<AlertItem[]>([]);
  const [loading, setLoading] = useState(true);
  const navigation = useNavigation<any>();

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
    if (alertType.startsWith('wms_')) {
      // Navigate via parent (root stack) to correctly pass params to nested tab
      const parent = navigation.getParent() ?? navigation;
      parent.navigate('OwnerTabs', { screen: 'Tasks', params: { initialTab: WMS_TAB_MAP[alertType] ?? 'inbound' } });
    } else {
      navigation.navigate('OwnerTabs', { screen: 'Alerts' });
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
      <AppHeader showLogo />
      <ScrollView contentContainerStyle={alertStyles.container} showsVerticalScrollIndicator={false}>
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
            <TouchableOpacity key={alert.id} onPress={() => navigateToModule(alert.alert_type)} activeOpacity={0.7}>
            <View style={[alertStyles.card, alert.severity === 'critical' && alertStyles.cardCritical]}>
              <View style={alertStyles.cardHeader}>
                <Text style={alertStyles.cardTitle} numberOfLines={2}>{alert.title}</Text>
                <View style={[alertStyles.badge, alertStyles[`badge_${alert.severity}`]]}>
                  <Text style={alertStyles.badgeText}>{alert.severity.toUpperCase()}</Text>
                </View>
              </View>
              <Text style={alertStyles.cardMessage}>{alert.message}</Text>
              {alert.revenue_impact != null && (
                <Text style={alertStyles.revenueImpact}>${alert.revenue_impact.toLocaleString()} at risk</Text>
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
  container: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl },
  heading: { color: colors.ink, fontSize: font.size.xl, fontWeight: font.weight.bold, marginBottom: spacing.xs },
  empty: { alignItems: 'center', gap: spacing.sm, paddingTop: spacing.xl },
  emptyText: { color: colors.ink3, fontSize: font.size.sm, textAlign: 'center' },
  card: { backgroundColor: colors.bg2, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs, borderLeftWidth: 3, borderLeftColor: colors.ink3 },
  cardCritical: { borderLeftColor: colors.error },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: spacing.sm },
  cardTitle: { color: colors.ink, fontSize: font.size.sm, fontWeight: font.weight.semibold, flex: 1 },
  cardMessage: { color: colors.ink3, fontSize: font.size.sm },
  revenueImpact: { color: colors.error, fontSize: font.size.xs, fontWeight: font.weight.semibold },
  badge: { borderRadius: radius.sm, paddingHorizontal: spacing.xs, paddingVertical: 2 },
  badge_critical: { backgroundColor: colors.error },
  badge_warning: { backgroundColor: colors.warning },
  badge_info: { backgroundColor: colors.info },
  badgeText: { color: colors.bg, fontSize: 10, fontWeight: font.weight.bold },
});

// ─── Placeholder screens ──────────────────────────────────────────────────────
function NotificationsScreen() {
  return <AlertFeed title="Notifications" emptyMessage="No alerts for your account." />;
}

function AlertsScreen() {
  return <AlertFeed title="Alerts" emptyMessage="No alerts to review." />;
}
const placeholder = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg, justifyContent: 'center', alignItems: 'center', padding: spacing.xl },
  title: { color: colors.ink, fontSize: font.size.lg, fontWeight: font.weight.bold, marginBottom: spacing.xs },
  sub: { color: colors.ink3, fontSize: font.size.sm, textAlign: 'center' },
});

// ─── Task stack (shared) ──────────────────────────────────────────────────────
const TaskStack = createNativeStackNavigator();
function TaskStackNavigator() {
  return (
    <TaskStack.Navigator screenOptions={{ headerShown: false }}>
      <TaskStack.Screen name="TaskList" component={TaskListScreen} />
      <TaskStack.Screen name="PickBrief" component={PickBriefScreen} />
      <TaskStack.Screen name="Scan" component={ScanScreen} />
      <TaskStack.Screen name="ReceiveJob" component={ReceiveJobScreen} />
      <TaskStack.Screen name="Stow" component={StowScreen} />
      <TaskStack.Screen name="Pack" component={PackScreen} />
    </TaskStack.Navigator>
  );
}

// ─── Tab bar options shared ───────────────────────────────────────────────────
const tabBarStyle = (bottomInset: number) => ({
  backgroundColor: colors.bg2,
  borderTopColor: colors.rule,
  borderTopWidth: 1,
  height: 60 + bottomInset,
  paddingBottom: bottomInset + spacing.xs,
  paddingTop: spacing.xs,
});

const OperatorRootStack = createNativeStackNavigator();
function OperatorRoot() {
  return (
    <OperatorRootStack.Navigator screenOptions={{ headerShown: false }}>
      <OperatorRootStack.Screen name="OperatorTabs" component={OperatorTabs} />
      <OperatorRootStack.Screen name="Settings" component={OperatorSettingsScreen} />
    </OperatorRootStack.Navigator>
  );
}

// ─── OPERATOR tabs ────────────────────────────────────────────────────────────
const OperatorTab = createBottomTabNavigator();
function OperatorTabs() {
  const insets = useSafeAreaInsets();
  return (
    <OperatorTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: tabBarStyle(insets.bottom),
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ink4,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <OperatorTab.Screen
        name="Tasks"
        component={TaskStackNavigator}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="list-outline" focused={focused} />,
          tabBarLabel: 'Tasks',
        }}
      />
      <OperatorTab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="notifications-outline" focused={focused} />,
          tabBarLabel: 'Alerts',
        }}
      />
      <OperatorTab.Screen
        name="Calendar"
        component={AvailabilityScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="calendar-outline" focused={focused} />,
          tabBarLabel: 'Calendar',
        }}
      />
      <OperatorTab.Screen
        name="Scanner"
        component={ScannerScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="scan-outline" focused={focused} />,
          tabBarLabel: 'Scanner',
        }}
      />
    </OperatorTab.Navigator>
  );
}

const OwnerRootStack = createNativeStackNavigator();
function OwnerRoot() {
  return (
    <OwnerRootStack.Navigator screenOptions={{ headerShown: false }}>
      <OwnerRootStack.Screen name="OwnerTabs" component={OwnerTabs} />
      <OwnerRootStack.Screen name="Settings" component={OwnerSettingsScreen} />
      <OwnerRootStack.Screen name="OperatorPerformance" component={OperatorPerformanceScreen} />
    </OwnerRootStack.Navigator>
  );
}

// ─── OWNER/ADMIN tabs ─────────────────────────────────────────────────────────
const OwnerTab = createBottomTabNavigator();
function OwnerTabs() {
  const insets = useSafeAreaInsets();
  return (
    <OwnerTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: tabBarStyle(insets.bottom),
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ink4,
        tabBarLabelStyle: styles.tabLabel,
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
        name="Alerts"
        component={AlertsScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon name="notifications-outline" focused={focused} />,
          tabBarLabel: 'Alerts',
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

// ─── Root ─────────────────────────────────────────────────────────────────────
function AppInner() {
  const { isAuthenticated, isLoading, error, login, role } = useAuth();

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
      <NavigationContainer>
        {isOwnerOrAdmin ? <OwnerRoot /> : <OperatorRoot />}
      </NavigationContainer>
    </SafeAreaProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppInner />
    </AuthProvider>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabLabel: {
    fontSize: font.size.xs,
    fontWeight: font.weight.medium,
  },
});