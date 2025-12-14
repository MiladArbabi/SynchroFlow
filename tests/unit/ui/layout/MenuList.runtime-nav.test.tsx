// tests/unit/ui/layout/MenuList.runtime-nav.test.tsx
import '@testing-library/jest-dom';
import { screen } from '@testing-library/react';

import MenuList from 'layout/MainLayout/MenuList';
import { registerNavItem, registerNavGroup, _resetNav } from 'runtime/registerNav';
import { renderWithProviders } from 'test-utils';

describe('MenuList - runtime navigation contract', () => {
  beforeEach(() => {
    _resetNav();
  });

  it('does NOT render nav items that have no group', () => {
    registerNavItem({
      id: 'orphan-item',
      label: 'Orphan',
      path: '/orphan',
      order: 1
      // ❌ no group
    });

    renderWithProviders(<MenuList />);

    expect(screen.queryByText('Orphan')).not.toBeInTheDocument();
  });

  it('renders nav items ONLY when their group exists', () => {
    registerNavGroup({
      id: 'test-group',
      label: 'Test Group',
      order: 1
    });

    registerNavItem({
      id: 'grouped-item',
      label: 'Grouped',
      path: '/grouped',
      group: 'test-group',
      order: 1
    });

    renderWithProviders(<MenuList />);

    expect(screen.getByText('Grouped')).toBeInTheDocument();
  });
});
