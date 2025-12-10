// scripts/redis-session-store-smoke.js
// Quick smoke test for modules/specter/dist or src RedisSessionStore
const path = require('path');

async function main() {
  try {
    // Try compiled location first (typical after build)
    const candidates = [
      path.resolve(process.cwd(), 'apps/backend/dist/modules/specter/src/store/session-store-redis.js'),
      path.resolve(process.cwd(), 'modules/specter/dist/store/session-store-redis.js'),
      path.resolve(process.cwd(), 'modules/specter/src/store/session-store-redis.js'),
      path.resolve(process.cwd(), 'apps/backend/src/modules/specter/src/store/session-store-redis.js'),
    ];

    let modPath = null;
    for (const c of candidates) {
      try {
        require.resolve(c);
        modPath = c;
        break;
      } catch (e) { /* ignore */ }
    }

    if (!modPath) {
      console.error('Could not resolve any candidate for session-store-redis. Candidates tried:', candidates);
      process.exit(2);
    }

    console.log('Using RedisSessionStore module at:', modPath);
    const { initRedisSessionStore, closeRedisSessionStore, RedisSessionStore } = require(modPath);

    // init store (init returns instance when called via helper above)
    const store = await initRedisSessionStore();
    console.log('init ok, store.constructor.name =', store.constructor.name);

    // show public keys
    console.log('ownKeys:', Object.getOwnPropertyNames(store));
    console.log('protoKeys:', Object.getOwnPropertyNames(Object.getPrototypeOf(store)));

    // small helper to attempt ops and print results
    const tryFn = async (name, ...args) => {
      try {
        console.log(`calling ${name}`);
        const res = await (store[name] ? store[name](...args) : Promise.resolve(undefined));
        console.log(`${name} =>`, typeof res === 'undefined' ? '[ok]' : JSON.stringify(res));
      } catch (e) {
        console.error(`${name} ERROR:`, e && e.message ? e.message : e);
      }
    };

    // 1) warm cache
    await tryFn('warmCache', 77, { foo: 'bar' });

    // 2) updateShopConfig & getShopConfig
    await tryFn('updateShopConfig', 77, { foo: 'bar2' });
    await tryFn('getShopConfig', 77);

    // 3) appendEvent & getRecentEvents
    await tryFn('appendEvent', 77, { type: 'integration.test', payload: { ok: true } });
    await tryFn('getRecentEvents', 77, 10);

    // 4) reset
    await tryFn('reset');

    await closeRedisSessionStore(store);
    console.log('closed');
    process.exit(0);
  } catch (err) {
    console.error('FATAL ERROR', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

main();