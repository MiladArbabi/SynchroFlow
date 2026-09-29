// tests/unit/ui/shared/IsometricCanvas.keyboardInspection.render.test.tsx
//
// RED-E — shared map inspection is keyboard operable (generic, no domain
// vocabulary).
//
// - An INSPECTABLE bin is a keyboard target: focusable, an interactive role,
//   an accessible name carrying its location code.
// - Enter and Space run the SAME selection grammar as a pointer click,
//   including toggle-off on repeat.
// - A NON-inspectable bin stays plain geometry — never a keyboard target.
// - Escape clears an active pinned selection through the existing contract.
// - Pointer click selection is unchanged.
//
// Real IsometricCanvas render; the location's pulse is supplied so a pinned
// card is observable.

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { IsometricCanvas, type WarehouseZone } from '@lasyncro/shared/ui';

function zone(location_code: string, x: number): WarehouseZone {
  return {
    location_code,
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: x,
    position_y: 1,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type: 'storage',
    last_printed_at: null,
    warehouse_name: null,
  };
}

const ZONES = [zone('A-1', 1), zone('B-1', 3)];
const PULSES = {
  'A-1': { title: 'A-1', rows: [{ label: 'On hand', value: '4 units' }] },
  'B-1': { title: 'B-1', rows: [{ label: 'On hand', value: '2 units' }] },
};

function renderCanvas(onSelect = jest.fn()) {
  const view = render(
    <IsometricCanvas
      zones={ZONES}
      enableHoverFocus
      inspectableLocationCodes={new Set(['A-1'])}
      locationPulseByCode={PULSES}
      onSelect={onSelect}
    />
  );
  return { ...view, onSelect };
}

function keyboardTarget(code: string): HTMLElement | SVGElement {
  return screen.getByRole('button', { name: new RegExp(code) });
}

function pinnedCard() {
  return screen.queryByTestId('isometric-pulse-card');
}

describe('IsometricCanvas keyboard inspection — inspectable bin', () => {
  it('is focusable with an interactive role and an accessible name carrying its code', () => {
    renderCanvas();
    const target = keyboardTarget('A-1');

    expect(target.getAttribute('tabindex')).toBe('0');
    expect(target).toHaveAttribute('role', 'button');
    expect(target).toHaveAccessibleName('Inspect location A-1');
    expect(target).toHaveAttribute('aria-pressed', 'false');
    expect(target).toHaveStyle({ outline: 'none' });
    act(() => target.focus());
    expect(document.activeElement).toBe(target);
    expect(pinnedCard()).toHaveAttribute('data-pinned', 'false');
    expect(target.querySelector('polygon')).toHaveAttribute('stroke-width', '1.4');
    expect(target.querySelector('polygon[stroke-dasharray="4 2"]')).toBeNull();
    act(() => target.blur());
    expect(pinnedCard()).toBeNull();
    expect(target.querySelector('polygon')).toHaveAttribute('stroke-width', '1');
  });

  it('Enter selects and pins, repeated Enter toggles off — same grammar as pointer', () => {
    const { onSelect } = renderCanvas();
    const target = keyboardTarget('A-1');

    fireEvent.keyDown(target, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith('A-1');
    expect(pinnedCard()).toHaveAttribute('data-pinned', 'true');
    expect(target).toHaveAttribute('aria-pressed', 'true');
    expect(target.querySelector('polygon[stroke-dasharray="4 2"]')).toHaveAttribute('stroke-width', '2');

    fireEvent.keyDown(target, { key: 'Enter' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(pinnedCard()).toBeNull();
    expect(target).toHaveAttribute('aria-pressed', 'false');
    expect(target.querySelector('polygon[stroke-dasharray="4 2"]')).toBeNull();
  });

  it('Space selects and pins, repeated Space toggles off', () => {
    const { onSelect } = renderCanvas();
    const target = keyboardTarget('A-1');

    fireEvent.keyDown(target, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith('A-1');
    expect(pinnedCard()).toHaveAttribute('data-pinned', 'true');

    fireEvent.keyDown(target, { key: ' ' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(pinnedCard()).toBeNull();
  });
});

describe('IsometricCanvas keyboard inspection — non-inspectable geometry', () => {
  it('a non-inspectable bin is not a keyboard target', () => {
    const { container } = renderCanvas();

    expect(screen.queryByRole('button', { name: /B-1/ })).toBeNull();
    const label = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === 'B-1');
    expect(label).toBeDefined();
    expect(label!.closest('[tabindex]')).toBeNull();
  });
});

describe('IsometricCanvas keyboard inspection — Escape', () => {
  it('Escape clears an active pinned selection', () => {
    const { onSelect } = renderCanvas();
    const target = keyboardTarget('A-1');

    fireEvent.keyDown(target, { key: 'Enter' });
    expect(pinnedCard()).toHaveAttribute('data-pinned', 'true');

    fireEvent.keyDown(target, { key: 'Escape' });
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(pinnedCard()).toBeNull();
  });
});

describe('IsometricCanvas keyboard inspection — pointer regression', () => {
  it('pointer click still selects, pins and toggles off', () => {
    const { container, onSelect } = renderCanvas();
    const label = Array.from(container.querySelectorAll('text')).find((t) => t.textContent === 'A-1');
    const boxGroup = label!.closest('g')!;

    fireEvent.click(boxGroup);
    expect(onSelect).toHaveBeenLastCalledWith('A-1');
    expect(pinnedCard()).toHaveAttribute('data-pinned', 'true');

    fireEvent.click(boxGroup);
    expect(onSelect).toHaveBeenLastCalledWith(null);
    expect(pinnedCard()).toBeNull();
  });
});
