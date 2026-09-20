import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { IsometricCanvas, type SyntheticStation, type WarehouseZone } from '@lasyncro/shared/ui';

function zone(location_code: string, zone_type = 'pick'): WarehouseZone {
  return {
    location_code,
    type: 'bin',
    parent_location_code: null,
    barcode: null,
    active: true,
    children_count: 0,
    position_x: location_code === 'B-1' ? 3 : 1,
    position_y: 1,
    width: 1,
    depth: 0.5,
    orientation: 0,
    rack_levels: 1,
    zone_type,
    last_printed_at: null,
    warehouse_name: null,
  };
}

function floorAnchor(): WarehouseZone {
  return { ...zone('FLOOR'), type: 'warehouse', width: 6, depth: 6, zone_type: 'storage' };
}

function station(overrides: Partial<SyntheticStation> = {}): SyntheticStation {
  return {
    id: 'pool',
    label: 'Order Pool',
    side: 'inbound',
    rank: 1,
    count: 20,
    ...overrides,
  };
}

function physicalOuterGroup(container: HTMLElement, locationCode: string): Element {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === locationCode
  );
  if (!textEl) throw new Error(`Missing zone label ${locationCode}`);
  const boxGroup = textEl.closest('g');
  if (!boxGroup) throw new Error(`Missing box group for ${locationCode}`);
  return boxGroup;
}

function stationOuterGroup(container: HTMLElement, label: string): Element {
  const textEl = Array.from(container.querySelectorAll('text')).find(
    (t) => t.textContent === label
  );
  if (!textEl) throw new Error(`Missing station label ${label}`);
  const plateGroup = textEl.closest('g');
  const outerGroup = plateGroup?.parentElement;
  if (!outerGroup) throw new Error(`Missing station group for ${label}`);
  return outerGroup;
}

const locationPulseByCode = {
  'PROBLEM': {
    title: 'PROBLEM',
    rows: [
      { label: 'On hand', value: '0 units' },
      { label: 'State', value: 'Critical — Open warehouse issue', tone: 'critical' as const },
      { label: 'Open issues', value: '5', tone: 'critical' as const },
    ],
  },
  'B-1': {
    title: 'B-1 · PICK',
    rows: [{ label: 'On hand', value: '2 units' }],
  },
};

const stationPulseById = {
  pool: {
    title: 'ORDER POOL',
    rows: [
      { label: 'Orders', value: '20 ready' },
      { label: 'State', value: 'Ready for release', tone: 'muted' as const },
    ],
  },
};

describe('IsometricCanvas pinned pulse card', () => {
  it('hover card remains transient without selection', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem')]}
        enableHoverFocus
        locationPulseByCode={locationPulseByCode}
      />
    );
    const problem = physicalOuterGroup(container, 'PROBLEM');
    fireEvent.mouseEnter(problem.parentElement!);
    const card = screen.getByTestId('isometric-pulse-card');
    expect(card).toHaveAttribute('data-pinned', 'false');
    expect(within(card).getByText('PROBLEM')).toBeInTheDocument();

    fireEvent.mouseLeave(problem.parentElement!);
    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
  });

  it('click pins the same card, mouse leave does not dismiss it, and same-object click deselects it', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem')]}
        enableHoverFocus
        locationPulseByCode={locationPulseByCode}
        problemByLocation={{ PROBLEM: 5 }}
        pinnedAction={{ label: 'Open Problem Center →', onClick: jest.fn() }}
      />
    );
    const problem = physicalOuterGroup(container, 'PROBLEM');
    fireEvent.click(problem);
    expect(screen.getByTestId('isometric-pulse-card')).toHaveAttribute('data-pinned', 'true');
    expect(screen.getByText('Critical — Open warehouse issue')).toBeInTheDocument();
    expect(screen.queryByText('State')).not.toBeInTheDocument();
    expect(screen.getByText('Open Problem Center →')).toBeInTheDocument();

    fireEvent.mouseLeave(problem);
    expect(screen.getByTestId('isometric-pulse-card')).toHaveAttribute('data-pinned', 'true');

    fireEvent.click(problem);
    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
  });

  it('selecting another object replaces the pinned card and only one pulse card exists', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem'), zone('B-1')]}
        enableHoverFocus
        locationPulseByCode={locationPulseByCode}
        problemByLocation={{ PROBLEM: 5 }}
      />
    );
    fireEvent.click(physicalOuterGroup(container, 'PROBLEM'));
    expect(within(screen.getByTestId('isometric-pulse-card')).getByText('PROBLEM')).toBeInTheDocument();

    fireEvent.click(physicalOuterGroup(container, 'B-1'));
    const card = screen.getByTestId('isometric-pulse-card');
    expect(within(card).queryByText('PROBLEM')).not.toBeInTheDocument();
    expect(within(card).getByText('B-1 · PICK')).toBeInTheDocument();
    expect(screen.getAllByTestId('isometric-pulse-card')).toHaveLength(1);
  });

  it('close clears selection and pinned card', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem')]}
        locationPulseByCode={locationPulseByCode}
      />
    );
    fireEvent.click(physicalOuterGroup(container, 'PROBLEM'));
    fireEvent.click(screen.getByLabelText('Close map inspection'));
    expect(screen.queryByTestId('isometric-pulse-card')).not.toBeInTheDocument();
  });

  it('pinned action callbacks navigate by caller-owned behavior and click itself does not trigger it', () => {
    const action = jest.fn();
    const { container } = render(
      <IsometricCanvas
        zones={[zone('PROBLEM', 'problem')]}
        locationPulseByCode={locationPulseByCode}
        pinnedAction={{ label: 'Open Problem Center →', onClick: action }}
      />
    );
    fireEvent.click(physicalOuterGroup(container, 'PROBLEM'));
    expect(action).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('Open Problem Center →'));
    expect(action).toHaveBeenCalledTimes(1);
  });

  it('physical no-problem selection has no CTA when caller passes no pinned action', () => {
    const { container } = render(
      <IsometricCanvas
        zones={[zone('B-1')]}
        locationPulseByCode={locationPulseByCode}
      />
    );
    fireEvent.click(physicalOuterGroup(container, 'B-1'));
    expect(screen.getByTestId('isometric-pulse-card')).toHaveAttribute('data-pinned', 'true');
    expect(screen.queryByText('Open Problem Center →')).not.toBeInTheDocument();
  });

  it('pinned station shows order-flow action without replacing operational fill semantics', () => {
    const action = jest.fn();
    const { container } = render(
      <IsometricCanvas
        zones={[floorAnchor()]}
        stations={[station()]}
        stationPulseById={stationPulseById}
        operationalStateByStation={{ pool: 'active' }}
        pinnedAction={{ label: 'Open order flow →', onClick: action }}
      />
    );
    const group = stationOuterGroup(container, 'Order Pool');
    fireEvent.click(group);
    expect(screen.getByText('Ready for release')).toBeInTheDocument();
    expect(screen.getByText('20 ready')).toBeInTheDocument();
    expect(screen.getByText('Open order flow →')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Open order flow →'));
    expect(action).toHaveBeenCalledTimes(1);

    const topBar = group.querySelectorAll('polygon')[2];
    expect(topBar.getAttribute('fill')).toBe('var(--space-azure)');
    expect(topBar.getAttribute('stroke')).toBe('var(--accent)');
  });
});
