//tests/unit/ui/lifecycle/Ft1ChecklistShell.focus.test.tsx
import React from 'react';
import { screen } from '@testing-library/react';
import { renderWithTheme } from 'test-utils';

import { Ft1ChecklistShell } from 'lifecycle/Ft1ChecklistShell';
import * as focusModule from 'activation/ft1ChecklistFocus';

describe('Ft1ChecklistShell – focus consumption', () => {
    
    beforeAll(() => {
        Element.prototype.scrollIntoView = jest.fn();
    });

  it('consumes ft1 checklist focus exactly once on open transition', () => {
    // arrange
    const consumeSpy = jest.spyOn(focusModule, 'consumeFt1ChecklistFocus');

    focusModule.setFt1ChecklistFocus({
      moduleId: 'orders',
      taskId: 'connect',
    });

    const checklist = {
      modules: [
        {
          moduleId: 'orders',
          title: 'Orders',
          tasks: [
            { id: 'connect', label: 'Connect orders', completed: false },
          ],
        },
      ],
    };

    // act – initial closed render
    const { rerender } = renderWithTheme(
      <Ft1ChecklistShell checklist={checklist} open={false} />
    );

    // act – open transition
    rerender(
      <Ft1ChecklistShell checklist={checklist} open={true} />
    );

    // assert – module expanded
    expect(screen.getByText('Orders')).toBeInTheDocument();

    // assert – focused task rendered
    expect(screen.getByText('Connect orders')).toBeInTheDocument();

    // assert – CRITICAL: focus consumed exactly once
    expect(consumeSpy).toHaveBeenCalledTimes(1);
  });
});
