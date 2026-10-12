import { act, render } from '@testing-library/react-native';
import { Alert, TouchableOpacity } from 'react-native';
import { ProfileSheet } from '../src/ui/ProfileSheet';
import OperatorSettingsScreen from '../src/screens/OperatorSettingsScreen';
import { useAuth } from '../src/hooks/useAuth';

jest.mock('../src/hooks/useAuth', () => ({ useAuth: jest.fn() }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('@react-navigation/native', () => ({ useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('../src/ui', () => {
  const React = require('react');
  const { View } = require('react-native');
  const Container = ({ children }: any) => React.createElement(View, null, children);
  return { Screen: Container, AppHeader: () => null, Card: Container, Row: Container, Divider: () => null };
});
jest.mock('@lasyncro/mobile-core', () => ({ apiClient: {
  get: jest.fn(() => Promise.resolve({ data: { preferences: {} } })),
  patch: jest.fn(() => Promise.resolve({})),
} }));

function deferred() {
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((_, no) => { reject = no; });
  return { promise, reject };
}

beforeEach(() => jest.clearAllMocks());

// Observe the handler's returned promise and actual user notification.
// ProfileSheet's pre-fix void wrapper discards the rejected handler promise;
// Jest also reports that unhandled rejection as RED evidence.
test('ProfileSheet handles a rejected logout and warns about incomplete cleanup', async () => {
  const gate = deferred();
  const logout = jest.fn(() => gate.promise);
  jest.mocked(useAuth).mockReturnValue({ logout, role: 'staff', userId: 41 } as any);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const close = jest.fn();
  const view = render(<ProfileSheet visible onClose={close} />);
  const button = view.UNSAFE_getAllByType(TouchableOpacity).find(node => node.findAllByProps({ children: 'Sign out' }).length > 0)!;
  let outcome: any;
  await act(async () => {
    const pending = Promise.resolve(button.props.onPress()).then(() => null, error => error);
    gate.reject(Object.assign(new Error('LOCAL_LOGOUT_CLEANUP_FAILED'), { durableInvalidation: false }));
    outcome = await pending;
  });
  expect(outcome).toBeNull();
  expect(logout).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith('Sign out incomplete', expect.stringMatching(/could not.*(remove|clear).*credentials/i));
  alert.mockRestore();
});

test('OperatorSettingsScreen handles a rejected logout and warns about incomplete cleanup', async () => {
  const gate = deferred();
  const logout = jest.fn(() => gate.promise);
  jest.mocked(useAuth).mockReturnValue({ logout, email: 'staff@example.test', firstName: 'Staff' } as any);
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const view = render(<OperatorSettingsScreen />);
  const button = view.UNSAFE_getAllByType(TouchableOpacity).find(node => node.findAllByProps({ children: 'Sign out' }).length > 0)!;
  let outcome: any;
  await act(async () => {
    const pending = Promise.resolve(button.props.onPress()).then(() => null, error => error);
    gate.reject(Object.assign(new Error('LOCAL_LOGOUT_CLEANUP_FAILED'), { durableInvalidation: true }));
    outcome = await pending;
  });
  expect(outcome).toBeNull();
  expect(logout).toHaveBeenCalledTimes(1);
  expect(alert).toHaveBeenCalledWith('Sign out incomplete', expect.stringMatching(/could not.*(remove|clear).*credentials/i));
  alert.mockRestore();
});
