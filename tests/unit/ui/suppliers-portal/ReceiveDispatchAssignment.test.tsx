import React from 'react';
import { fireEvent, render, screen, within, waitFor } from '@testing-library/react';
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

    fireEvent.click(screen.getByText('North Dock Supply'));
    fireEvent.click(await screen.findByRole('button', { name: /receive via wms/i }));

    expect(p.onCreateReceiveJob).not.toHaveBeenCalled();
    expect(mockNavigate).not.toHaveBeenCalled();

    const dialog = await screen.findByRole('dialog', { name: /assign receive/i });
    expect(within(dialog).getByText(/mila owner/i)).toBeInTheDocument();
    expect(within(dialog).getByText(/avery worker/i)).toBeInTheDocument();

    const confirm = within(dialog).getByRole('button', { name: /assign/i });
    expect(confirm).toBeDisabled();

    fireEvent.click(within(dialog).getByText(/mila owner/i));
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(p.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, {
        assigned_operator_id: 7,
      });
    });
    expect(mockNavigate).toHaveBeenCalledWith('/wms?receiveJobId=receive-self');

    mockNavigate.mockClear();
    (p.onCreateReceiveJob as jest.Mock).mockResolvedValueOnce({
      receive_job_id: 'receive-other',
    });

    fireEvent.click(await screen.findByRole('button', { name: /receive via wms/i }));
    fireEvent.click(await screen.findByText(/avery worker/i));
    fireEvent.click(screen.getByRole('button', { name: /assign/i }));

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

  it('opens the canonical assignment dialog from a Receive PO deep-link without creating work', async () => {
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

    const dialog = await screen.findByRole(
      'dialog',
      { name: /assign receive/i }
    );

    expect(
      within(dialog).getByText(/^north dock supply$/i)
    ).toBeInTheDocument();

    expect(
      within(dialog).getByText(/^PO-1109$/i)
    ).toBeInTheDocument();
    expect(dialog).not.toHaveTextContent(PO_ID);

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

    fireEvent.click(screen.getByText('North Dock Supply'));

    expect(screen.getByText(/^PO-1109$/i)).toBeInTheDocument();
    expect(document.body).not.toHaveTextContent(PO_ID);

    fireEvent.click(await screen.findByRole('button', { name: /receive via wms/i }));
    fireEvent.click(await screen.findByText(/mila owner/i));
    fireEvent.click(screen.getByRole('button', { name: /assign/i }));

    await waitFor(() => {
      expect(p.onCreateReceiveJob).toHaveBeenCalledWith(PO_ID, {
        assigned_operator_id: 7,
      });
    });
  });

  it('GH-1109 residual: shows the Receive dispatch onboarding coach mark in the Assign Receive dialog when not dismissed', async () => {
    const p = props();

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('North Dock Supply'));
    fireEvent.click(await screen.findByRole('button', { name: /receive via wms/i }));

    const dialog = await screen.findByRole('dialog', { name: /assign receive/i });

    expect(within(dialog).getByText('Assign Receive work')).toBeInTheDocument();
    expect(
      within(dialog).getByText(/warehouse.*operations.*receiving/i)
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/does not start the job/i)
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

    fireEvent.click(screen.getByText('North Dock Supply'));
    fireEvent.click(await screen.findByRole('button', { name: /receive via wms/i }));

    const dialog = await screen.findByRole('dialog', { name: /assign receive/i });

    expect(within(dialog).queryByText('Assign Receive work')).not.toBeInTheDocument();
  });

  it('GH-1109 residual: assign-to-other confirmation identifies the Receiving queue handoff', async () => {
    const p = props();

    render(
      <MemoryRouter>
        <SuppliersPortalModuleFT2 {...p} />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByText('North Dock Supply'));
    fireEvent.click(await screen.findByRole('button', { name: /receive via wms/i }));
    fireEvent.click(await screen.findByText(/avery worker/i));
    fireEvent.click(screen.getByRole('button', { name: /assign/i }));

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
