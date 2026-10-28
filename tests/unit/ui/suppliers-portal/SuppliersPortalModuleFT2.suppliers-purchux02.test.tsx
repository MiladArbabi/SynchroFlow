import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import Module, { Supplier, SuppliersPortalPageProps } from '../../../../modules/suppliers-portal/src/ui/pages/SuppliersPortalModuleFT2';

const alpha: Supplier = { id: 1, name: 'Alpha', contact_name: 'Alice', contact_email: 'alice@example.com', contact_phone: '123', active: true, moq: null, lead_time_days: 4, open_po_count: 2, total_pos: 8, on_time_rate: 90, fill_rate: 95, defect_rate: 3 };
const beta: Supplier = { ...alpha, id: 2, name: 'Beta', contact_name: 'Bob', contact_email: 'bob@example.com', contact_phone: '456', moq: 10, lead_time_days: null, open_po_count: 5 };
let width = 1200;
let resize: () => void;
let search = '';
const originalObserver = globalThis.ResizeObserver;
const originalRect = HTMLElement.prototype.getBoundingClientRect;
beforeAll(() => {
  globalThis.ResizeObserver = class { constructor(callback: () => void) { resize = callback; } observe() {} disconnect() {} unobserve() {} } as any;
  HTMLElement.prototype.getBoundingClientRect = function () { return { ...originalRect.call(this), width } as DOMRect; };
});
afterAll(() => { globalThis.ResizeObserver = originalObserver; HTMLElement.prototype.getBoundingClientRect = originalRect; });
beforeEach(() => { width = 1200; jest.spyOn(window, 'confirm').mockReturnValue(false); });
afterEach(() => jest.restoreAllMocks());
function Probe() {
  search = useLocation().search;
  const navigate = useNavigate();
  return <><button onClick={() => navigate(-1)}>history back</button><button onClick={() => navigate(1)}>history forward</button></>;
}
function setup(url = '/?keep=yes', overrides: Partial<SuppliersPortalPageProps> = {}, mode: 'light' | 'dark' = 'light') {
  const props = {
    view: 'suppliers', data: { suppliers: [beta, alpha], purchase_orders: [], never_ordered: [], never_ordered_count: 0 }, isLoading: false, isError: false,
    onCreateSupplier: jest.fn().mockResolvedValue({ ...alpha, id: 3, name: 'Gamma' }),
    onUpdateSupplier: jest.fn().mockResolvedValue({ ...beta, name: 'Updated' }),
    onDeleteSupplier: jest.fn().mockResolvedValue(undefined), ...overrides,
  } as unknown as SuppliersPortalPageProps;
  const tree = (p: SuppliersPortalPageProps) => <ThemeProvider theme={createTheme({ palette: { mode } })}><MemoryRouter initialEntries={[url]}><Module {...p} /><Probe /></MemoryRouter></ThemeProvider>;
  const result = render(tree(props));
  return { props, ...result, rerenderProps: (p: SuppliersPortalPageProps) => result.rerender(tree(p)) };
}
// Rerenders use the existing router so URL state survives authoritative refreshes.
const row = (id: number) => screen.getByTestId(`supplier-row-${id}`);
const details = () => screen.getByRole('region', { name: /^supplier details/i });
const workspace = () => screen.getByTestId('suppliers-workspace');
function menu(kind: 'filters' | 'sort', label: string) {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`supplier ${kind}:`, 'i') }));
  fireEvent.click(screen.getByRole('menuitemradio', { name: label }));
}
it('selects source-first on wide; pushes URL history and retains unrelated parameters', () => {
  setup(); expect(row(2)).toHaveAttribute('aria-current', 'true');
  fireEvent.click(row(1)); expect(search).toBe('?keep=yes&supplier=1');
  fireEvent.click(row(2)); fireEvent.click(screen.getByText('history back'));
  expect(details()).toHaveAccessibleName('Supplier details: Alpha');
  fireEvent.click(screen.getByText('history forward')); expect(details()).toHaveAccessibleName('Supplier details: Beta');
});
it('searches contact fields; filters and stable sorts retain selected detail and expose reset', () => {
  setup('/?supplier=1');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search suppliers' }), { target: { value: 'bob@example.com' } });
  expect(screen.queryByTestId('supplier-row-1')).toBeNull(); expect(details()).toHaveAccessibleName('Supplier details: Alpha');
  expect(screen.getByRole('status')).toHaveTextContent('Showing 1 of 2');
  fireEvent.click(screen.getByRole('button', { name: 'Show Alpha' }));
  menu('filters', 'Missing MOQ'); expect(row(1)).toBeVisible(); expect(screen.queryByTestId('supplier-row-2')).toBeNull();
  menu('filters', 'Missing lead time'); expect(row(2)).toBeVisible();
  menu('filters', 'Open POs'); expect(screen.getAllByTestId(/supplier-row-/)).toHaveLength(2);
  menu('filters', 'All'); menu('sort', 'Name'); expect(screen.getAllByTestId(/supplier-row-/).map((el) => el.textContent?.startsWith('Alpha'))).toEqual([true, false]);
  menu('sort', 'Open PO count'); expect(screen.getAllByTestId(/supplier-row-/)[0]).toBe(row(2));
  menu('sort', 'Default'); expect(screen.getAllByTestId(/supplier-row-/)[0]).toBe(row(2));
  fireEvent.change(screen.getByRole('textbox', { name: 'Search suppliers' }), { target: { value: 'no match' } });
  expect(screen.getByText('No suppliers match these filters.')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Clear filters' })); expect(row(1)).toBeVisible();
});
it('narrow list-first, selection, Back, focus, browser history and 880px boundary', () => {
  width = 879; setup(); expect(workspace()).toHaveAttribute('data-pane', 'list');
  fireEvent.change(screen.getByRole('textbox', { name: 'Search suppliers' }), { target: { value: 'Alice' } });
  fireEvent.click(row(1)); expect(workspace()).toHaveAttribute('data-pane', 'detail');
  expect(screen.getByRole('button', { name: 'Back to suppliers' })).toHaveFocus();
  fireEvent.click(screen.getByRole('button', { name: 'Back to suppliers' }));
  expect(search).toBe('?keep=yes'); expect(row(1)).toHaveFocus();
  expect(screen.getByRole('textbox', { name: 'Search suppliers' })).toHaveValue('Alice');
  fireEvent.click(screen.getByText('history back')); expect(details()).toBeVisible();
  act(() => { width = 880; resize(); }); expect(workspace()).toHaveAttribute('data-layout', 'wide'); expect(row(1)).toBeVisible();
  act(() => { width = 500; resize(); }); expect(details()).toBeVisible();
});
it('refreshes valid narrow links and replaces invalid IDs safely', async () => {
  width = 400; setup('/?keep=yes&supplier=gone');
  await waitFor(() => expect(search).toBe('?keep=yes')); expect(workspace()).toHaveAttribute('data-pane', 'list');
});
it('opens a valid supplier deep link and preserves every metric', () => {
  width = 400; setup('/?supplier=1');
  expect(details()).toHaveAccessibleName('Supplier details: Alpha');
  ['Contact: Alice', 'Email: alice@example.com', 'Phone: 123', 'Open POs: 2', 'Received POs: 8', 'Defect rate: 3%', 'MOQ: —', 'Lead time: 4 days'].forEach((text) => expect(within(details()).getByText(text)).toBeVisible());
  expect(within(details()).getByText(/90/)).toBeVisible(); expect(within(details()).getByText(/95/)).toBeVisible();
});
it('creates and selects the returned supplier before refetch completes; preserves name validation', async () => {
  const { props } = setup(); fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
  const dialog = screen.getByRole('dialog'); fireEvent.click(within(dialog).getByRole('button', { name: 'Add supplier' }));
  expect(within(dialog).getByText('Name is required.')).toBeVisible(); expect(props.onCreateSupplier).not.toHaveBeenCalled();
  fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: 'Gamma' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add supplier' }));
  await waitFor(() => expect(details()).toHaveAccessibleName('Supplier details: Gamma'));
  expect(search).toBe('?keep=yes&supplier=3'); expect(props.onCreateSupplier).toHaveBeenCalledTimes(1);
});
it('edits the selected record and retains entered values on failure', async () => {
  const fail = jest.fn().mockRejectedValueOnce(new Error('failed')).mockResolvedValue({ ...beta, name: 'Updated' });
  setup('/?supplier=2', { onUpdateSupplier: fail }); fireEvent.click(screen.getByRole('button', { name: 'Edit supplier' }));
  const dialog = screen.getByRole('dialog'); fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: 'Updated' } });
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  expect(await within(dialog).findByText('Failed to save supplier.')).toBeVisible(); expect(within(dialog).getByLabelText('Name *')).toHaveValue('Updated');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
  await waitFor(() => expect(details()).toHaveAccessibleName('Supplier details: Updated'));
  expect(fail).toHaveBeenLastCalledWith(2, expect.objectContaining({ name: 'Updated' }));
});
it('requires named removal confirmation, deletes once and selects a remaining supplier', async () => {
  const { props } = setup('/?keep=yes&supplier=2'); fireEvent.click(screen.getByRole('button', { name: 'Remove supplier…' }));
  expect(window.confirm).toHaveBeenCalledWith('Remove Beta? Past purchase orders are kept; the supplier is hidden from new POs.'); expect(props.onDeleteSupplier).not.toHaveBeenCalled();
  jest.mocked(window.confirm).mockReturnValue(true); fireEvent.click(screen.getByRole('button', { name: 'Remove supplier…' }));
  await waitFor(() => expect(details()).toHaveAccessibleName('Supplier details: Alpha')); expect(props.onDeleteSupplier).toHaveBeenCalledTimes(1); expect(props.onDeleteSupplier).toHaveBeenCalledWith(2);
  await waitFor(() => expect(search).toBe('?keep=yes&supplier=1'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove supplier…' })); await waitFor(() => expect(screen.getByText(/No suppliers added yet/)).toBeVisible()); await waitFor(() => expect(search).toBe('?keep=yes'));
});
it('reports deletion failure without losing the supplier', async () => {
  setup('/?supplier=1', { onDeleteSupplier: jest.fn().mockRejectedValue(new Error('failed')) }); jest.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove supplier…' })); expect(await screen.findByText('Failed to remove supplier.')).toBeVisible(); expect(details()).toHaveAccessibleName('Supplier details: Alpha');
});
it('shows the empty state', () => { setup('/', { data: { suppliers: [], purchase_orders: [], never_ordered: [], never_ordered_count: 0 } }); expect(screen.getByText(/No suppliers added yet/)).toBeVisible(); });
it('does not expose supplier records while loading', () => { setup('/', { isLoading: true }); expect(screen.queryByRole('navigation', { name: 'Suppliers' })).toBeNull(); });
it('shows load errors without supplier records', () => { setup('/', { isError: true }); expect(screen.getByRole('alert')).toHaveTextContent('Failed to load supplier data.'); expect(screen.queryByRole('navigation', { name: 'Suppliers' })).toBeNull(); });

it('normalizes externally removed selection after a successful refresh', async () => {
  const view = setup('/?keep=yes&supplier=2');
  view.rerenderProps({ ...view.props, data: { ...view.props.data, suppliers: [alpha] } });
  await waitFor(() => expect(search).toBe('?keep=yes'));
  expect(details()).toHaveAccessibleName('Supplier details: Alpha');
});
it('keeps editing state across a resize and cancellation makes no update', () => {
  const { props } = setup('/?supplier=1');
  fireEvent.click(screen.getByRole('button', { name: 'Edit supplier' }));
  const dialog = screen.getByRole('dialog');
  fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: 'Unsaved' } });
  act(() => { width = 400; resize(); });
  expect(within(dialog).getByLabelText('Name *')).toHaveValue('Unsaved');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(props.onUpdateSupplier).not.toHaveBeenCalled();
});

