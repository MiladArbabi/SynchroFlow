// tests/unit/ui/auth/AuthRegister.test.tsx

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AuthProvider } from 'contexts/AuthContext';
import AuthRegister from 'pages/authentication/jwt/AuthRegister';
import { axiosInstance } from 'api/axiosConfig';

jest.mock('api/axiosConfig', () => {
  const actual = jest.requireActual('api/axiosConfig');
  return {
    ...actual,
    axiosInstance: {
      post: jest.fn(),
    },
  };
});

const renderRegister = () =>
  render(
    <MemoryRouter>
      <AuthProvider>
        <AuthRegister posthog={{} as any} />
      </AuthProvider>
    </MemoryRouter>
  );

describe('AuthRegister UI invariants', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  it('blocks submission when required fields are missing', async () => {
    renderRegister();

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(axiosInstance.post).not.toHaveBeenCalled();
    });
  });

  it('requires Terms & Conditions to be checked', async () => {
    renderRegister();

    fireEvent.change(screen.getByLabelText(/first name/i), {
    target: { value: 'Owner' },
    });

    fireEvent.change(screen.getByLabelText(/last name/i), {
    target: { value: 'User' },
    });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'owner@test.com' },
    });
    const passwordInput = document.querySelector(
    'input[name="password"]'
    ) as HTMLInputElement;

    fireEvent.change(passwordInput, {
    target: { value: 'StrongPassword123!' },
    });

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(axiosInstance.post).not.toHaveBeenCalled();
    });
  });

  it('does not authenticate user after successful registration', async () => {
    (axiosInstance.post as jest.Mock).mockResolvedValueOnce({
      data: {
        accessToken: 'test-token',
        user: {
          id: 1,
          email: 'owner@test.com',
          first_name: 'Owner',
          last_name: 'User',
        },
      },
    });

    renderRegister();

    fireEvent.change(screen.getByLabelText(/first name/i), {
    target: { value: 'Owner' },
    });

    fireEvent.change(screen.getByLabelText(/last name/i), {
    target: { value: 'User' },
    });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'owner@test.com' },
    });
    const passwordInput = document.querySelector(
        'input[name="password"]'
        ) as HTMLInputElement;

        fireEvent.change(passwordInput, {
        target: { value: 'StrongPassword123!' },
    });
    fireEvent.click(screen.getByLabelText(/terms/i));

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
    expect(localStorage.getItem('accessToken')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    });
  });

  it('shows error on email conflict (409) and does not log in', async () => {
    (axiosInstance.post as jest.Mock).mockRejectedValueOnce({
      response: {
        status: 409,
        data: { error: 'Email already in use.' },
      },
    });

    renderRegister();

    fireEvent.change(screen.getByLabelText(/first name/i), {
        target: { value: 'Owner' },
    });

    fireEvent.change(screen.getByLabelText(/last name/i), {
        target: { value: 'User' },
    });

    fireEvent.change(screen.getByLabelText(/email/i), {
      target: { value: 'owner@test.com' },
    });
    const passwordInput = document.querySelector(
    'input[name="password"]'
    ) as HTMLInputElement;

    fireEvent.change(passwordInput, {
    target: { value: 'StrongPassword123!' },
    });
    fireEvent.click(screen.getByLabelText(/terms/i));

    fireEvent.click(screen.getByRole('button', { name: /sign up/i }));

    await waitFor(() => {
      expect(screen.getByText(/email already in use/i)).toBeInTheDocument();
      expect(localStorage.getItem('accessToken')).toBeNull();
    });
  });
});