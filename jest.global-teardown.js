// jest.global-teardown.js

module.exports = async () => {
  let db;

  try {
    // Prefer the compiled DB module if it exists
    // (used in CI/build flows where dist is present).
    // eslint-disable-next-line global-require, import/no-unresolved
    db = require('./apps/backend/dist/src/db').default;
  } catch (e) {
    // In local Jest runs (no dist), just skip teardown.
    // Avoid throwing an error that fails all tests.
    return;
  }

  if (db && typeof db.destroy === 'function') {
    await db.destroy();
  }
};
