// tests/unit/ui/auth/LoginPage.test.tsx
//
// AUTH-LOGOUT-HANG-01 regression.
//
// Production defect: after an authenticated user clicks Logout, the SPA
// client-side navigates to /login (no document reload). LoginPage lazily
// imported its only auth form (`import('./jwt/AuthLogin')`); when that hashed
// chunk request failed (e.g. superseded by a deploy) the loader only
// console.error'd, so the form slot stayed on <CircularProgress> forever and
// only a manual reload recovered it.
//
// Contract: the usable login form must be on LoginPage's stable render path —
// no module-loader transition, no loader-owned spinner — while the existing
// already-authenticated redirect still works.

import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { AuthProvider } from 'contexts/AuthContext';
import { clearToken } from 'utils/authStore';
import LoginPage from 'pages/authentication/LoginPage';

// The JWT auth form carries formik/yup/network dependencies that are not the
// subject of this test. Stub it with a synchronous marker so the assertions
// target LoginPage's own render path, not the form internals.
jest.mock('pages/authentication/jwt/AuthLogin', () => ({
  __esModule: true,
  default: () => <div data-testid="jwt-auth-login-form">jwt auth form</div>,
}));

jest.mock('posthog-js/react', () => ({
  __esModule: true,
  usePostHog: () => ({}),
}));

jest.mock('posthog-js', () => ({ __esModule: true, default: {} }));

jest.mock('api/axiosConfig', () => {
  const actual = jest.requireActual('api/axiosConfig');
  return {
    ...actual,
    axiosInstance: { post: jest.fn(), get: jest.fn() },
  };
});

const renderLoginAt = (path = '/login') =>
  render(
    <ThemeProvider theme={createTheme()}>
      <MemoryRouter initialEntries={[path]}>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/overview" element={<div data-testid="overview-marker" />} />
            <Route path="*" element={<div data-testid="other-route-marker" />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>
    </ThemeProvider>
  );

describe('AUTH-LOGOUT-HANG-01 — LoginPage keeps the auth form on the stable render path', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    clearToken();
    jest.clearAllMocks();
  });

  it('A. renders the usable auth form on the first commit, with no async module-loader step', () => {
    renderLoginAt('/login');

    // Synchronous: no await / waitFor. Pre-fix this is absent until the
    // dynamic import() of ./jwt/AuthLogin resolves on a later tick (or never).
    expect(screen.getByTestId('jwt-auth-login-form')).toBeInTheDocument();
    // Existing login chrome/copy still renders.
    expect(screen.getByText(/let's sync up/i)).toBeInTheDocument();
  });

  it('B. never shows a loading spinner in place of the login form', () => {
    renderLoginAt('/login');

    // Pre-fix: <CircularProgress role="progressbar"> occupies the form slot
    // while (and, on chunk failure, forever after) AuthLoginComponent === null.
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.getByTestId('jwt-auth-login-form')).toBeInTheDocument();
  });

  it('C. still redirects an already-authenticated visitor away from /login', async () => {
    localStorage.setItem('accessToken', 'seeded-token');
    localStorage.setItem(
      'user',
      JSON.stringify({ email: 'owner@test.com', first_name: 'Owner' }),
    );

    renderLoginAt('/login');

    expect(await screen.findByTestId('overview-marker')).toBeInTheDocument();
    expect(screen.queryByTestId('jwt-auth-login-form')).toBeNull();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});
