// scripts/debug-redis-client.js
(async () => {
  const { createClient } = require('redis'); // or ioredis if used
  const c = createClient({ url: process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
  await c.connect();
  console.log('client.del is function?', typeof c.del);
  try {
    // try spread
    console.log('del spread ->', await c.del('specter:shop:test:sessions:1','specter:shop:test:sessions:2'));
  } catch (e) { console.error('del spread err', e.stack || e); }
  try {
    // try array
    console.log('del array ->', await c.del(['specter:shop:test:sessions:1','specter:shop:test:sessions:2']));
  } catch (e) { console.error('del array err', e.stack || e); }
  await c.quit();
})();
