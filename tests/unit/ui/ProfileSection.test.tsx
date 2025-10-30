// tests/unit/ui/ProfileSection.test.tsx
import { screen, fireEvent, waitFor } from '@testing-library/react';
import { renderWithProviders } from 'test-utils';
import ProfileSection from 'layout/MainLayout/Header/ProfileSection'; // Use alias
import { axiosInstance } from 'api/axiosConfig';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    post: jest.fn(),
    // Add other methods if needed by other components
  }
}));
const mockedAxiosInstance = axiosInstance as jest.Mocked<typeof axiosInstance>;

// Mock react-router-dom navigate
const mockNavigate = jest.fn();
jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

// --- Mock useAuth hook ---
const mockLogoutFn = jest.fn();
jest.mock('contexts/AuthContext', () => ({
  useAuth: () => ({
    logout: mockLogoutFn,
    user: { email: 'test@lasyncro.com' } // Provide mock user
  })
}));

// Mock child components
jest.mock('ui-component/cards/MainCard', () => ({ children }: { children: React.ReactNode }) => <div>{children}</div>);
jest.mock('ui-component/extended/Transitions', () => ({ children }: { children: React.ReactNode }) => <>{children}</>);
jest.mock('ui-component/cards/MainCard', () => ({ children, ...props }: { children: React.ReactNode }) => <div {...props}>{children}</div>);
jest.mock('layout/MainLayout/Header/ProfileSection/UpgradePlanCard', () => () => <div>Upgrade Plan</div>);
jest.mock('hooks/useConfig', () => () => ({ state: { borderRadius: 12 } }));

describe('ProfileSection Component', () => {
  beforeEach(() => {
    mockLogoutFn.mockClear();
    mockNavigate.mockClear();
    (mockedAxiosInstance.post as jest.Mock).mockClear();
  });

  it('calls context logout, API /logout, and navigates on logout button click', async () => {
    // Mock successful API response
    (mockedAxiosInstance.post as jest.Mock).mockResolvedValue({});

    renderWithProviders(<ProfileSection />);

    // 1. Open the popper
    fireEvent.click(screen.getByLabelText(/user-account/i));

    // 2. Click the logout button
    fireEvent.click(await screen.findByText(/Logout/i));

    // 3. --- ASSERTIONS ---
    // We must WAIT for the async handleLogout function to complete
    await waitFor(() => {
      // It should call the backend /logout endpoint
      expect(mockedAxiosInstance.post).toHaveBeenCalledWith('/api/v1/auth/logout');
      // It should call the context logout function
      expect(mockLogoutFn).toHaveBeenCalledTimes(1);
    });

    // It should navigate to the login page
    // Navigation should happen *after* the async calls
    expect(mockNavigate).toHaveBeenCalledWith('/login');
  });
});