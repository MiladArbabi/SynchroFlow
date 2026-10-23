import React from 'react';
import { cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import SuppliersPortalModuleFT2, {
  type SuppliersPortalPageProps,
} from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

const mockNavigate = jest.fn();
const PO_ID = '550e8400-e29b-41d4-a716-446655440011';

jest.mock('react-router-dom', () => {
  const actual = jest.requireActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

function props(): SuppliersPortalPageProps & {
  teamAssignableOperators: Array<{ id: number; name: string }>;
} {
  return {
    view: 'pos',
    data: {
      purchase_orders: [
        {
          id: PO_ID,
          po_number: 1109,
          supplier_name: 'North Dock Supply',
          supplier_contact_email: null,
          supplier_contact_name: null,
          supplier_moq: null,
          supplier_on_time_rate: null,
          supplier_fill_rate: null,
          status: 'shipped',
          expected_delivery_date: '2026-09-14',
          actual_delivery_date: null,
          line_items_count: 1,
          total_units_ordered: 8,
          total_units_received: 0,
          notes: null,
          document_url: null,
          created_at: '2026-09-14T10:00:00.000Z',
          first_line_description: 'Carton of widgets',
        },
      ],
      suppliers: [],
      never_ordered: [],
      never_ordered_count: 0,
    },
    isLoading: false,
    isError: false,
    onRefresh: jest.fn(),
    onFetchLineItems: jest.fn().mockResolvedValue([
      {
        id: 'line-1109',
        lasyncro_variant_id: 'variant-1109',
        description: 'Carton of widgets',
        quantity_ordered: 8,
        quantity_received: 0,
        unit_cost_cents: 100,
        sku: 'WIDGET-8',
        image_url: null,
        product_title: 'Widget',
      },
    ]),
    onUpdatePoStatus: jest.fn().mockResolvedValue(undefined),
    onCreateSupplier: jest.fn(),
    onUpdateSupplier: jest.fn(),
    onDeleteSupplier: jest.fn(),
    onCreatePo: jest.fn(),
    onCreateReceiveJob: jest.fn().mockResolvedValue({ receive_job_id: 'receive-self' }),
    onSearchVariants: jest.fn().mockResolvedValue([]),
    onFetchSourcingRecommendations: jest.fn(),
    onFetchSourcingWorklist: jest.fn(),
    onFetchPreferences: jest.fn().mockResolvedValue([]),
    onCreatePreference: jest.fn(),
    onUpdatePreference: jest.fn(),
    onDeletePreference: jest.fn(),
    onFetchReorderRequests: jest.fn().mockResolvedValue([]),
    onCreateReorderRequest: jest.fn(),
    onDeleteReorderRequest: jest.fn(),
    currentUserId: 7,
    canManageReceiveAssignment: true,
    receiveAssigneesStatus: 'ready',
    teamAssignableOperators: [
      { id: 7, name: 'Mila Owner', role: 'owner' },
      { id: 8, name: 'Avery Worker', role: 'operator' },
    ],
    spotlights: {
      neverOrdered: { isDismissed: true, dismiss: jest.fn() },
      alertTriggered: { isDismissed: true, dismiss: jest.fn() },
      accumulator: { isDismissed: true, dismiss: jest.fn() },
      poSendFlow: { isDismissed: true, dismiss: jest.fn() },
      receiveDispatchAssignment: { isDismissed: false, dismiss: jest.fn() },
    },
  } as any;
}

describe('GH-1109 — Suppliers Portal Receive dispatch UX', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('opens assignment before creating Receive work and branches self vs other assignment', async () => {
    const p = props();

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByText('North Dock Supply')[0]);
    fireEvent.click(await screen.findByRole('button', { name: /assign receive/i }));

    // WS-UX-01 S2 — opening the popover creates nothing; picking a row does.
    expect(p.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    const picker = await screen.findByRole('list', { name: /assign receive to/i });
    expect(within(picker).getByText(/mila owner/i)).toBeInTheDocument();
    expect(within(picker).getByText(/avery worker/i)).toBeInTheDocument();

    fireEvent.click(within(picker).getByRole('button', { name: /mila owner/i }));

    await waitFor(() => {
      expect(p.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, {
        assigned_operator_id: 7,
      });
    });
    // WS-UX-01 S3 — self-assignment stays in Purchasing; Start is a separate click.
    expect(mockNavigate).not.toHaveBeenCalled();

    // Other-operator branch on a fresh, unassigned PO.
    cleanup();
    mockNavigate.mockClear();
    (p.onCreateReceiveJob as jest.Mock).mockResolvedValueOnce({
      receive_job_id: 'receive-other',
    });
    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );
    fireEvent.click(screen.getAllByText('North Dock Supply')[0]);

    fireEvent.click(await screen.findByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /avery worker/i }));

    await waitFor(() => {
      expect(p.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, {
        assigned_operator_id: 8,
      });
    });
    expect(mockNavigate).not.toHaveBeenCalledWith('/wms?receiveJobId=receive-other');
  });

  it('shows PO reference and durable Receive assignment on the collapsed PO row', () => {
    const p = props();

    p.data!.purchase_orders[0] = {
      ...p.data!.purchase_orders[0],
      receive_job_id: 'receive-assigned',
      receive_status: 'pending',
      receive_assigned_operator_id: 8,
      receive_assigned_operator_name: 'Avery Worker',
    } as any;

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    expect(screen.getByText(/^PO-1109$/i)).toBeInTheDocument();
    expect(
      screen.getByText(/^Receive: Assigned to Avery Worker$/i)
    ).toBeInTheDocument();
  });

  it('shows Receive as not assigned when the PO has no active Receive assignment', () => {
    const p = props();

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    expect(screen.getByText(/^PO-1109$/i)).toBeInTheDocument();
    expect(
      screen.getByText(/^Receive: Not assigned$/i)
    ).toBeInTheDocument();
  });

  it.each([
    'draft',
    'ordered',
    'confirmed',
    'in_production',
  ] as const)(
    'does not advertise Receive assignment before the PO is Receive-eligible: %s',
    (status) => {
      const p = props();

      p.data!.purchase_orders[0] = {
        ...p.data!.purchase_orders[0],
        status,
      } as any;

      render(
        <MemoryRouter>
          <SuppliersPortalModuleFT2 {...p} />
        </MemoryRouter>
      );

      expect(screen.getByText(/^PO-1109$/i)).toBeInTheDocument();
      expect(
        screen.queryByText(/^Receive:/i)
      ).not.toBeInTheDocument();
    }
  );

  it('opens the assignment popover from a Receive PO deep-link without creating work', async () => {
    const p = props();

    render(
      <MemoryRouter
        initialEntries={[
          `/?action=receive&poId=${PO_ID}`,
        ]}
      >
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    const picker = await screen.findByRole('list', { name: /assign receive to/i });
    expect(within(picker).getByText(/avery worker/i)).toBeInTheDocument();

    // The expanded PO identifies the work by its canonical number, never the UUID.
    // WS-UX-01 S4: the supplier is named in both the list row and the detail header.
    expect(screen.getAllByText(/^north dock supply$/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/^PO-1109$/i)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(PO_ID);

    expect(
      p.onCreateReceiveJob
    ).not.toHaveBeenCalled();

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('renders the canonical PO number while preserving UUID action identity', async () => {
    const p = props();

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByText('North Dock Supply')[0]);

    expect(screen.getByText(/^PO-1109$/i)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(PO_ID);

    fireEvent.click(await screen.findByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /mila owner/i }));

    await waitFor(() => {
      expect(p.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, {
        assigned_operator_id: 7,
      });
    });
  });

  it('GH-1109 residual: shows the Receive dispatch onboarding coach mark in the assignment popover when not dismissed', async () => {
    const p = props();

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByText('North Dock Supply')[0]);
    fireEvent.click(await screen.findByRole('button', { name: /assign receive/i }));
    await screen.findByRole('list', { name: /assign receive to/i });

    expect(screen.getByText('Assign Receive work')).toBeInTheDocument();
    expect(
      screen.getByText(/warehouse.*operations.*receiving/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not start the job/i)
    ).toBeInTheDocument();
  });

  it('GH-1109 residual: does not render the Receive dispatch onboarding coach mark when dismissed', async () => {
    const p = props();
    p.spotlights = {
      ...p.spotlights!,
      receiveDispatchAssignment: { isDismissed: true, dismiss: jest.fn() },
    };

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByText('North Dock Supply')[0]);
    fireEvent.click(await screen.findByRole('button', { name: /assign receive/i }));
    await screen.findByRole('list', { name: /assign receive to/i });

    expect(screen.queryByText('Assign Receive work')).not.toBeInTheDocument();
  });

  it('GH-1109 residual: assign-to-other confirmation identifies the Receiving queue handoff', async () => {
    const p = props();
    // WS-UX-01 S2 — the confirmation follows a canonical re-read showing the job.
    (p as any).onReconcilePurchaseOrders = jest.fn().mockResolvedValue([
      {
        ...p.data!.purchase_orders[0],
        receive_job_id: 'receive-self',
        receive_status: 'pending',
        receive_assigned_operator_id: 8,
      },
    ]);

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getAllByText('North Dock Supply')[0]);
    fireEvent.click(await screen.findByRole('button', { name: /assign receive/i }));
    fireEvent.click(await screen.findByRole('button', { name: /avery worker/i }));

    await waitFor(() => {
      expect(p.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, {
        assigned_operator_id: 8,
      });
    });

    expect(mockNavigate).not.toHaveBeenCalled();

    const confirmation = await screen.findByRole('alert');
    expect(confirmation).toHaveTextContent(/receive assigned to avery worker/i);
    expect(confirmation).toHaveTextContent(/warehouse.*operations.*receiving/i);
    expect(confirmation).toHaveTextContent(/claim & start it there/i);
  });

});
