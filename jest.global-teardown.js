// jest.global-teardown.js (extend existing)
module.exports = async () => {
  let db;

  try {
    // prefer compiled DB module (CI/build)
    // eslint-disable-next-line global-require, import/no-unresolved
    db = require('./apps/backend/dist/src/db').default;
  } catch (e) {
    // In local Jest runs (no dist), just skip teardown.
    // Avoid throwing an error that fails all tests.
    // still attempt other best-effort cleanup from source paths
  }

  if (db && typeof db.destroy === 'function') {
    await db.destroy();
  }

  // Best-effort: close queue connection if tests started it (compiled or source)
  try {
    // Prefer compiled queue (CI), fall back to source
    let qmod;
    try { qmod = require('./apps/backend/dist/src/queue'); } catch (err) { /*ignore*/ }
    if (!qmod) {
      try { qmod = require('./apps/backend/src/queue'); } catch (err) { /*ignore*/ }
    }
    const conn = qmod && qmod.connection;
    if (conn && typeof conn.close === 'function') {
      // amqp-connection-manager exposes close()/disconnect(); call close()
      await conn.close();
      // eslint-disable-next-line no-console
      console.log('jest.global-teardown: closed RabbitMQ connection');
    }
  } catch (err) {
    // ignore - defensive
  }

  // Best-effort: close redis client from specter store if present (avoid leftover handles)
  try {
    let redisMod;
    try { redisMod = require('./modules/specter/src/store/session-store-redis'); } catch (err) { /*ignore*/ }
    if (!redisMod) {
      // compiled path
      try { redisMod = require('./modules/specter/dist/store/session-store-redis'); } catch (err) { /*ignore*/ }
    }
    const maybeClient = redisMod && (redisMod.client || redisMod.default && redisMod.default.client);
    if (maybeClient && typeof maybeClient.quit === 'function') {
      await maybeClient.quit();
      // eslint-disable-next-line no-console
      console.log('jest.global-teardown: closed Redis client from specter store');
    }
  } catch (err) {
    // ignore - defensive
  }

  // Try to call queue close if compiled queue exists. Best-effort only.
  try {
    // eslint-disable-next-line global-require, import/no-unresolved
    const queue = require('./apps/backend/dist/src/queue');
    if (queue && typeof queue.closeQueue === 'function') {
      await queue.closeQueue();
    }
  } catch (e) {
    // ignore — nothing to clean up in local dev tests
  }
};
