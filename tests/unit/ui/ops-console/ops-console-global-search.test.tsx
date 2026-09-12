import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import type { Alert } from 'pages/alerts/useAlerts';
import type { GlobalSearchResult } from 'components/OpsConsole/useGlobalSearch';

const mockNavigate = jest.fn();
const mockOnClose = jest.fn();
const mockUseGlobalSearch = jest.fn();
const mockUsePickBatches = jest.fn();

jest.mock('react-router-dom', () => ({ useNavigate: () => mockNavigate }));

jest.mock('components/OpsConsole/useGlobalSearch', () => ({
  useGlobalSearch: (...args: unknown[]) => mockUseGlobalSearch(...args),
}));

jest.mock('pages/wms/usePickBatches', () => ({
  usePickBatches: (...args: unknown[]) => mockUsePickBatches(...args),
  usePickBatchOrders: () => ({ data: { orders: [] }, isLoading: false, isError: false }),
}));

jest.mock('pages/wms/useOrderPool', () => ({
  useBulkSetPriority: () => ({ mutateAsync: jest.fn() }),
}));

jest.mock('@lasyncro/shared/ui', () => ({
  EntityDetailModal: ({ entityId, title, children }: any) =>
    entityId ? (
      <section data-testid="entity-detail-modal" aria-label={title}>
        {children}
      </section>
    ) : null,
}));

jest.mock('pages/orders/OrderDetailModalBody', () => ({
  OrderDetailModalBody: ({ orderId }: { orderId: string }) => (
    <div data-testid="order-detail-body">ORDER:{orderId}</div>
  ),
}));

jest.mock('pages/ft2-pages/BatchDetailModalBody', () => ({
  BatchDetailModalBody: ({ batch, onNavigateToOrder }: any) => (
    <div data-testid="batch-detail-body">
      BATCH:{batch.pick_batch_id}
      <button type="button" onClick={() => onNavigateToOrder('order-from-batch')}>
        Open order
      </button>
    </div>
  ),
}));

jest.mock('pages/ft2-pages/VariantDetailModalHost', () => ({
  VariantDetailModalHost: ({ variantId, onClose }: any) =>
    variantId ? (
      <section data-testid="variant-detail-host">
        VARIANT:{variantId}
        <button type="button" onClick={onClose}>
          Close variant
        </button>
      </section>
    ) : null,
}));

