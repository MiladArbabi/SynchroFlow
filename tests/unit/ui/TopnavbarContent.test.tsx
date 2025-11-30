// apps/frontend/src/components/TopnavbarContent/TopnavbarContent.test.tsx
import { screen } from '@testing-library/react';
import TopnavbarContent from 'layouts/AppLayout/TopnavbarContent';
import { renderWithProviders } from 'test-utils';

// Mock the KoreTrigger component
jest.mock('components/KoreTrigger', () => {
  return {
    __esModule: true,
    default: jest.fn(({ onClick, isActive }) => (
      <div 
        data-testid="kore-trigger-mock" 
        data-is-active={isActive}
        onClick={onClick}
      >
        KoreTrigger Mock
      </div>
    )),
  };
});

// Mock the useAuth hook to avoid AuthProvider dependency
jest.mock('contexts/AuthContext', () => ({
  useAuth: jest.fn(() => ({
    user: { name: 'Test User', email: 'test@example.com' },
    login: jest.fn(),
    logout: jest.fn(),
    isAuthenticated: true,
    isLoading: false,
  })),
}));

// Mock any other components that might be causing issues
jest.mock('layout/MainLayout/Header/ProfileSection', () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid="profile-section-mock">Profile Section</div>),
}));

describe.skip('TopnavbarContent', () => {
  test('renders KoreTrigger component', () => {
    renderWithProviders(<TopnavbarContent isEditing={false} onEditToggle={function (): void {
        throw new Error('Function not implemented.');
    } } onAddWidget={function (): void {
        throw new Error('Function not implemented.');
    } } />);
    
    expect(screen.getByTestId('kore-trigger-mock')).toBeInTheDocument();
  });

  test('matches snapshot', () => {
    const { container } = renderWithProviders(<TopnavbarContent isEditing={false} onEditToggle={function (): void {
        throw new Error('Function not implemented.');
    } } onAddWidget={function (): void {
        throw new Error('Function not implemented.');
    } } />);
    
    expect(container.firstChild).toMatchSnapshot();
  });

  test('passes correct props to KoreTrigger', () => {
    renderWithProviders(<TopnavbarContent isEditing={false} onEditToggle={function (): void {
        throw new Error('Function not implemented.');
    } } onAddWidget={function (): void {
        throw new Error('Function not implemented.');
    } } />);
    
    const koreTrigger = screen.getByTestId('kore-trigger-mock');
    expect(koreTrigger).toBeInTheDocument();
    // Add more specific assertions based on your TopnavbarContent implementation
  });
});