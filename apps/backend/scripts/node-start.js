/**
 * ESM version of node-start
 */

import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// load .env from repo root
dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

function present(name) {
  const v = process.env[name];
  return typeof v === 'string' && v.length > 0 ? 'YES' : 'NO';
}

console.log(
  'ENV check (presence only):',
  'SHOPIFY_API_KEY=' + present('SHOPIFY_API_KEY'),
  'SHOPIFY_API_SECRET=' + present('SHOPIFY_API_SECRET'),
  'SHOPIFY_API_VERSION=' + present('SHOPIFY_API_VERSION'),
  'API_KEY=' + present('API_KEY'),
  'API_SECRET_KEY=' + present('API_SECRET_KEY'),
  'API_VERSION=' + present('API_VERSION')
);

// env fallbacks
if (!process.env.API_KEY && process.env.SHOPIFY_API_KEY)
  process.env.API_KEY = process.env.SHOPIFY_API_KEY;
if (!process.env.API_SECRET_KEY && process.env.SHOPIFY_API_SECRET)
  process.env.API_SECRET_KEY = process.env.SHOPIFY_API_SECRET;
if (!process.env.API_VERSION && process.env.SHOPIFY_API_VERSION)
  process.env.API_VERSION = process.env.SHOPIFY_API_VERSION;

function findServerEntry(distRoot) {
  const stack = [distRoot];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(cur);
    } catch {
      continue;
    }
    for (const name of entries) {
      const full = path.join(cur, name);
      try {
        const stat = fs.statSync(full);
        if (stat.isFile() && name === 'server.js') return full;
        if (stat.isDirectory()) stack.push(full);
      } catch {}
    }
  }
  return null;
}

const expectedDistRoot = path.resolve(__dirname, '../dist');
let serverEntry = path.resolve(expectedDistRoot, 'server.js');

if (!fs.existsSync(serverEntry)) {
  const discovered = findServerEntry(expectedDistRoot);
  if (!discovered) {
    console.error('Compiled server not found in dist/');
    process.exit(1);
  }
  serverEntry = discovered;
  console.warn('Using discovered server entry:', serverEntry);
}

const serverModule = await import(pathToFileURL(serverEntry).href);
const app = serverModule?.default ?? serverModule;

if (!app || typeof app.listen !== 'function') {
  console.error('Compiled server did not export an Express app.');
  process.exit(1);
}

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';

const server = app.listen(port, host, async () => {
  console.log(`Server listening on http://${host}:${port}`);

  async function tryStart(modulePath, fnName) {
    try {
      const resolved = path.resolve(path.dirname(serverEntry), modulePath);
      if (!fs.existsSync(resolved)) return;

      const mod = await import(pathToFileURL(resolved).href);

      const fn =
        mod?.[fnName] ??
        mod?.default?.[fnName] ??
        mod?.startWorker ??
        mod?.startSyncWorker;

      if (typeof fn === 'function') {
        await fn();
        console.log(`Started ${modulePath}`);
      }
    } catch (err) {
      console.error(`Failed to start ${modulePath}:`, err);
    }
  }

  await tryStart('queue.js', 'initQueue');
});
