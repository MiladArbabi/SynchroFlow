// apps/mobile/App.tsx
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from './src/hooks/useAuth';
import { colors, font, spacing } from './src/theme';

import LoginScreen from './src/screens/LoginScreen';
import TaskListScreen from './src/screens/TaskListScreen';
import AvailabilityScreen from './src/screens/AvailabilityScreen';
import ScanScreen from './src/screens/ScanScreen';
import ReceiveJobScreen from './src/screens/ReceiveJobScreen';
import StowScreen from './src/screens/StowScreen';
import PickBriefScreen from './src/screens/PickBriefScreen';
import DispatchScreen from './src/screens/DispatchScreen';
import TeamDashboardScreen from './src/screens/TeamDashboardScreen';

function TabIcon({ label, focused }: { label: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.4 }}>{label}</Text>;
}

// ─── Task stack (shared by both roles) ───────────────────────────────────────
const TaskStack = createNativeStackNavigator();
function TaskStackNavigator() {
  return (
    <TaskStack.Navigator screenOptions={{ headerShown: false }}>
      <TaskStack.Screen name="TaskList" component={TaskListScreen} />
      <TaskStack.Screen name="PickBrief" component={PickBriefScreen} />
      <TaskStack.Screen name="Scan" component={ScanScreen} />
      <TaskStack.Screen name="ReceiveJob" component={ReceiveJobScreen} />
      <TaskStack.Screen name="Stow" component={StowScreen} />
    </TaskStack.Navigator>
  );
}

// ─── Operator tabs ────────────────────────────────────────────────────────────
const OperatorTab = createBottomTabNavigator();
function OperatorTabs() {
  return (
    <OperatorTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ink4,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <OperatorTab.Screen
        name="Tasks"
        component={TaskStackNavigator}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="📋" focused={focused} />, tabBarLabel: 'Tasks' }}
      />
      <OperatorTab.Screen
        name="Availability"
        component={AvailabilityScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="📅" focused={focused} />, tabBarLabel: 'Calendar' }}
      />
    </OperatorTab.Navigator>
  );
}

// ─── Owner/Admin tabs ─────────────────────────────────────────────────────────
const OwnerTab = createBottomTabNavigator();
function OwnerTabs() {
  return (
    <OwnerTab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.ink4,
        tabBarLabelStyle: styles.tabLabel,
      }}
    >
      <OwnerTab.Screen
        name="Tasks"
        component={TaskStackNavigator}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="📋" focused={focused} />, tabBarLabel: 'Tasks' }}
      />
      <OwnerTab.Screen
        name="Dispatch"
        component={DispatchScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="🚀" focused={focused} />, tabBarLabel: 'Dispatch' }}
      />
      <OwnerTab.Screen
        name="Team"
        component={TeamDashboardScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="👥" focused={focused} />, tabBarLabel: 'Team' }}
      />
      <OwnerTab.Screen
        name="Availability"
        component={AvailabilityScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon label="📅" focused={focused} />, tabBarLabel: 'Calendar' }}
      />
    </OwnerTab.Navigator>
  );
}

// ─── Root ─────────────────────────────────────────────────────────────────────
export default function App() {
  const { isAuthenticated, isLoading, error, login, role } = useAuth();

  if (isLoading) {
    return (
      <SafeAreaProvider>
        <View style={styles.splash}>
          <StatusBar style="light" />
          <ActivityIndicator size="large" color={colors.accent} />
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

const styles = StyleSheet.create({
  splash: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabBar: {
    backgroundColor: colors.bg2,
    borderTopColor: colors.rule,
    borderTopWidth: 1,
    paddingTop: spacing.xs,
    height: 60,
  },
  tabLabel: {
    fontSize: 11,
    marginBottom: spacing.xs,
  },
});