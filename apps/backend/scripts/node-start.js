/**
 * apps/backend/scripts/node-start.js
 * Robust helper to locate and load the compiled backend.
 * - Attempts to find `server.js` under apps/backend/dist (supports nested output layouts)
 * - Registers tsconfig-paths using the directory that contains the compiled server
 * - Starts the HTTP server and attempts to lazily start worker modules
 */
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

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

// Search for server.js under apps/backend/dist (depth-first)
function findServerEntry(distRoot) {
  const stack = [distRoot];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur);
    } catch (e) {
      continue;
    }
    for (const name of entries) {
      const full = path.join(cur, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile() && name === 'server.js') return full;
        if (stat.isDirectory()) stack.push(full);
      } catch (e) {
        // ignore
      }
    }
  }
  return null;
}

const expectedDistRoot = path.resolve(__dirname, '../dist');
let serverEntry = path.resolve(expectedDistRoot, 'server.js');
if (!fs.existsSync(serverEntry)) {
  // attempt discovery for nested layouts
  const discovered = findServerEntry(expectedDistRoot);
  if (discovered) {
    console.warn('Warning: server.js not at expected path; using discovered entry:', discovered);
    serverEntry = discovered;
  } else {
    console.error('ERROR: expected compiled backend entry not found at', path.resolve(expectedDistRoot, 'server.js'));
    console.error('Checked top-level dist contents:', (() => { try { return fs.readdirSync(expectedDistRoot); } catch(e){ return []; } })());
    process.exit(1);
  }
}

// Determine baseDir for tsconfig-paths registration (use server's parent dir)
const serverDir = path.dirname(serverEntry);
const tsConfigBase = serverDir;

// Register tsconfig-paths to map runtime aliases to compiled outputs.
// Strategy:
// 1) Prefer `tsconfig-paths/register` (simple, uses tsconfig.json automatically).
// 2) If not available, fall back to programmatic registration via `tsconfig-paths`.
// 3) If neither is available, continue without fatal error (best-effort).
(function registerTsConfigPaths() {
  try {
    // Intentionally avoid blindly using tsconfig-paths/register fast-path here.
    // Instead we register programmatic mappings that prefer compiled `modules/*/dist`
    // at runtime (so Node requires JS), while TypeScript compilation can still
    // prefer source `modules/*/src` for types when building.
    // We still fall back to `tsconfig-paths/register` if programmatic registration fails.
    // (This prevents runtime mapping from accidentally resolving to .ts source files.)
  } catch (_) {
    // ignore - proceed to programmatic registration below
  }

  try {
    const tsp = require('tsconfig-paths');

    const mappedPaths = {
      // runtime module IDs -> compiled artifacts
      "api-server": [path.resolve(tsConfigBase, 'server.js')],
      "api-db": [path.resolve(tsConfigBase, 'db.js')],
      "api-types": [path.resolve(tsConfigBase, 'types.js')],
      "api-src/*": [path.resolve(tsConfigBase, '*')],

      // prefer compiled packages under modules/*/dist
      "@lasyncro/shared": [path.resolve(__dirname, '../../../modules/shared/dist/index.js')],
      "@lasyncro/shared/*": [path.resolve(__dirname, '../../../modules/shared/dist/*')],

      // specter compiled outputs
      "modules-specter/*": [path.resolve(__dirname, '../../../modules/specter/dist/*')],
      "modules-specter": [path.resolve(__dirname, '../../../modules/specter/dist/index.js')]
    };

    tsp.register({
      baseUrl: tsConfigBase,
      paths: mappedPaths
    });

    console.log('[node-start] programmatic tsconfig-paths registration complete (runtime -> modules/*/dist)');
  } catch (err) {
    // Non-fatal: log and continue — runtime imports may still resolve via relative requires.
    console.warn('[node-start] tsconfig-paths not available; continuing without runtime alias registration:', err && err.message ? err.message : err);
  }
})();

// require compiled server module
// Ensure compiled code can find a knexfile at a relative path it expects.
// Compiled files may require('../knexfile.js') relative to compiled file layout.
try {
  const expectedKnexPath = path.resolve(serverDir, '..', 'knexfile.js');
  if (!fs.existsSync(expectedKnexPath)) {
    const realKnex = path.resolve(__dirname, '../knexfile.js'); // the source knexfile in apps/backend
    if (fs.existsSync(realKnex)) {
      // Create a tiny proxy module that re-exports the real knexfile.
      const proxyContent = `module.exports = require(${JSON.stringify(realKnex)});`;
      fs.writeFileSync(expectedKnexPath, proxyContent, { encoding: 'utf8' });
      console.log('Created temporary knexfile proxy at', expectedKnexPath);

      // Best-effort cleanup on exit
      const removeProxy = () => {
        try { fs.unlinkSync(expectedKnexPath); console.log('Removed temporary knexfile proxy'); } catch (_) {}
      };
      process.on('exit', removeProxy);
      process.on('SIGINT', () => { removeProxy(); process.exit(130); });
      process.on('SIGTERM', () => { removeProxy(); process.exit(0); });
    } else {
      console.warn('Real knexfile not found at', realKnex, '; compiled code may fail to require knexfile.');
    }
  }
} catch (e) {
  console.warn('Failed to ensure knexfile proxy:', e && e.message ? e.message : e);
}

const compiled = require(serverEntry);
const app = (compiled && compiled.default) ? compiled.default : compiled;

// Validate we have an express app-like object
if (!app || typeof app.listen !== 'function') {
  console.error('ERROR: compiled server did not export an Express app with listen(). Exiting.');
  process.exit(1);
}

// Determine port/host
const port = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';

// Start HTTP server (mirrors running node dist/server.js directly)
const server = app.listen(port, HOST, async () => {
  console.log(`Server is listening on http://${HOST}:${port}`);

  // Lazily start workers if available relative to the discovered server dir
  const tryStart = async (modulePath, fnName) => {
    try {
      const resolved = path.resolve(serverDir, modulePath);
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

  // Ensure queue is initialized before workers that may rely on it.
  // The compiled dist should export `initQueue()` / `closeQueue()` for lifecycle control.
  await tryStart('queue.js', 'initQueue');

  // Now start workers that rely on queue & other services.
  await tryStart('worker.js', 'startWorker');
  await tryStart('sync.worker.js', 'startSyncWorker');
});