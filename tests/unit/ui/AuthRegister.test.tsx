// tests/unit/ui/AuthRegister.test.tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JWTRegister from 'pages/authentication/jwt/AuthRegister'; // Use alias
import axios from 'axios';

// Mock axios
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// Mock react-router-dom navigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

// Mock child components
jest.mock('ui-component/extended/AnimateButton', () => ({ children }: { children: React.ReactNode }) => <>{children}</>);
jest.mock('ui-component/extended/Form/CustomFormControl', () => ({ children }: { children: React.ReactNode }) => <div>{children}</div>);

describe('JWTRegister Component', () => {
  beforeEach(() => {
    mockedAxios.post.mockClear();
    mockNavigate.mockClear();
  });

  it('calls the register API on submit with correct data and navigates on success', async () => {
    // Mock a successful API response
    mockedAxios.post.mockResolvedValue({ data: { id: 1, email: 'new@example.com' } });

    render(
      <MemoryRouter>
        <JWTRegister />
      </MemoryRouter>
    );

    // Fill the form
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'PassW@rd1' } }); // Use inexact match for password

    // Submit the form
    fireEvent.click(screen.getByRole('button', { name: /Sign up/i }));

    // --- RED TEST --- Assert axios was called correctly
    await waitFor(() => {
      expect(mockedAxios.post).toHaveBeenCalledTimes(1);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        '/api/v1/auth/register', // Correct backend endpoint
        {
          firstName: 'Test',
          lastName: 'User',
          email: 'new@example.com',
          password: 'PassW@rd1',
        }
      );
      // Assert navigation on success
      expect(mockNavigate).toHaveBeenCalledWith('/login', { replace: true });
    });
  });

  it('displays an error message on API failure', async () => {
    // Mock a failed API response (e.g., email already exists)
    const errorMessage = 'Email already in use.';
    mockedAxios.post.mockRejectedValue({ response: { status: 409, data: { error: errorMessage } } });

    render(
      <MemoryRouter>
        <JWTRegister />
      </MemoryRouter>
    );

    // Fill and submit
    fireEvent.change(screen.getByLabelText(/First Name/i), { target: { value: 'Test' } });
    fireEvent.change(screen.getByLabelText(/Last Name/i), { target: { value: 'User' } });
    fireEvent.change(screen.getByLabelText(/Email Address/i), { target: { value: 'existing@example.com' } });
    fireEvent.change(screen.getByLabelText(/^Password$/i), { target: { value: 'PassW@rd1' } });
    fireEvent.click(screen.getByRole('button', { name: /Sign up/i }));

    // --- RED TEST --- Assert error message is shown
    await waitFor(() => {
      expect(screen.getByText(errorMessage)).toBeInTheDocument();
    });
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(mockNavigate).not.toHaveBeenCalled(); // Ensure no navigation on error
  });
});