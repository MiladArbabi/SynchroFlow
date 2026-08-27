/**
 * PROJECTION-CURSOR-STALL-08 Slice 3 — the disposable-DB guard's decision
 * boundary, exercised as a pure DB-free contract test.
 *
 * Drives assertDisposableBackendIntegrationDb() with literal values only.
 * Never touches a database, never mutates process.env.
 */
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  assertDisposableBackendIntegrationDb,
} = require('../setup/backend-integration.global-setup');

describe('backend-integration disposable-DB guard', () => {
  it.each([
    'synchroflow_test_ab12cd',
    'synchroflow_test_1',
    'synchroflow_test_worker_123',
  ])('accepts disposable test DB name %p', (name) => {
    expect(() => assertDisposableBackendIntegrationDb(name)).not.toThrow();
  });

  it.each([
    ['synchroflow_db'],
    ['synchroflow'],
    ['postgres'],
    ['production'],
    ['synchroflow_test'],
    ['x_synchroflow_test_1'],
    ['synchroflow_test-'],
    [''],
    [undefined],
  ])('rejects non-disposable DB name %p', (name) => {
    expect(() =>
      assertDisposableBackendIntegrationDb(name as string | undefined)
    ).toThrow(/^REFUSING_BACKEND_INTEGRATION_NON_DISPOSABLE_DB/);
  });

  it('names the observed value in the rejection message', () => {
    expect(() =>
      assertDisposableBackendIntegrationDb('synchroflow_db')
    ).toThrow(/PGDATABASE=synchroflow_db/);

    expect(() =>
      assertDisposableBackendIntegrationDb(undefined)
    ).toThrow(/PGDATABASE=<unset>/);
  });
});
