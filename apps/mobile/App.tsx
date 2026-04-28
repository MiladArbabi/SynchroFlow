// apps/mobile/App.tsx
import { useState } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from './src/hooks/useAuth';
import LoginScreen from './src/screens/LoginScreen';
import TaskListScreen, { type Task } from './src/screens/TaskListScreen';
import AvailabilityScreen from './src/screens/AvailabilityScreen';
import ScanScreen from './src/screens/ScanScreen';
import { colors } from './src/theme';
import { SafeAreaProvider } from 'react-native-safe-area-context';

/**
 * APP ROOT (Mobile v1)
 * --------------------
 * Minimal stack navigator — no library needed for 3 screens.
 * React Navigation added Sprint 4 when stack depth increases.
 *
 * Screens:
 * - login        → LoginScreen
 * - tasks        → TaskListScreen (home)
 * - availability → AvailabilityScreen
 * - scan         → ScanScreen (Sprint 1 M5 — TODO)
 */

type Screen = 'tasks' | 'availability' | 'scan';

export default function App() {
  const { isAuthenticated, isLoading, error, login, logout } = useAuth();
  const [screen, setScreen] = useState<Screen>('tasks');
  const [activeTask, setActiveTask] = useState<Task | null>(null);

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
      <>
        <StatusBar style="light" />
        <LoginScreen onLogin={login} error={error} />
      </>
    );
  }

  return (
     <SafeAreaProvider>
      <StatusBar style="light" />

      {screen === 'tasks' && (
        <TaskListScreen
          onSelectTask={(task) => {
            setActiveTask(task);
            setScreen('scan');
          }}
          onLogout={() => void logout()}
          onOpenAvailability={() => setScreen('availability')}
        />
      )}

      {screen === 'scan' && activeTask && (
        <ScanScreen
          task={activeTask}
          onComplete={() => {
            setActiveTask(null);
            setScreen('tasks');
          }}
          onBack={() => {
            setActiveTask(null);
            setScreen('tasks');
          }}
        />
      )}

      {screen === 'availability' && (
        <AvailabilityScreen onBack={() => setScreen('tasks')} />
      )}
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
});