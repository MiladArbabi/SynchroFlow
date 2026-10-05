// GH-1208 — real planning page/module; isolate only data and shell boundaries.
import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ConfigProvider } from 'contexts/ConfigContext';
import useConfig from 'hooks/useConfig';
import DemandPage from 'pages/ft2-pages/DemandPage';
import type { DemandVelocity } from '../../../../modules/demand/src/ui/pages/DemandModuleFT2';

const mockGate = jest.fn();
const mockUseDemand = jest.fn();
jest.mock('@lasyncro/demand', () => ({
  DemandModuleFT2: jest.requireActual('../../../../modules/demand/src/ui/pages/DemandModuleFT2').default,
}), { virtual: true });
jest.mock('pages/products/useDemand', () => ({ useDemand: () => mockUseDemand() }));
jest.mock('contexts/EntitlementsContext', () => ({ useEntitlements: () => ({ displayCurrency: 'USD', locale: 'en-US' }) }));
jest.mock('hooks/useExchangeRates', () => ({ useExchangeRates: () => ({ rates: {} }) }));
jest.mock('components/ModuleTabBar', () => ({ ModuleTabBar: () => null }));
jest.mock('components/CommercialGate', () => ({ CommercialGate: ({ children, capabilityId }: any) => {
  mockGate(capabilityId);
  return <>{children}</>;
} }));
jest.mock('@lasyncro/shared/ui', () => ({
  OperationalContextShell: jest.requireActual('../../../../modules/shared/src/ui/OperationalContextShell').OperationalContextShell,
  ModuleErrorBoundary: ({ children }: any) => <>{children}</>,
  ModuleLoadingSkeleton: () => <div>Loading planning</div>,
  formatCurrencyCompact: (value: number) => String(value),
}));

function variant(id: string, urgency: DemandVelocity['reorder_urgency']): DemandVelocity {
  return {
    lasyncro_variant_id: id, title: id, sku: `SKU-${id}`, product_title: id,
    unit_cost: 10, available_quantity: 4, units_sold_30d: 30, units_sold_prev_30d: 30,
    velocity_per_day: 1, velocity_window_days: 30, demand_confidence: 'high', velocity_trend: 'stable',
    days_of_stock_remaining: 4, reorder_signal: urgency === 'critical' || urgency === 'warning',
    reorder_urgency: urgency, estimated_stockout_date: '2026-10-09', suggested_reorder_qty: 26,
    supplier_lead_time_days: 7,
  };
}

function ConsoleControls() {
  const { dispatch } = useConfig();
  return <>
    <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: true })}>open console</button>
    <button onClick={() => dispatch({ type: 'SET_OPS_CONSOLE', payload: false })}>close console</button>
  </>;
}

function renderPlanning(search = '') {
  return render(<ConfigProvider><MemoryRouter initialEntries={[`/inventory/replenishment${search}`]}>
    <ConsoleControls /><DemandPage />
  </MemoryRouter></ConfigProvider>);
}

function filter(name: string) {
  return screen.getByRole('button', { name: new RegExp(`^${name}(?: \\d+)?$`, 'i') });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockUseDemand.mockReturnValue({ isLoading: false, isError: false, data: {
    // Non-action rows deliberately precede risks: default priority must use planning state.
    variants: [
      variant('healthy-item', 'healthy'),
      { ...variant('gap-item', 'planning_data_required'), suggested_reorder_qty: null, supplier_lead_time_days: null },
      { ...variant('quiet-item', 'no_velocity'), velocity_per_day: 0, units_sold_30d: 0, days_of_stock_remaining: null, suggested_reorder_qty: null },
      variant('critical-item', 'critical'), variant('warning-item', 'warning'),
    ],
    summary: { total_variants_tracked: 5, critical_reorder_count: 1, warning_reorder_count: 1,
      stockout_count: 0, avg_days_of_stock: 4, total_inventory_value: 200 },
    computed_at: '2026-10-05T08:00:00Z',
  } });
});