jest.mock('hooks/useActivationChecklist', () => ({
  useActivationChecklist: () => ({
    items: [{ key: 'map-zones', label: 'Map warehouse', complete: false }],
    completedCount: 0,
    allComplete: false,
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('pages/alerts/useAlerts', () => ({
  useAlerts: () => ({
    data: {
      data: [{
        id: 'history-1',
        alert_key: 'hk',
        source: 'wms',
        alert_type: 'wms_pick_exception',
        severity: 'warning',
        title: 'Closed alert',
        message: 'Closed',
        entity_id: null,
        entity_type: null,
        revenue_impact: null,
        category: null,
        audience: 'all',
        is_active: false,
        dismissed_at: null,
        resolved_at: '2026-09-08T09:00:00.000Z',
        acknowledged_at: null,
        acknowledged_by: null,
        snoozed_until: null,
        escalated_at: null,
        rule_id: null,
        created_at: '2026-09-08T08:00:00.000Z',
        updated_at: '2026-09-08T09:00:00.000Z',
      }],
      meta: { total: 1, status: 'resolved' },
    },
    isLoading: false,
    isError: false,
  }),
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: {} }),
}));

jest.mock('hooks/useAppTheme', () => ({
  useAppTheme: () => ({
    isDark: false,
    bg: 'var(--bg)', bg2: 'var(--bg-2)', bg3: 'var(--bg-3)', surface: 'var(--surface)',
    ink: 'var(--ink)', ink2: 'var(--ink-2)', ink3: 'var(--ink-3)', ink4: 'var(--ink-4)',
    rule: 'var(--rule)', rule2: 'var(--rule-2)',
    accent: 'var(--accent)', accentHover: 'var(--accent-hover)',
    accentGhost: 'var(--accent-ghost)', accentBorder: 'var(--accent-border)',
    rowHover: 'rgba(0,0,0,0.02)', tileHover: 'rgba(0,0,0,0.02)', shadowMd: 'none',
  }),
}));

import { OpsConsolePanel } from 'components/OpsConsole';

const searchResults: GlobalSearchResult[] = [
  { type: 'order', id: 'order-1', label: '100200', secondary: 'paid', meta: null, match: 'exact' },
  { type: 'batch', id: 'batch-1', label: 'batch-1', secondary: 'pending', meta: null, match: 'prefix' },
  { type: 'variant', id: 'variant-1', label: 'Widget Red', secondary: 'SKU-1', meta: 'LSP-ABCDEF23', match: 'text' },
  { type: 'order', id: 'order-2', label: '100201', secondary: null, meta: null, match: 'text' },
  { type: 'order', id: 'order-3', label: '100202', secondary: null, meta: null, match: 'text' },
  { type: 'order', id: 'order-4', label: '100203', secondary: null, meta: null, match: 'text' },
  { type: 'order', id: 'order-5', label: '100204', secondary: null, meta: null, match: 'text' },
];

function alert(over: Partial<Alert> = {}): Alert {
  return {
    id: 'a1', alert_key: 'k', source: 'wms', alert_type: 'wms_pick_exception',
    severity: 'critical', title: 'Pick exception on batch 12', message: 'm',
    entity_id: null, entity_type: null, revenue_impact: null, category: null,
    audience: 'all', is_active: true, dismissed_at: null, resolved_at: null,
    acknowledged_at: null, acknowledged_by: null, snoozed_until: null,
    escalated_at: null, rule_id: null,
    created_at: '2026-09-09T10:00:00.000Z', updated_at: '2026-09-09T10:00:00.000Z',
    ...over,
  };
}

function renderPanel() {
  return render(
    <OpsConsolePanel
      alerts={[alert()]}
      deepLink={() => ({ route: '/problem-center', label: 'Problem Center' })}
      open
      onClose={mockOnClose}
    />,
  );
}

function activeBatchQuery() {
  return {
    data: {
      batches: [{
        pick_batch_id: 'batch-1',
        status: 'pending',
        release_trigger: 'manual',
        total_line_items: 1,
        total_units: 1,
        units_picked: 0,
        units_packed: 0,
        picked_by: null,
        packed_by: null,
        pick_claimed_at: null,
        pick_completed_at: null,
        pack_claimed_at: null,
        pack_completed_at: null,
        released_at: '2026-09-11T10:00:00.000Z',
        assigned_operator_id: null,
        assigned_packer_id: null,
        picker_name: null,
        packer_name: null,
      }],
    },
    isLoading: false,
    isError: false,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUsePickBatches.mockReturnValue({
    data: { batches: [] },
    isLoading: false,
    isError: false,
  });
  mockUseGlobalSearch.mockImplementation((query: string) => ({
    data: query.trim().length >= 2 ? { results: searchResults } : undefined,
    isLoading: false,
    isError: false,
  }));
});

describe('Ops Console global search', () => {
  it('shows the idle terminal caret only while empty and unfocused', () => {
    renderPanel();

    const input = screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches');

    expect(screen.getByText('Pick exception on batch 12')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(input);
    expect(screen.getByTestId('ops-search-idle-caret')).toBeInTheDocument();

    act(() => {
      input.focus();
    });

    expect(document.activeElement).toBe(input);
    expect(screen.queryByTestId('ops-search-idle-caret')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '10' } });

    expect(input).toHaveValue('10');
    expect(screen.queryByTestId('ops-search-idle-caret')).not.toBeInTheDocument();

    fireEvent.change(input, { target: { value: '' } });
    act(() => {
      input.blur();
    });

    expect(screen.getByTestId('ops-search-idle-caret')).toBeInTheDocument();
  });

  it('does not request results for one character and shows quiet guidance', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches'), {
      target: { value: 'a' },
    });

    expect(screen.getByText('Keep typing…')).toBeInTheDocument();
    expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();
  });

  it('renders bounded backend results for 2+ characters', () => {
    renderPanel();
    fireEvent.change(screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches'), {
      target: { value: '10' },
    });

    const listbox = screen.getByRole('listbox', { name: 'Search results' });
    expect(within(listbox).getAllByRole('option')).toHaveLength(6);
    expect(within(listbox).getAllByText('ORDER')).toHaveLength(4);
    expect(within(listbox).getByText('BATCH')).toBeInTheDocument();
    expect(within(listbox).getByText('PRODUCT')).toBeInTheDocument();
  });

  it('uses ArrowDown + Enter to activate the selected result', () => {
    mockUsePickBatches.mockReturnValue(activeBatchQuery());
    renderPanel();
    const input = screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches');
    fireEvent.change(input, { target: { value: '10' } });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(screen.getByTestId('batch-detail-body')).toHaveTextContent('BATCH:batch-1');
  });

  it('clears results with Escape without closing the console', () => {
    renderPanel();
    const input = screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches');
    fireEvent.change(input, { target: { value: '10' } });
    expect(screen.getAllByRole('option')).toHaveLength(6);

    fireEvent.keyDown(input, { key: 'Escape' });

    expect(input).toHaveValue('');
    expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(mockOnClose).not.toHaveBeenCalled();
  });

  it('opens canonical order and batch destinations from search', () => {
    mockUsePickBatches.mockReturnValue(activeBatchQuery());
    renderPanel();
    fireEvent.change(screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches'), {
      target: { value: '10' },
    });

    fireEvent.click(screen.getByTestId('ops-search-result-order-order-1'));
    expect(screen.getByTestId('order-detail-body')).toHaveTextContent('ORDER:order-1');

    fireEvent.change(screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByTestId('ops-search-result-batch-batch-1'));
    expect(screen.getByTestId('batch-detail-body')).toHaveTextContent('BATCH:batch-1');
  });

  it('transitions from Batch Detail to Order Detail', () => {
    mockUsePickBatches.mockReturnValue(activeBatchQuery());
    renderPanel();
    fireEvent.change(screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByTestId('ops-search-result-batch-batch-1'));
    fireEvent.click(within(screen.getByTestId('batch-detail-body')).getByRole('button', { name: 'Open order' }));

    expect(screen.getByTestId('order-detail-body')).toHaveTextContent('ORDER:order-from-batch');
    expect(screen.queryByTestId('batch-detail-body')).not.toBeInTheDocument();
  });

  it('opens canonical variant detail over the current route without closing the console', () => {
    renderPanel();
    const input = screen.getByLabelText('Search orders, products, SKUs, barcodes, or batches');

    fireEvent.change(input, {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByTestId('ops-search-result-variant-variant-1'));

    expect(mockNavigate).not.toHaveBeenCalled();
    expect(mockOnClose).not.toHaveBeenCalled();
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
    expect(screen.getByTestId('variant-detail-host')).toHaveTextContent('VARIANT:variant-1');
    expect(input).toHaveValue('');
    expect(screen.queryByRole('listbox', { name: 'Search results' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close variant' }));

    expect(screen.queryByTestId('variant-detail-host')).not.toBeInTheDocument();
    expect(mockNavigate).not.toHaveBeenCalled();
    expect(screen.getByTestId('ops-console')).toBeInTheDocument();
  });

  it('keeps existing OPEN/HISTORY behavior intact', () => {
    renderPanel();

    expect(screen.getByText('NOW')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'HISTORY' }));
    expect(screen.getByText('ALERT HISTORY')).toBeInTheDocument();
    expect(screen.getByText('Closed alert')).toBeInTheDocument();
  });
});
