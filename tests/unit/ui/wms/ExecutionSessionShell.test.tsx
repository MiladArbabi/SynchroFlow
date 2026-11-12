/**
 * SF-PICK-P1-SHARED-SHELL-01 — presentation-only execution shell shared by
 * Stow and Pick. Business state stays in each page; the shell only renders
 * labels, progress tones and callbacks it is given.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import {
  ExecutionSessionShell,
  EXECUTION_PROGRESS_COLOR,
  type ExecutionSessionShellProps,
} from '../../../../modules/wms/src/ui/components/ExecutionSessionShell';

function renderShell(overrides: Partial<ExecutionSessionShellProps> = {}) {
  const props: ExecutionSessionShellProps = {
    workflowLabel: 'PICK',
    testId: 'pick-session-shell',
    backAriaLabel: 'Back to pick session',
    sourceLabel: 'Batch 1A2B3C4D',
    positionLabel: 'Stop 2 of 3',
    progressLabel: '1 of 3 stops picked',
    bars: ['done', 'flagged', 'current', 'idle'],
    exitDisabled: false,
    map: <div data-testid="map-slot">map</div>,
    desktopMapLayout: false,
    overlay: <div data-testid="overlay-slot" />,
    children: <div data-testid="task-slot">task</div>,
    ...overrides,
  };
  return render(<ExecutionSessionShell {...props} />);
}

describe('ExecutionSessionShell', () => {
  it('renders the configured workflow label, test id and header labels', () => {
    renderShell();
    expect(screen.getByTestId('pick-session-shell')).toBeTruthy();
    expect(screen.getByText('PICK')).toBeTruthy();
    expect(screen.getByText('Batch 1A2B3C4D')).toBeTruthy();
    expect(screen.getByText('Stop 2 of 3')).toBeTruthy();
    expect(screen.getByText('1 of 3 stops picked')).toBeTruthy();
  });

  it('defines a distinct colour for every progress tone, including flagged', () => {
    const tones = Object.keys(EXECUTION_PROGRESS_COLOR).sort();
    expect(tones).toEqual(['current', 'done', 'flagged', 'idle']);
    expect(new Set(Object.values(EXECUTION_PROGRESS_COLOR)).size).toBe(4);
  });

  it('renders one progress segment per tone', () => {
    const { container } = renderShell();
    const bar = container.querySelector('header [aria-hidden="true"]');
    expect(bar?.children.length).toBe(4);
  });

  it('omits the progress bar when there are no segments', () => {
    const { container } = renderShell({ bars: [] });
    expect(container.querySelector('header [aria-hidden="true"]')).toBeNull();
  });

  it('wires back and exit callbacks and respects exitDisabled', () => {
    const onBack = jest.fn();
    const onExit = jest.fn();
    const { rerender } = renderShell({ onBack, onExit });
    fireEvent.click(screen.getByRole('button', { name: 'Back to pick session' }));
    fireEvent.click(screen.getByRole('button', { name: 'Exit' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledTimes(1);

    rerender(
      <ExecutionSessionShell
        workflowLabel="PICK"
        testId="pick-session-shell"
        backAriaLabel="Back to pick session"
        sourceLabel=""
        positionLabel=""
        progressLabel=""
        bars={[]}
        onExit={onExit}
        exitDisabled
        map={null}
        desktopMapLayout={false}
        overlay={null}
      >
        <div />
      </ExecutionSessionShell>,
    );
    expect((screen.getByRole('button', { name: 'Exit' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Back to pick session' })).toBeNull();
  });

  it('renders task, map, footer and overlay slots', () => {
    renderShell({ footer: <button type="button">Show map</button> });
    expect(screen.getByTestId('task-slot')).toBeTruthy();
    expect(screen.getByTestId('map-slot')).toBeTruthy();
    expect(screen.getByTestId('overlay-slot')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Show map' }).closest('footer')).toBeTruthy();
  });

  it('places the map in its own column only in desktop map layout', () => {
    const { rerender } = renderShell({ desktopMapLayout: true });
    const map = screen.getByTestId('map-slot');
    const task = screen.getByTestId('task-slot');
    expect(map.parentElement?.contains(task)).toBe(false);

    rerender(
      <ExecutionSessionShell
        workflowLabel="PICK"
        testId="pick-session-shell"
        backAriaLabel="Back to pick session"
        sourceLabel=""
        positionLabel=""
        progressLabel=""
        bars={[]}
        exitDisabled={false}
        map={<div data-testid="map-slot">map</div>}
        desktopMapLayout={false}
        overlay={null}
      >
        <div data-testid="task-slot">task</div>
      </ExecutionSessionShell>,
    );
    expect(screen.getByTestId('map-slot').parentElement).toBe(screen.getByTestId('task-slot').parentElement);
  });
});