describe('GH-1208 Replenishment screen contract', () => {
  it('uses the merchant name Replenishment', () => {
    renderPlanning();
    expect(screen.getByRole('heading', { name: /^Replenishment$/ })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Demand$/ })).toBeNull();
  });

  it('composes its workspace and Replenishment State rail through OperationalContextShell', () => {
    const { container } = renderPlanning();
    const shell = container.querySelector('[data-operational-context-shell]');
    expect(shell).not.toBeNull();
    const rail = screen.getByRole('complementary', { name: /replenishment state/i });
    expect(rail.closest('[data-shell-track="rail"]')?.parentElement).toBe(shell);
    expect(shell!.querySelector('[data-shell-track="primary"]')).toContainElement(screen.getByText('critical-item'));
  });

  it('offers At risk / Planning gaps / All quick filters', () => {
    renderPlanning();
    expect(filter('At risk')).toBeInTheDocument();
    expect(filter('Planning gaps')).toBeInTheDocument();
    expect(filter('All')).toBeInTheDocument();
  });

  it('prioritizes critical and warning by default, without requiring an expansion', () => {
    renderPlanning();
    expect(screen.getByText('critical-item')).toBeVisible();
    expect(screen.getByText('warning-item')).toBeVisible();
    const visibleItems = screen.getAllByText(/^(healthy|gap|quiet|critical|warning)-item$/)
      .filter(node => window.getComputedStyle(node.closest('.MuiCollapse-root') ?? node).visibility !== 'hidden');
    expect(visibleItems.slice(0, 2).map(node => node.textContent)).toEqual(['critical-item', 'warning-item']);
  });

  it('Planning gaps explicitly represents planning_data_required without treating it as healthy', () => {
    renderPlanning();
    fireEvent.click(filter('Planning gaps'));
    expect(screen.getByText('gap-item')).toBeVisible();
    expect(within(screen.getByText('gap-item').closest('tr')!).getByText(/^Data needed$/)).toBeVisible();
    // Either removing filtered rows or hiding them satisfies exclusion.
    for (const node of screen.queryAllByText(/^(healthy|critical)-item$/)) {
      expect(node).not.toBeVisible();
    }
  });

  it('All reaches healthy and no_velocity as No recent demand', () => {
    renderPlanning();
    fireEvent.click(filter('All'));
    expect(screen.getByText('healthy-item')).toBeVisible();
    expect(screen.getByText('quiet-item')).toBeVisible();
    expect(screen.getByText('gap-item')).toBeVisible();
    expect(screen.queryAllByText(/^No recent demand$/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^No recent sales$/i)).toBeNull();
  });

  it('represents no_velocity with the planning vocabulary No recent demand', () => {
    renderPlanning();
    // The existing collapsed rows remain in the DOM. Protect this state label
    // independently so a missing All control cannot conceal the copy boundary.
    expect(screen.queryAllByText(/^No recent demand$/i).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^No recent sales$/i)).toBeNull();
  });

  it('does not relabel planning states with Sourcing purchasing categories or expose supplier/PO execution', () => {
    const { container } = renderPlanning();
    expect(within(container).queryAllByText(/^(Needs supplier|Needs purchase|In purchasing|Covered inbound|Plan ahead)$/i)).toEqual([]);
    expect(within(container).queryAllByRole('button', { name: /(?:create|convert|send|approve).*(?:purchase order|\bPO\b)|add.*queue|choose supplier|select supplier/i })).toEqual([]);
    expect(within(container).queryAllByRole('textbox', { name: /supplier|MOQ|purchase order/i })).toEqual([]);
  });

  it('critical and warning handoffs say Review sourcing and target the exact canonical variant IDs', () => {
    renderPlanning();
    expect(screen.queryAllByRole('link', { name: /^Review sourcing$/i }).map(link => link.getAttribute('href'))).toEqual([
      '/suppliers-portal/sourcing?variantId=critical-item',
      '/suppliers-portal/sourcing?variantId=warning-item',
    ]);
  });

  it('retains exact variant-targeted Sourcing URLs independently of the label change', () => {
    renderPlanning();
    expect(screen.getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
      '/suppliers-portal/sourcing?variantId=critical-item',
      '/suppliers-portal/sourcing?variantId=warning-item',
    ]);
  });

  it('preserves ?filter=critical and the demand.forecasting page gate', () => {
    renderPlanning('?filter=critical');
    expect(mockGate).toHaveBeenCalledWith('demand.forecasting');
    expect(screen.getByText('critical-item')).toBeVisible();
    expect(screen.queryByText('warning-item')).toBeNull();
  });

  it('Ops open withdraws the rail and close restores it while preserving the same primary node', () => {
    const { container } = renderPlanning();
    const shell = container.querySelector('[data-operational-context-shell]');
    expect(shell).not.toBeNull();
    const primary = shell!.querySelector('[data-shell-track="primary"]');
    const item = screen.getByText('critical-item');
    const rail = screen.getByRole('complementary', { name: /replenishment state/i });
    const railTrack = rail.closest('[data-shell-track="rail"]');
    fireEvent.click(screen.getByRole('button', { name: 'open console' }));
    expect(screen.queryByRole('complementary', { name: /replenishment state/i })).toBeNull();
    expect(railTrack).toBeEmptyDOMElement();
    expect(railTrack).toHaveAttribute('data-rail-suppressed', 'true');
    expect(shell!.querySelector('[data-shell-track="primary"]')).toBe(primary);
    expect(screen.getByText('critical-item')).toBe(item);
    fireEvent.click(screen.getByRole('button', { name: 'close console' }));
    expect(screen.getByRole('complementary', { name: /replenishment state/i }).closest('[data-shell-track="rail"]')).toBe(railTrack);
    expect(railTrack).toHaveAttribute('data-rail-suppressed', 'false');
    expect(shell!.querySelector('[data-shell-track="primary"]')).toBe(primary);
    expect(screen.getByText('critical-item')).toBe(item);
  });

  it('suppressed rail has display:none below lg so it cannot leave an empty stacked row', () => {
    const { container } = renderPlanning();
    fireEvent.click(screen.getByRole('button', { name: 'open console' }));
    const railTrack = container.querySelector('[data-shell-track="rail"]');
    expect(railTrack).not.toBeNull();
    expect(railTrack).toBeEmptyDOMElement();
    // JSDOM has no breakpoint layout. Inspect emitted responsive CSS, not computed media styles.
    const rules = Array.from(document.styleSheets).flatMap(sheet => Array.from(sheet.cssRules));
    const base = rules.filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
      .filter(rule => railTrack!.matches(rule.selectorText));
    const xs = rules.filter((rule): rule is CSSMediaRule => rule.type === CSSRule.MEDIA_RULE)
      .filter(rule => /min-width:\s*0px/.test(rule.conditionText))
      .flatMap(rule => Array.from(rule.cssRules))
      .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
      .filter(rule => railTrack!.matches(rule.selectorText));
    expect([...base, ...xs].some(rule => rule.style.display === 'none')).toBe(true);
    const desktop = rules.filter((rule): rule is CSSMediaRule => rule.type === CSSRule.MEDIA_RULE)
      .filter(rule => /min-width:\s*1200px/.test(rule.conditionText))
      .flatMap(rule => Array.from(rule.cssRules))
      .filter((rule): rule is CSSStyleRule => rule.type === CSSRule.STYLE_RULE)
      .filter(rule => railTrack!.matches(rule.selectorText));
    expect(desktop.some(rule => rule.style.display === 'block')).toBe(true);
  });
});


