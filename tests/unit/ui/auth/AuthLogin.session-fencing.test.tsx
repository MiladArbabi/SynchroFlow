import React from 'react';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { axiosInstance } from 'api/axiosConfig';
import {
  advanceSessionGeneration,
  clearToken,
  setToken,
} from 'utils/authStore';
import JWTLogin from 'pages/authentication/jwt/AuthLogin';

const mockNavigate = jest.fn();
const mockAuthLogin = jest.fn();
const mockEmit = jest.fn();
const mockIdentify = jest.fn();
const mockGroup = jest.fn();

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return { ...actual, useNavigate: () => mockNavigate };
});

jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({ login: mockAuthLogin }),
}));

jest.mock('../../../../apps/frontend/src/analytics/useUiEvents', () => ({
  useUiEvents: () => ({ emit: mockEmit }),
}));

jest.mock('../../../../apps/frontend/src/analytics/adapter', () => ({
  identifyUser: (...args: unknown[]) => mockIdentify(...args),
  groupByShop: (...args: unknown[]) => mockGroup(...args),
}));

jest.mock('pages/authentication/OAuthButtons', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('api/axiosConfig', () => ({
  axiosInstance: { post: jest.fn() },
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const response = {
  data: {
    accessToken: 'new-access-token',
    user: {
      id: 101,
      shop_id: 202,
      role: 'owner',
      plan: 'starter',
    },
  },
};

function renderLogin() {
  render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter initialEntries={['/login']}>
        <JWTLogin />
      </MemoryRouter>
    </ThemeProvider>,
  );
}

async function submitLogin() {
  fireEvent.change(screen.getByPlaceholderText('Email address'), {
    target: { value: 'owner@example.com' },
  });

  fireEvent.change(screen.getByPlaceholderText('Password'), {
    target: { value: 'correct-password' },
  });

  fireEvent.click(screen.getByRole('button', { name: /sign in/i }));

  await waitFor(() => {
    expect(axiosInstance.post).toHaveBeenCalledWith(
      '/api/v1/auth/login',
      {
        email: 'owner@example.com',
        password: 'correct-password',
      },
    );
  });
}

describe('AUTH-SESSION-01 — actual JWTLogin response fencing', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    clearToken();

    // Model AuthContext.login's generation change.
    mockAuthLogin.mockImplementation((_user, token) => {
      advanceSessionGeneration();
      setToken(token);
    });
  });

  it('rejects delayed login success after logout', async () => {
    const pending = deferred<typeof response>();
    (axiosInstance.post as jest.Mock).mockReturnValueOnce(pending.promise);

    sessionStorage.setItem('returnTo', '/inventory/items');

    renderLogin();
    await submitLogin();

    // Logout supersedes the pending login.
    clearToken();

    await act(async () => {
      pending.resolve(response);
      await pending.promise;
    });

    expect(mockAuthLogin).not.toHaveBeenCalled();
    expect(mockEmit).not.toHaveBeenCalledWith(
      'auth.login.success',
      expect.anything(),
    );
    expect(mockIdentify).not.toHaveBeenCalled();
    expect(mockGroup).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(sessionStorage.getItem('returnTo')).toBe('/inventory/items');

    // Stale login must release Formik submission state.
    expect(screen.getByRole('button', { name: /sign in/i })).toBeEnabled();
  });

  it('cannot overwrite credentials from a newer session', async () => {
    const pending = deferred<typeof response>();
    (axiosInstance.post as jest.Mock).mockReturnValueOnce(pending.promise);

    renderLogin();
    await submitLogin();

    advanceSessionGeneration();
    setToken('newer-session-token');

    await act(async () => {
      pending.resolve(response);
      await pending.promise;
    });

    expect(mockAuthLogin).not.toHaveBeenCalled();
    expect(mockIdentify).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(localStorage.getItem('accessToken')).toBe(
      'newer-session-token',
    );
  });

  it('suppresses obsolete login failures', async () => {
    const pending = deferred<typeof response>();
    (axiosInstance.post as jest.Mock).mockReturnValueOnce(pending.promise);

    renderLogin();
    await submitLogin();

    clearToken();

    await act(async () => {
      pending.reject(new Error('obsolete request failed'));
      await pending.promise.catch(() => undefined);
    });

    expect(mockEmit).not.toHaveBeenCalledWith(
      'auth.login.failed',
      expect.anything(),
    );
    expect(
      screen.queryByText('obsolete request failed'),
    ).toBeNull();
  });

  it('still accepts a current successful login', async () => {
    (axiosInstance.post as jest.Mock).mockResolvedValueOnce(response);

    renderLogin();
    await submitLogin();

    await waitFor(() => {
      expect(mockAuthLogin).toHaveBeenCalledWith(
        response.data.user,
        response.data.accessToken,
      );
    });

    expect(mockEmit).toHaveBeenCalledWith(
      'auth.login.success',
      expect.objectContaining({ user_id: 101, shop_id: 202 }),
    );
    expect(mockIdentify).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith('/overview');
  });
  it('failed password preserves the existing browser identity', async () => {
    setToken('existing-access-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ id: 12, shop_id: 34, role: 'owner' }),
    );

    (axiosInstance.post as jest.Mock).mockRejectedValueOnce({
      response: {
        status: 401,
        data: { error: 'Invalid email or password.' },
      },
    });

    renderLogin();
    await submitLogin();

    expect(
      await screen.findByText('Invalid email or password.'),
    ).toBeInTheDocument();

    // Security/product contract: a rejected account switch must not
    // terminate an otherwise valid existing browser session.
    expect(localStorage.getItem('accessToken')).toBe(
      'existing-access-token',
    );
    expect(JSON.parse(localStorage.getItem('user') || 'null')).toEqual({
      id: 12,
      shop_id: 34,
      role: 'owner',
    });

    expect(mockAuthLogin).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

});
