// tests/unit/ui/AuthLogin.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JWTLogin from 'pages/authentication/jwt/AuthLogin'; // Use alias
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock child components that might interfere
jest.mock('ui-component/extended/AnimateButton', () => ({ children }: { children: React.ReactNode }) => <>{children}</>);
jest.mock('ui-component/extended/Form/CustomFormControl', () => ({ children }: { children: React.ReactNode }) => <div>{children}</div>);

describe('JWTLogin Component', () => {
  beforeEach(() => {
    mockedAxios.post.mockClear();
  });

  it('calls the login API on submit with correct data', async () => {
    // Mock a successful API response
    mockedAxios.post.mockResolvedValue({ data: { token: 'fake_token' } });

    render(
      <MemoryRouter>
        <JWTLogin />
      </MemoryRouter>
    );

    // Fill the form
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'PassW@rd1' }});

    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    // --- RED TEST --- Assert axios was called correctly
    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/api/v1/auth/login', // Correct backend endpoint
        {
          email: 'test@example.com',
          password: 'PassW@rd1',
        }
      );
    });
  });

  it('displays an error message on API failure', async () => {
    // Mock a failed API response
    const errorMessage = 'Invalid credentials';
    mockedAxios.post.mockRejectedValue({ response: { data: { error: errorMessage } } });

    render(
      <MemoryRouter>
        <JWTLogin />
      </MemoryRouter>
    );

    // Fill and submit
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'wrongpass' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign In/i }));

    // --- RED TEST --- Assert error message is shown
    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });
});