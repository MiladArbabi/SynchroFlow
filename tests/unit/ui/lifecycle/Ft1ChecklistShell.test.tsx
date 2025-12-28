// tests/unit/ui/lifecycle/Ft1ChecklistShell.test.tsx
import React from 'react';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';

import { Ft1ChecklistShell } from 'lifecycle/Ft1ChecklistShell';

// ---- mock analytics hook ----
const mockEmit = jest.fn();

jest.mock('analytics/useUiEvents', () => ({
  useUiEvents: () => ({
    emit: mockEmit,
  }),
}));

describe('Ft1ChecklistShell — FT1 onboarding checklist', () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  const checklistData = {
    modules: [
      {
        moduleId: 'order-nexus',
        title: 'Order Nexus',
        tasks: [
          { id: 'connect-store', label: 'Connect store', completed: true },
          { id: 'sync-orders', label: 'Sync orders', completed: false },
        ],
      },
      {
        moduleId: 'customers',
        title: 'Customers',
        tasks: [
          { id: 'enable-tracking', label: 'Enable tracking', completed: false },
        ],
      },
    ],
  };

  it('renders the checklist shell container', () => {
    renderWithTheme(<Ft1ChecklistShell checklist={checklistData} />);

    expect(
      screen.getByTestId('ft1-checklist-shell')
    ).toBeInTheDocument();
  });

  it('renders module sections', () => {
    renderWithTheme(<Ft1ChecklistShell checklist={checklistData} />);

    expect(screen.getByText('Order Nexus')).toBeInTheDocument();
    expect(screen.getByText('Customers')).toBeInTheDocument();
  });

  it('renders tasks with correct labels', () => {
    renderWithTheme(<Ft1ChecklistShell checklist={checklistData} />);

    expect(screen.getByText('Connect store')).toBeInTheDocument();
    expect(screen.getByText('Sync orders')).toBeInTheDocument();
    expect(screen.getByText('Enable tracking')).toBeInTheDocument();
  });

  it('emits ui.intent when a task is clicked', () => {
    renderWithTheme(<Ft1ChecklistShell checklist={checklistData} />);

    fireEvent.click(screen.getByText('Sync orders'));

    expect(mockEmit).toHaveBeenCalledWith({
      event: 'ui.intent',
      payload: {
        action: 'task_click:sync-orders',
        surface: 'ft1_checklist',
        moduleId: 'order-nexus',
      },
    });
  });


  it('does not expose lifecycle, entitlement, or theme metadata', () => {
    renderWithTheme(<Ft1ChecklistShell checklist={checklistData} />);

    const shell = screen.getByTestId('ft1-checklist-shell');

    expect(shell.getAttribute('data-phase')).toBeNull();
    expect(shell.getAttribute('data-entitlement')).toBeNull();
    expect(shell.getAttribute('data-theme')).toBeNull();
  });
});