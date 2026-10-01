/** GH-1183: real mutation hooks must reread an active, fresh canonical query. */
import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { axiosInstance } from 'api/axiosConfig';
import { useCreateZone, useUpdateZone, useDeleteZone, useDeleteZones, useUpdateZonePositions } from 'pages/floor-planning/useZoneManagement';

jest.mock('api/axiosConfig', () => ({ axiosInstance: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() } }));
jest.mock('contexts/ToastContext', () => ({ useToast: () => ({ show: jest.fn() }) }));
const KEY = ['onboarding', 'readiness'];
const URL = '/api/v1/onboarding/readiness';
const clients: QueryClient[] = [];
function snapshot(ready: boolean) {
  return { modules: [{ moduleId: 'wms', signals: [{ name: 'wms.zonesConfigured', value: ready }], tasks: [{ id: 'map-zones', complete: ready }] }] };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  jest.resetAllMocks();
  for (const method of ['post', 'patch', 'delete'] as const) (axiosInstance[method] as jest.Mock).mockResolvedValue({ data: { success: true } });
});
afterEach(() => { cleanup(); clients.splice(0).forEach(c => c.clear()); });
async function mount(initial = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  clients.push(client);
  client.setQueryData(['floor-planning', 'layout'], { zones: [{ location_code: 'PICK-01', type: 'bin', zone_type: 'pick', active: initial }] });
  const get = axiosInstance.get as jest.Mock;
  get.mockResolvedValue({ data: snapshot(initial) });
  const hook = renderHook(() => ({
    readiness: useQuery({ queryKey: KEY, queryFn: async () => (await axiosInstance.get(URL)).data, staleTime: 60_000 }),
    create: useCreateZone(), update: useUpdateZone(), remove: useDeleteZone(), removeMany: useDeleteZones(), positions: useUpdateZonePositions(),
  }), { wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
  await waitFor(() => expect(hook.result.current.readiness.isSuccess).toBe(true));
  expect(get).toHaveBeenCalledTimes(1);
  expect(hook.result.current.readiness.isStale).toBe(false);
  return { ...hook, client, get };
}
async function expectRefresh(operation: (hooks: any) => Promise<unknown>, initial = false, next = true) {
  const h = await mount(initial);
  const response = deferred<{ data: ReturnType<typeof snapshot> }>();
  h.get.mockReturnValue(response.promise);
  // Readiness revalidation must not manufacture ready=true before its GET resolves.
  let mutation!: Promise<unknown>;
  act(() => { mutation = operation(h.result.current); });
  try {
    await waitFor(() => expect(h.get).toHaveBeenCalledTimes(2));
    expect(h.client.getQueryData(KEY)).toEqual(snapshot(initial));
  } finally {
    await act(async () => { response.resolve({ data: snapshot(next) }); await mutation; });
  }
  await waitFor(() => expect(h.result.current.readiness.data).toEqual(snapshot(next)));
}

describe('GH-1183 Floor mutation → canonical readiness', () => {
  it('rereads after pick creation despite fresh 60-second cache', async () => {
    await expectRefresh(h => h.create.mutateAsync({ location_code: 'PICK-01', type: 'bin', zone_type: 'pick' }));
  });
  it('rereads after storage creation despite fresh 60-second cache', async () => {
    await expectRefresh(h => h.create.mutateAsync({ location_code: 'STOCK-01', type: 'bin', zone_type: 'storage' }));
  });
  it('pack creation cannot announce readiness from payload; any reread stays server-owned', async () => {
    const h = await mount();
    // A broad reread is safe, although unnecessary for this known non-stock payload.
    const payload = { location_code: 'PACK-01', type: 'bin' as const, zone_type: 'pack' };
    await act(async () => { await h.result.current.create.mutateAsync(payload); });
    expect(h.client.getQueryData(KEY)).toEqual(snapshot(false));
    expect(h.result.current.readiness.data).toEqual(snapshot(false));
  });
  it('activation rereads canonical readiness', async () => {
    await expectRefresh(h => h.update.mutateAsync({ locationCode: 'PICK-01', active: true }));
  });
  it('deactivation of the final qualifying location rereads and relocks', async () => {
    await expectRefresh(h => h.update.mutateAsync({ locationCode: 'PICK-01', active: false }), true, false);
  });
  it('zone_type leaving stock membership rereads readiness', async () => {
    await expectRefresh(h => h.update.mutateAsync({ locationCode: 'PICK-01', zone_type: 'pack' }), true, false);
  });
  it('zone_type entering stock membership rereads readiness', async () => {
    const h = await mount();
    h.client.setQueryData(['floor-planning', 'layout'], { zones: [{ location_code: 'PACK-01', type: 'bin', zone_type: 'pack', active: true }] });
    h.get.mockResolvedValue({ data: snapshot(true) });
    await act(async () => { await h.result.current.update.mutateAsync({ locationCode: 'PACK-01', zone_type: 'storage' }); });
    await waitFor(() => expect(h.result.current.readiness.data).toEqual(snapshot(true)));
    expect(h.get).toHaveBeenCalledTimes(2);
  });
  it('single and batch geometry-only changes do not refresh readiness', async () => {
    const h = await mount(true);
    await act(async () => { await h.result.current.update.mutateAsync({ locationCode: 'PICK-01', position_x: 2, position_y: 3, width: 2, depth: 1 }); });
    await act(async () => { await h.result.current.positions.mutateAsync([{ location_code: 'PICK-01', position_x: 4, position_y: 5 }]); });
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.client.getQueryData(KEY)).toEqual(snapshot(true));
  });
  it('single deletion rereads after removing a qualifying location', async () => {
    await expectRefresh(h => h.remove.mutateAsync('PICK-01'), true, false);
  });
  it('bulk deletion rereads after removing qualifying locations', async () => {
    await expectRefresh(h => h.removeMany.mutateAsync(['PICK-01']), true, false);
  });
  it('failed create, update and delete neither refresh nor announce success', async () => {
    const h = await mount();
    for (const method of ['post', 'patch', 'delete'] as const) (axiosInstance[method] as jest.Mock).mockRejectedValue(new Error('GH1183 rejected mutation'));
    await act(async () => {
      const payload = { location_code: 'PICK-01', type: 'bin' as const, zone_type: 'pick' };
      await expect(h.result.current.create.mutateAsync(payload)).rejects.toThrow('GH1183 rejected mutation');
      await expect(h.result.current.update.mutateAsync({ locationCode: 'PICK-01', active: true })).rejects.toThrow('GH1183 rejected mutation');
      await expect(h.result.current.remove.mutateAsync('PICK-01')).rejects.toThrow('GH1183 rejected mutation');
    });
    expect(h.get).toHaveBeenCalledTimes(1);
    expect(h.client.getQueryData(KEY)).toEqual(snapshot(false));
  });
});
