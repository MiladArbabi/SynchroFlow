// apps/mobile/App.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { AuthProvider, useAuth } from './src/contexts/AuthContext';
import { colors, font, spacing } from './src/theme';

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

import { AppHeader, Screen } from './src/ui';

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

// ─── Placeholder screens ──────────────────────────────────────────────────────
function NotificationsScreen() {
  return (
    <Screen>
      <AppHeader showLogo />
      <View style={placeholder.root}>
        <Text style={placeholder.title}>Alerts</Text>
        <Text style={placeholder.sub}>System alerts — coming soon</Text>
      </View>
    </Screen>
  );
}
function SettingsScreen() {
  return (
    <View style={placeholder.root}>
      <Text style={placeholder.title}>Settings</Text>
      <Text style={placeholder.sub}>Profile & preferences — coming soon</Text>
    </View>
  );
}
function AlertsScreen() {
  const { logout } = useAuth();
  return (
    <Screen>
      <AppHeader showLogo  />
      <View style={placeholder.root}>
        <Text style={placeholder.title}>Alerts</Text>
        <Text style={placeholder.sub}>Exception inbox — coming soon</Text>
      </View>
    </Screen>
  );
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
        {isOwnerOrAdmin ? <OwnerTabs /> : <OperatorTabs />}
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