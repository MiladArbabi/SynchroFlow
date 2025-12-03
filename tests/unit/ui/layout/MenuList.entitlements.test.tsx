// tests/unit/ui/layout/MenuList.entitlements.test.tsx
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import renderWithProviders from 'test-utils';

// Mock menu-items to a tiny structure
jest.mock('menu-items', () => ({
  __esModule: true,
  default: {
    items: [
      {
        id: 'group-main',
        type: 'group',
        title: 'Main',
        children: [
          {
            id: 'dashboard',
            type: 'item',
            title: 'Dashboard',
            url: '/dashboard',
            icon: null
          },
          {
            id: 'analytics',
            type: 'item',
            title: 'Analytics',
            url: '/analytics',
            icon: null
          }
        ]
      }
    ]
  }
}));

// Mock Berry config + menu hooks
jest.mock('api/menu', () => ({
  useGetMenuMaster: () => ({
    menuMaster: { isDashboardDrawerOpened: true }
  })
}));

jest.mock('hooks/useConfig', () => ({
  __esModule: true,
  default: () => ({
    state: { menuOrientation: 'VERTICAL' }
  })
}));

// Force non-mobile breakpoint
jest.mock('@mui/material/useMediaQuery', () => () => false);

// Import after mocks
import MenuList from 'layout/MainLayout/MenuList';

describe('MenuList entitlement filtering', () => {
  it('hides items whose url is not in allowedRoutes', () => {
    renderWithProviders(<MenuList allowedRoutes={['/dashboard']} />);

    // Visible
    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();

    // Hidden
    expect(screen.queryByText(/Analytics/i)).not.toBeInTheDocument();
  });

  it('shows all items when allowedRoutes is undefined', () => {
    renderWithProviders(<MenuList /> as any);

    expect(screen.getByText(/Dashboard/i)).toBeInTheDocument();
    expect(screen.getByText(/Analytics/i)).toBeInTheDocument();
  });
});
