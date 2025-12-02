/**
 * apps/backend/scripts/node-start.js
 * Runtime helper to load the compiled backend from apps/backend/dist
 * Ensures the HTTP server starts even when the module was required.
 */
const path = require('path');
const fs = require('fs');

// load .env from repo root
require('dotenv').config({ path: path.resolve(__dirname, '../../../.env') });

// simple presence check (do NOT print secrets)
function present(name) {
  const v = process.env[name];
  return (typeof v === 'string' && v.length > 0) ? 'YES' : 'NO';
}
console.log('ENV check (presence only):',
  'SHOPIFY_API_KEY=' + present('SHOPIFY_API_KEY'),
  'SHOPIFY_API_SECRET=' + present('SHOPIFY_API_SECRET'),
  'SHOPIFY_API_VERSION=' + present('SHOPIFY_API_VERSION'),
  'API_KEY=' + present('API_KEY'),
  'API_SECRET_KEY=' + present('API_SECRET_KEY'),
  'API_VERSION=' + present('API_VERSION')
);

// fallbacks for env names
if (!process.env.API_KEY && process.env.SHOPIFY_API_KEY) {
  process.env.API_KEY = process.env.SHOPIFY_API_KEY;
}
if (!process.env.API_SECRET_KEY && process.env.SHOPIFY_API_SECRET) {
  process.env.API_SECRET_KEY = process.env.SHOPIFY_API_SECRET;
}
if (!process.env.API_VERSION && process.env.SHOPIFY_API_VERSION) {
  process.env.API_VERSION = process.env.SHOPIFY_API_VERSION;
}
if (!process.env.apiKey && process.env.SHOPIFY_API_KEY) process.env.apiKey = process.env.SHOPIFY_API_KEY;
if (!process.env.apiSecretKey && process.env.SHOPIFY_API_SECRET) process.env.apiSecretKey = process.env.SHOPIFY_API_SECRET;
if (!process.env.apiVersion && process.env.SHOPIFY_API_VERSION) process.env.apiVersion = process.env.SHOPIFY_API_VERSION;

// Register tsconfig-paths to map runtime aliases to compiled outputs.
// backend tsc currently emits files directly under apps/backend/dist
const baseDist = path.resolve(__dirname, '../dist');
require('tsconfig-paths').register({
  baseUrl: baseDist,
  paths: {
    "api-server": [ path.resolve(baseDist, 'server.js') ],
    "api-db":     [ path.resolve(baseDist, 'db.js') ],
    "api-types":  [ path.resolve(baseDist, 'types.js') ],
    "api-src/*":  [ path.resolve(baseDist, '*') ],
    "@synchroflow/shared/*": [ path.resolve(__dirname, '../../modules/shared/dist/*') ]
  },
});

// Ensure expected compiled entry exists
const entry = path.resolve(__dirname, '../dist/server.js');
if (!fs.existsSync(entry)) {
  console.error('ERROR: expected compiled backend entry not found at', entry);
  console.error('Listing dist contents for debugging:');
  try { console.error(fs.readdirSync(path.resolve(__dirname, '../dist'))); } catch(e){/*ignore*/ }
  process.exit(1);
}

// require compiled server module
const compiled = require(entry);
const app = (compiled && compiled.default) ? compiled.default : compiled;

// Validate we have an express app-like object
if (!app || typeof app.listen !== 'function') {
  console.error('ERROR: compiled server did not export an Express app with listen(). Exiting.');
  process.exit(1);
}

// Determine port/host
const port = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Start HTTP server (this mirrors the behaviour that would happen when running node dist/server.js directly)
const server = app.listen(port, HOST, async () => {
  console.log(`Server is listening on http://${HOST}:${port}`);

  // Lazily start workers if available in dist (fail safely)
  const tryStart = async (modulePath, fnName) => {
    try {
      const resolved = path.resolve(__dirname, '../dist', modulePath);
      if (!fs.existsSync(resolved)) {
        console.warn(`Worker not found at ${resolved} (skipping)`);
        return;
      }
      const mod = require(resolved);
      const fn = mod && (mod[fnName] || mod.default && mod.default[fnName]);
      if (typeof fn === 'function') {
        await fn();
        console.log(`Started ${modulePath} -> ${fnName}()`);
      } else {
        // Some worker modules export a start function named differently; attempt common names
        if (typeof mod.startWorker === 'function') {
          await mod.startWorker();
          console.log(`Started ${modulePath} -> startWorker()`);
        } else if (typeof mod.startSyncWorker === 'function') {
          await mod.startSyncWorker();
          console.log(`Started ${modulePath} -> startSyncWorker()`);
        } else {
          console.warn(`No known start function in ${modulePath} (module exported keys: ${Object.keys(mod).join(', ')})`);
        }
      }
    } catch (err) {
      console.error(`Failed to start worker ${modulePath}:`, err && err.message ? err.message : err);
    }
  };

  // try queue/worker modules emitted in dist
  await tryStart('worker.js', 'startWorker');
  await tryStart('sync.worker.js', 'startSyncWorker');
});