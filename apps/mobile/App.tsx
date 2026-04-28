// apps/mobile/App.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, Text, StyleSheet, Platform, TouchableOpacity } from 'react-native';
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
import TeamDashboardScreen from './src/screens/TeamDashboardScreen';

// ─── Tab icon ────────────────────────────────────────────────────────────────
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{emoji}</Text>;
}

// ─── Placeholder screens ──────────────────────────────────────────────────────
function NotificationsScreen() {
  return (
    <View style={placeholder.root}>
      <Text style={placeholder.title}>Notifications</Text>
      <Text style={placeholder.sub}>System alerts — coming soon</Text>
    </View>
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
function OwnerSettingsScreen() {
  const { logout } = useAuth();
  return (
    <View style={placeholder.root}>
      <Text style={placeholder.title}>Settings</Text>
      <Text style={placeholder.sub}>Alerts · Reports · WMS · Members — coming soon</Text>
      <TouchableOpacity
        onPress={() => void logout()}
        style={{ marginTop: spacing.xl, padding: spacing.md }}
      >
        <Text style={{ color: colors.error, fontSize: font.size.md, fontWeight: font.weight.semibold }}>
          Sign out
        </Text>
      </TouchableOpacity>
    </View>
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
          tabBarIcon: ({ focused }) => <TabIcon emoji="📋" focused={focused} />,
          tabBarLabel: 'Tasks',
        }}
      />
      <OperatorTab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="🔔" focused={focused} />,
          tabBarLabel: 'Alerts',
        }}
      />
      <OperatorTab.Screen
        name="Calendar"
        component={AvailabilityScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="📅" focused={focused} />,
          tabBarLabel: 'Calendar',
        }}
      />
      <OperatorTab.Screen
        name="Settings"
        component={SettingsScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" focused={focused} />,
          tabBarLabel: 'Settings',
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
          tabBarIcon: ({ focused }) => <TabIcon emoji="📊" focused={focused} />,
          tabBarLabel: 'Overview',
        }}
      />
      <OwnerTab.Screen
        name="Tasks"
        component={DispatchScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="🚀" focused={focused} />,
          tabBarLabel: 'Tasks',
        }}
      />
      <OwnerTab.Screen
        name="Team"
        component={TeamDashboardScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="👥" focused={focused} />,
          tabBarLabel: 'Team',
        }}
      />
      <OwnerTab.Screen
        name="Settings"
        component={OwnerSettingsScreen}
        options={{
          tabBarIcon: ({ focused }) => <TabIcon emoji="⚙️" focused={focused} />,
          tabBarLabel: 'Settings',
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