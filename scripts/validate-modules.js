#!/usr/bin/env node
/* scripts/validate-modules.js

   Simple validator for UI module descriptors.
   - Scans modules/*
   - Attempts to require common entry points (src/ModuleEntry, dist/ModuleEntry, index, etc.)
   - If the module exports a `descriptor` object (or default.descriptor) it validates it against a JSON schema
   - Prints a readable report and exits non-zero when violations are found

   Usage:
     npm install --save-dev ajv globby
     node scripts/validate-modules.js

   Optional flags:
     --modulesDir=modules   (defaults to ./modules)
     --fail                 (exit non-zero on warnings as well as errors)
*/

const fs = require('fs');
const path = require('path');

let Ajv;
try {
  Ajv = require('ajv');
} catch (err) {
  console.error('This script requires `ajv` as a devDependency. Run: npm i -D ajv');
  process.exit(2);
}

const ajv = new Ajv({ allErrors: true, strict: false });

const DEFAULT_MODULES_DIR = process.env.MODULES_DIR || getArg('--modulesDir') || 'modules';
const EXIT_ON_WARN = Boolean(getArg('--fail'));

function getArg(k) {
  const match = process.argv.find(a => a.startsWith(k + '='));
  if (match) return match.split('=')[1];
  return process.argv.includes(k);
}

const MODULE_CANDIDATES = [
  'src/ModuleEntry',
  'src/moduleEntry',
  'src/ui/ModuleEntry',
  'src/ui/ModuleEntry.ts',
  'src/ui/ModuleEntry.tsx',
  'dist/ModuleEntry',
  'dist/index',
  'index',
];

// --- JSON Schema for the descriptor ---
const schema = {
  type: 'object',
  required: ['id'],
  properties: {
    id: { type: 'string', minLength: 1 },
    name: { type: 'string' },
    version: { type: 'string' },
    routes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'path'],
        properties: {
          id: { type: 'string' },
          key: { type: 'string' },
          name: { type: 'string' },
          path: { type: 'string' },
          component: {},
          requiredModuleId: { type: 'string' },
          requiredFlagId: { type: 'string' },
          order: { type: 'number' },
          meta: { type: 'object' }
        }
      }
    },
    navItems: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'path', 'title'],
        properties: {
          id: { type: 'string' },
          title: { type: 'string' },
          path: { type: 'string' },
          order: { type: 'number' },
          group: { type: 'string' },
          requiredModuleId: { type: 'string' }
        }
      }
    }
  },
  additionalProperties: true
};

const validate = ajv.compile(schema);

function listModules(dir) {
  try {
    const names = fs.readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name);
    return names;
  } catch (e) {
    console.error(`Failed to list modules dir: ${dir}`);
    return [];
  }
}

function tryRequire(mPath) {
  try {
    // require resolves .js automatically; try add extensions if needed
    return require(mPath);
  } catch (e) {
    return null;
  }
}

function loadDescriptorFromModule(moduleRoot) {
  // 0) Look for explicit descriptor JSON files (root or src/)
  const jsonCandidates = [
    path.join(moduleRoot, 'descriptor.json'),
    path.join(moduleRoot, 'src', 'descriptor.json')
  ];
  for (const j of jsonCandidates) {
   try {
      if (fs.existsSync(j)) {
        const raw = fs.readFileSync(j, 'utf8');
        const parsed = JSON.parse(raw);
        return parsed;
      }
    } catch (e) {
      // add a warning entry so it appears in the summary
      warnings.push({ module: path.basename(moduleRoot), reason: 'invalid-descriptor-json', message: e.message });
      console.warn(`[validate-modules] failed to parse descriptor.json at ${j}: ${e.message}`);
      // continue to try other loaders
    }
  }

  // 1) Fallback: try to require module entry points (src/dist/index etc.)
  for (const cand of MODULE_CANDIDATES) {
    const p = path.join(moduleRoot, cand);
    const tryPaths = [p, p + '.js', p + '.cjs', p + '.mjs', p + '.ts'];
    for (const tp of tryPaths) {
      const resolved = path.resolve(tp);
      if (!fs.existsSync(resolved) && !fs.existsSync(resolved + '.js')) continue;
      const loaded = tryRequire(resolved);
      if (!loaded) continue;
      const exportObj = (loaded && loaded.__esModule && loaded.default) ? loaded.default : loaded;
      if (exportObj && exportObj.descriptor) return exportObj.descriptor;
      if (loaded && loaded.descriptor) return loaded.descriptor;
      if (typeof exportObj === 'object' && exportObj.id) return exportObj;
    }
  }
  return null;
}

async function run() {
  const modulesDir = path.resolve(process.cwd(), DEFAULT_MODULES_DIR);
  console.log('[validate-modules] scanning modules dir:', modulesDir);

  const moduleNames = listModules(modulesDir);
  if (!moduleNames.length) {
    console.warn('[validate-modules] no modules found');
    process.exit(0);
  }

  const errors = [];
  const warnings = [];

  for (const name of moduleNames) {
    const modRoot = path.join(modulesDir, name);
    const descriptor = loadDescriptorFromModule(modRoot);
    if (!descriptor) {
      warnings.push({ module: name, reason: 'no-descriptor-found' });
      continue;
    }

    const valid = validate(descriptor);
    if (!valid) {
      errors.push({ module: name, errors: validate.errors });
      continue;
    }

    // additional light checks
    if (descriptor.version && typeof descriptor.version === 'string') {
      // loose semver-ish check
      if (!/^\d+\.\d+\.\d+/.test(descriptor.version)) {
        warnings.push({ module: name, reason: 'version-not-semver', version: descriptor.version });
      }
    }

    // check routes paths are absolute-ish
    if (Array.isArray(descriptor.routes)) {
      for (const r of descriptor.routes) {
        if (!r.path || typeof r.path !== 'string' || !r.path.startsWith('/')) {
          warnings.push({ module: name, reason: 'route-path-not-rooted', route: r.id || r.path });
        }
      }
    }
  }

  // Print report
  console.log('--- validate-modules report ---');
  console.log(`modules scanned: ${moduleNames.length}`);
  console.log(`errors: ${errors.length}`);
  console.log(`warnings: ${warnings.length}`);

  if (errors.length) {
    console.error('\nErrors:');
    for (const e of errors) {
      console.error(`\n[${e.module}]`);
      console.error(JSON.stringify(e.errors, null, 2));
    }
  }

  if (warnings.length) {
    console.warn('\nWarnings:');
    for (const w of warnings) {
      console.warn(`[${w.module}] ${w.reason} ${w.version ? '(' + w.version + ')' : ''} ${w.route ? '- ' + w.route : ''}`);
    }
  }

  const exitCode = errors.length ? 2 : (EXIT_ON_WARN && warnings.length ? 3 : 0);
  process.exit(exitCode);
}

run().catch((err) => {
  console.error('Unhandled error in validate-modules:', err);
  process.exit(99);
});
