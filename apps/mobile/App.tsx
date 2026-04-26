// apps/mobile/App.tsx
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useAuth } from './src/hooks/useAuth';
import LoginScreen from './src/screens/LoginScreen';
import TaskListScreen from './src/screens/TaskListScreen';
import { colors } from './src/theme';

/**
 * APP ROOT
 * --------
 * Auth gate — no navigation library for v1.
 * React Navigation added in Sprint 4 (availability calendar).
 *
 * isLoading  → splash spinner
 * !auth      → LoginScreen
 * auth       → TaskListScreen
 */
export default function App() {
  const { isAuthenticated, isLoading, error, login, logout } = useAuth();

  if (isLoading) {
    return (
      <View style={styles.splash}>
        <StatusBar style="light" />
        <ActivityIndicator size="large" color={colors.accent} />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" />
      {isAuthenticated
        ? <TaskListScreen
            onSelectTask={(task) => {
              /**
               * TODO — Sprint 1 M5: ScanScreen
               * Navigate to barcode scan screen with task context.
               * Placeholder until ScanScreen is built.
               */
              console.info('[APP] task selected', task.id, task.type);
            }}
            onLogout={() => void logout()}
          />
        : <LoginScreen
            onLogin={login}
            error={error}
          />
      }
    </>
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