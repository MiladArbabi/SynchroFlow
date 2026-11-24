// Runs inside each integration-test environment, after its tests and hooks.
// Inspect that environment's module cache only: cleanup must not instantiate
// another pool or close a runner/global-teardown instance.
afterAll(async () => {
  const pools = new Set();
  for (const specifier of [
    '@lasyncro/backend-core/db.js',
    '@lasyncro/backend-core/system-db.js',
  ]) {
    const cached = require.cache[require.resolve(specifier)];
    if (!cached) continue;
    const pool = cached.exports.default ?? cached.exports.systemDb;
    if (typeof pool?.destroy !== 'function') {
      throw new Error(`Loaded integration database module has no pool: ${specifier}`);
    }
    pools.add(pool);
  }

  const results = await Promise.allSettled([...pools].map(pool => pool.destroy()));
  const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length > 0) throw new AggregateError(errors, 'Integration database pool cleanup failed');
  console.info(`BACKEND_INTEGRATION_POOLS_CLOSED=${pools.size}`);
});