it('deletion on narrow keeps replacement detail and a usable history entry', async () => {
  width = 400;
  const { props } = setup('/?keep=yes');
  fireEvent.click(row(1));
  fireEvent.click(screen.getByRole('button', { name: 'Back to suppliers' }));
  fireEvent.click(row(2));
  jest.mocked(window.confirm).mockReturnValue(true);
  fireEvent.click(screen.getByRole('button', { name: 'Remove supplier…' }));
  await waitFor(() => expect(search).toBe('?keep=yes&supplier=1'));
  expect(details()).toHaveAccessibleName('Supplier details: Alpha');
  expect(workspace()).toHaveAttribute('data-pane', 'detail');
  expect(props.onDeleteSupplier).toHaveBeenCalledWith(2);
  fireEvent.click(screen.getByText('history back'));
  expect(search).toBe('?keep=yes');
  expect(workspace()).toHaveAttribute('data-pane', 'list');
  fireEvent.click(screen.getByText('history forward'));
  expect(search).toBe('?keep=yes&supplier=1');
  expect(details()).toBeVisible();
});

it('keeps contextual actions accessible in desktop and narrow focus order', () => {
  setup('/?supplier=1');
  const actions = () => within(screen.getByRole('group', { name: 'Supplier actions' })).getAllByRole('button').map((button) => button.textContent);
  expect(actions()).toEqual(['Remove supplier…', 'Edit supplier']);
  act(() => { width = 400; resize(); });
  expect(actions()).toEqual(['Edit supplier', 'Remove supplier…']);
  fireEvent.click(screen.getByRole('button', { name: 'Set minimum order →' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Edit supplier');
});
it('uses singular and plural PO counts in supplier identities', () => {
  setup('/', { data: { suppliers: [{ ...alpha, open_po_count: 1, total_pos: 1 }, beta], purchase_orders: [], never_ordered: [], never_ordered_count: 0 } });
  expect(row(1)).toHaveTextContent('1 open PO');
  expect(row(1)).not.toHaveTextContent('1 open POs');
  expect(row(1)).toHaveTextContent('1 received PO');
  expect(row(2)).toHaveTextContent('5 open POs');
  expect(row(2)).toHaveTextContent('8 received POs');
});

it('initializes every edit field in the canonical light-theme modal and resets add fields', async () => {
  setup('/?supplier=2');
  fireEvent.click(screen.getByRole('button', { name: 'Edit supplier' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit supplier' });
  expect(within(dialog).getByLabelText('Name *')).toHaveValue('Beta');
  expect(within(dialog).getByLabelText('Contact name')).toHaveValue('Bob');
  expect(within(dialog).getByLabelText('Email')).toHaveValue('bob@example.com');
  expect(within(dialog).getByLabelText('Phone')).toHaveValue('456');
  expect(within(dialog).getByLabelText('Min order qty (MOQ)')).toHaveValue(10);
  expect(within(dialog).getByLabelText('Lead time (days)')).toHaveValue(null);
  expect(within(dialog).getByText('Units this supplier requires per order. Leave blank for no minimum.')).toBeVisible();
  expect(within(dialog).getByText('Days from PO sent to goods received. Used to compute the best reorder date.')).toBeVisible();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  fireEvent.click(screen.getByRole('button', { name: 'Add supplier' }));
  await waitFor(() => {
    const add = screen.getByRole('dialog', { name: 'Add supplier' });
    expect(within(add).getByLabelText('Name *')).toHaveValue('');
    expect(within(add).getByLabelText('Email')).toHaveValue('');
    expect(within(add).getByLabelText('Min order qty (MOQ)')).toHaveValue(null);
  });
});
it('renders the accessible shared shell in dark mode and submits all supplier fields once', async () => {
  let resolve!: (value: Supplier) => void;
  const save = jest.fn(() => new Promise<Supplier>((done) => { resolve = done; }));
  setup('/?supplier=1', { onUpdateSupplier: save }, 'dark');
  fireEvent.click(screen.getByRole('button', { name: 'Edit supplier' }));
  const dialog = screen.getByRole('dialog', { name: 'Edit supplier' });
  expect(within(dialog).getByRole('button', { name: 'Close' })).toBeVisible();
  fireEvent.change(within(dialog).getByLabelText('Name *'), { target: { value: ' Alpha changed ' } });
  fireEvent.change(within(dialog).getByLabelText('Min order qty (MOQ)'), { target: { value: '12' } });
  const submit = within(dialog).getByRole('button', { name: 'Save changes' });
  fireEvent.click(submit);
  expect(submit).toBeDisabled();
  fireEvent.click(submit);
  expect(save).toHaveBeenCalledTimes(1);
  expect(save).toHaveBeenCalledWith(1, { name: 'Alpha changed', contact_name: 'Alice', contact_email: 'alice@example.com', contact_phone: '123', moq: 12, lead_time_days: 4 });
  await act(async () => resolve({ ...alpha, name: 'Alpha changed', moq: 12 }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
});