// GH-1208 browser correction RED: display only; canonical planning values stay unchanged.
describe('GH-1208 Replenishment browser correction', () => {
  it('keeps quick filters in At risk / Planning gaps / All visual order', () => {
    renderPlanning();
    expect(within(screen.getByRole('group', { name: 'Replenishment filters' }))
      .getAllByRole('button').map(button => button.textContent)).toEqual(['At risk', 'Planning gaps', 'All']);
  });

  it('selects At risk when risks and planning gaps are both present', () => {
    renderPlanning();
    expect(filter('At risk')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('Planning gaps')).toHaveAttribute('aria-pressed', 'false');
    expect(filter('All')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('critical-item')).toBeVisible();
    expect(screen.getByText('warning-item')).toBeVisible();
    expect(screen.queryByText('gap-item')).toBeNull();
  });

  it('defaults to Planning gaps when no risks exist but planning data is needed', () => {
    const result = mockUseDemand();
    result.data.variants = result.data.variants.filter((v: DemandVelocity) => v.reorder_urgency !== 'critical' && v.reorder_urgency !== 'warning');
    result.data.summary = { ...result.data.summary, total_variants_tracked: 3, critical_reorder_count: 0, warning_reorder_count: 0 };
    renderPlanning();
    expect(filter('Planning gaps')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('At risk')).toHaveAttribute('aria-pressed', 'false');
    expect(filter('All')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('gap-item')).toBeVisible();
    expect(screen.queryByText('healthy-item')).toBeNull();
  });

  it('defaults to All when there are neither risks nor planning gaps', () => {
    const result = mockUseDemand();
    result.data.variants = result.data.variants.filter((v: DemandVelocity) => v.reorder_urgency === 'healthy' || v.reorder_urgency === 'no_velocity');
    result.data.summary = { ...result.data.summary, total_variants_tracked: 2, critical_reorder_count: 0, warning_reorder_count: 0 };
    renderPlanning();
    expect(filter('All')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('At risk')).toHaveAttribute('aria-pressed', 'false');
    expect(filter('Planning gaps')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('healthy-item')).toBeVisible();
    expect(screen.getByText('quiet-item')).toBeVisible();
  });

  it('keeps the automatic default live across refreshed planning truth until the merchant chooses a filter', () => {
    const initial = mockUseDemand();
    const { rerender } = renderPlanning();

    expect(filter('At risk')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('critical-item')).toBeVisible();

    const refreshed = {
      ...initial,
      data: {
        ...initial.data,
        variants: initial.data.variants.filter(
          (v: DemandVelocity) =>
            v.reorder_urgency !== 'critical' && v.reorder_urgency !== 'warning',
        ),
        summary: {
          ...initial.data.summary,
          total_variants_tracked: 3,
          critical_reorder_count: 0,
          warning_reorder_count: 0,
        },
        computed_at: '2026-10-05T08:05:00Z',
      },
    };

    mockUseDemand.mockReturnValue(refreshed);

    rerender(
      <ConfigProvider>
        <MemoryRouter initialEntries={['/inventory/replenishment']}>
          <ConsoleControls />
          <DemandPage />
        </MemoryRouter>
      </ConfigProvider>,
    );

    expect(filter('Planning gaps')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('At risk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('gap-item')).toBeVisible();
    expect(screen.queryByText('critical-item')).toBeNull();

    fireEvent.click(filter('All'));
    expect(filter('All')).toHaveAttribute('aria-pressed', 'true');

    mockUseDemand.mockReturnValue(initial);

    rerender(
      <ConfigProvider>
        <MemoryRouter initialEntries={['/inventory/replenishment']}>
          <ConsoleControls />
          <DemandPage />
        </MemoryRouter>
      </ConfigProvider>,
    );

    expect(filter('All')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('At risk')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('critical-item')).toBeVisible();
    expect(screen.getByText('gap-item')).toBeVisible();
  });

  it('explicit critical URL remains critical-only despite other contextual states', () => {
    renderPlanning('?filter=critical');
    expect(screen.getByText('critical-item')).toBeVisible();
    expect(screen.queryByText('warning-item')).toBeNull();
    expect(screen.queryByText('gap-item')).toBeNull();
    expect(screen.queryByText('healthy-item')).toBeNull();
    expect(screen.queryByText('quiet-item')).toBeNull();

    // URL intent remains authoritative while the explicit filter is present.
    fireEvent.click(filter('All'));
    expect(filter('At risk')).toHaveAttribute('aria-pressed', 'true');
    expect(filter('All')).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('critical-item')).toBeVisible();
    expect(screen.queryByText('warning-item')).toBeNull();
  });

  it('does not render raw floating-point velocity precision', () => {
    const item = mockUseDemand().data.variants.find((v: DemandVelocity) => v.lasyncro_variant_id === 'critical-item');
    Object.assign(item, { velocity_per_day: 0.005555555555555556, velocity_window_days: 180, units_sold_30d: 0, units_sold_prev_30d: 0, demand_confidence: 'low' });
    renderPlanning();
    const row = screen.getByText('critical-item').closest('tr')!;
    expect(row.textContent).not.toContain('0.005555555555555556');
  });

  it('rounds ordinary daily demand compactly and retains confidence', () => {
    const items = mockUseDemand().data.variants;
    Object.assign(items.find((v: DemandVelocity) => v.lasyncro_variant_id === 'critical-item'), { velocity_per_day: 1.2333333333333334 });
    Object.assign(items.find((v: DemandVelocity) => v.lasyncro_variant_id === 'warning-item'), { velocity_per_day: 0.1 });
    renderPlanning();
    const criticalRow = within(screen.getByText('critical-item').closest('tr')!);
    expect(criticalRow.getByText(/^1\.23 \/ day$/)).toBeVisible();
    expect(criticalRow.getByText('30d · high confidence')).toBeVisible();
    expect(within(screen.getByText('warning-item').closest('tr')!).getByText(/^0\.1 \/ day$/)).toBeVisible();
  });

  it('shows observed sparse demand in the selected window rather than substituting 30-day sales', () => {
    const item = mockUseDemand().data.variants.find((v: DemandVelocity) => v.lasyncro_variant_id === 'critical-item');
    // Canonical backend: velocityUnits / velocityWindowDays, without rounding.
    // One observed unit in 180d; none in the current/prior 30d windows.
    Object.assign(item, { velocity_per_day: 0.005555555555555556, velocity_window_days: 180, units_sold_30d: 0, units_sold_prev_30d: 0, demand_confidence: 'low' });
    renderPlanning();
    const row = within(screen.getByText('critical-item').closest('tr')!);
    expect(row.getByText(/^1 unit \/ 180d$/)).toBeVisible();
    expect(row.getByText('Low confidence')).toBeVisible();
    expect(row.getAllByRole('cell')[4]).toHaveTextContent(/^26$/);
    expect(row.getByRole('link', { name: /^Review sourcing$/ })).toHaveAttribute('href', '/suppliers-portal/sourcing?variantId=critical-item');
  });

  it('caps long cover displays at >365d and retains the 365d boundary', () => {
    const result = mockUseDemand();
    result.data.variants = [
      { ...variant('cover-3600', 'critical'), days_of_stock_remaining: 3600 },
      { ...variant('cover-1440', 'warning'), days_of_stock_remaining: 1440 },
      { ...variant('cover-5400', 'healthy'), days_of_stock_remaining: 5400 },
      { ...variant('cover-365', 'healthy'), days_of_stock_remaining: 365 },
    ];
    result.data.summary = { ...result.data.summary, total_variants_tracked: 4 };
    renderPlanning();
    fireEvent.click(filter('All'));
    const rows = ['cover-3600', 'cover-1440', 'cover-5400'].map(id => screen.getByText(id).closest('tr')!);
    for (const row of rows) {
      expect(within(row).getAllByRole('cell')[3]).toHaveTextContent(/^>365d/);
    }
    expect(within(screen.getByText('cover-365').closest('tr')!).getAllByRole('cell')[3]).toHaveTextContent(/^365d/);
  });

  it('shows Data needed once in a planning-gap row without duplicated generic explanation', () => {
    renderPlanning();
    fireEvent.click(filter('Planning gaps'));
    const row = within(screen.getByText('gap-item').closest('tr')!);
    expect(row.getAllByText(/^Data needed$/)).toHaveLength(1);
    expect(row.queryByText(/^Planning data (?:needed|required)$/i)).toBeNull();
    expect(row.getAllByRole('cell')[4]).toHaveTextContent(/^—$/);
    expect(row.queryByRole('link')).toBeNull();
  });
});
