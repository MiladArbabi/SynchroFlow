// apps/mobile/src/screens/LoginScreen.tsx
import { useState } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { Screen, Button } from '../ui';
import { colors, font, spacing, radius } from '../theme';

/**
 * LOGIN SCREEN
 * ------------
 * Operator entry point.
 * Email + password → JWT stored in SecureStore via onLogin.
 * Decoupled from auth state — all side effects in App.tsx.
 */

type Props = {
  onLogin: (email: string, password: string) => Promise<void>;
  error?: string | null;
};

export default function LoginScreen({ onLogin, error }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    if (!email.trim() || !password) {
      Alert.alert('Required', 'Please enter your email and password.');
      return;
    }
    setLoading(true);
    try {
      await onLogin(email.trim(), password);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Login failed.';
      Alert.alert('Sign in failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Screen>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.container}>

          {/* BRAND */}
          <View style={styles.brand}>
            <Text style={styles.wordmark}>laSyncro</Text>
            <Text style={styles.tagline}>Operator console</Text>
          </View>

          {/* FORM */}
          <View style={styles.form}>
            {error && (
              <View style={styles.errorBanner}>
                <Text style={styles.errorText}>{error}</Text>
              </View>
            )}

            <TextInput
              style={styles.input}
              placeholder="Email"
              placeholderTextColor={colors.ink4}
              autoCapitalize="none"
              keyboardType="email-address"
              autoComplete="email"
              value={email}
              onChangeText={setEmail}
              editable={!loading}
            />

            <TextInput
              style={styles.input}
              placeholder="Password"
              placeholderTextColor={colors.ink4}
              secureTextEntry
              autoComplete="password"
              value={password}
              onChangeText={setPassword}
              editable={!loading}
              onSubmitEditing={() => void handleLogin()}
              returnKeyType="go"
            />

            <Button
              label="Sign in"
              onPress={() => void handleLogin()}
              loading={loading}
              style={styles.cta}
            />
          </View>

        </View>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  brand: {
    marginBottom: spacing.xxl,
  },
  wordmark: {
    color: colors.ink,
    fontSize: font.size.xxl,
    fontWeight: font.weight.bold,
  },
  tagline: {
    color: colors.ink3,
    fontSize: font.size.sm,
    marginTop: spacing.xs,
  },
  form: {
    gap: spacing.sm,
  },
  input: {
    backgroundColor: colors.bg2,
    color: colors.ink,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm + 4,
    fontSize: font.size.md,
    borderWidth: 1,
    borderColor: colors.rule,
  },
  cta: {
    marginTop: spacing.xs,
  },
  errorBanner: {
    backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.25)',
    padding: spacing.sm + 4,
  },
  errorText: {
    color: colors.error,
    fontSize: font.size.sm,
  },
});