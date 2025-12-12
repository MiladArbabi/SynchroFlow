#!/usr/bin/env node

/**
 * LaSyncro UI Module Scaffold Script (Refined)
 *
 * - Creates a new UI module under modules/<moduleName>/
 * - Enforces the recommended folder structure
 * - Inserts template files from scripts/templates/ui-module/
 * - Prevents accidental overwrite unless --force is passed
 */

const fs = require('fs');
const path = require('path');

const MODULES_DIR = path.resolve(process.cwd(), 'modules');
const TEMPLATE_DIR = path.resolve(process.cwd(), 'scripts/templates/ui-module');

// -------------------------------
// Helpers
// -------------------------------

function fatal(msg) {
  console.error(`❌ ${msg}`);
  process.exit(1);
}

function log(msg) {
  console.log(`✔️  ${msg}`);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    log(`Created dir: ${path.relative(process.cwd(), dir)}`);
  }
}

// (renderTemplateFile implemented below - single canonical implementation)

// -------------------------------
// Main Logic
// -------------------------------

const args = process.argv.slice(2);
const moduleName = args[0];
const force = args.includes('--force');

if (!moduleName) {
  fatal('Usage: node scripts/scaffold-ui-module.js <module-name> [--force]');
}

const moduleRoot = path.join(MODULES_DIR, moduleName);

if (fs.existsSync(moduleRoot) && !force) {
  fatal(
    `Module "${moduleName}" already exists. Use --force to overwrite (dangerous).`
  );
}

// destructive when --force: remove existing folder first to ensure a clean scaffold
if (fs.existsSync(moduleRoot) && force) {
  fs.rmSync(moduleRoot, { recursive: true, force: true });
  log(`Removed existing module folder due to --force: ${path.relative(process.cwd(), moduleRoot)}`);
}

// Ensure module root folder
ensureDir(moduleRoot);

// Subdirectories (Recommended Set)
const dirs = [
  'src/ui/components',
  'src/ui/pages',
  'src/ui/layout',
];

dirs.forEach((d) => ensureDir(path.join(moduleRoot, d)));

// -------------------------------
// Copy template files
// -------------------------------
const TOKENS = {
  MODULE_NAME: moduleName,
  MODULE_ID: moduleName,
  moduleId: moduleName,
  MODULE_TITLE: moduleName.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
  PASCAL_NAME: moduleName.replace(/(^|-)([a-z])/g, (_, __, ch) => ch.toUpperCase().replace('-', '')),
  version: '0.1.0'
};

// Support two flavors of templates in scripts/templates/ui-module:
// - plain files (e.g. ExamplePage.tsx)
// - Handlebars templates (filename.hbs) which will be compiled if 'handlebars' package is present.
// We map candidate templates (if existing) to destination paths.
const TEMPLATE_MAP = [
  // Core contract files
  { src: 'ModuleEntry.tsx', dest: `src/ui/ModuleEntry.tsx` },
  { src: 'ModuleDescriptor.ts', dest: `src/ui/ModuleDescriptor.ts` },
  { src: 'ModuleLayout.tsx', dest: `src/ui/layout/ModuleLayout.tsx` },

  // Example primitives + pages
  { src: 'ExamplePage.tsx', dest: `src/ui/pages/ExamplePage.tsx` },
  { src: 'ExampleWidget.tsx', dest: `src/ui/components/ExampleWidget.tsx` },

  // Tokens file
  { src: 'design-tokens.json', dest: `src/ui/design-tokens.json` },

  // Module index barrel
  { src: 'index.ts', dest: `src/ui/index.ts` },

  // Contract test stub (allow .hbs too)
  { src: 'ModuleEntry.stub.js', dest: `ModuleEntry.stub.js` },

  // optional helper templates that many modules should get
  { src: 'package.json.hbs', dest: `package.json` },
  { src: 'tsconfig.json.hbs', dest: `tsconfig.json` },
  { src: 'src/descriptor.json.hbs', dest: `src/descriptor.json` },
];

// utility that handles .hbs (handlebars) templates if available, else falls back to token replacement
function renderTemplateFile(srcPath, destPath, tokens) {
  const isHbs = srcPath.endsWith('.hbs');
  let raw = fs.readFileSync(srcPath, 'utf8');

  // Prefer Handlebars if installed for .hbs templates
  if (isHbs) {
    try {
      const handlebars = require('handlebars');
      const tpl = handlebars.compile(raw);
      raw = tpl(tokens);
    } catch (e) {
      // handlebars not present — fallback to simple token replacement
      for (const [k, v] of Object.entries(tokens)) {
        raw = raw.replace(new RegExp(`__${k}__`, 'g'), v);
      }
    }
  } else {
    // plain file -> token replacement
    for (const [key, val] of Object.entries(tokens)) {
      raw = raw.replace(new RegExp(`__${key}__`, 'g'), val);
    }
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, raw, 'utf8');
  log(`Created file: ${path.relative(process.cwd(), destPath)}`);
}

// Render templates in map order. Important: ensure src/descriptor.json is rendered before we attempt to copy it to root.
TEMPLATE_MAP.forEach(({ src, dest }) => {
  const candidates = [src, src + '.hbs', path.join(src)];
  let found = null;
  for (const cand of candidates) {
    const srcPath = path.join(TEMPLATE_DIR, cand);
    if (fs.existsSync(srcPath)) {
      found = srcPath;
      break;
    }
  }
  // Core templates we require
  const requiredTemplates = [
    'package.json.hbs',
    'tsconfig.json.hbs',
    'src/descriptor.json.hbs',
    'ModuleEntry.tsx',
    'ModuleDescriptor.ts'
  ];
  const isRequired = requiredTemplates.includes(src) || requiredTemplates.includes(src + '.hbs');
  if (!found) {
    if (isRequired) {
      fatal(`Required template missing in ${TEMPLATE_DIR}: ${src} (.hbs fallback tried)`);
    } else {
      // optional templates: skip silently
      return;
    }
  }
  const destPath = path.join(moduleRoot, dest);
  renderTemplateFile(found, destPath, TOKENS);
});

// Copy src/descriptor.json to module root descriptor.json for validator convenience
try {
  const srcDesc = path.join(moduleRoot, 'src', 'descriptor.json');
  const rootDesc = path.join(moduleRoot, 'descriptor.json');
  if (fs.existsSync(srcDesc) && !fs.existsSync(rootDesc)) {
    fs.copyFileSync(srcDesc, rootDesc);
    log(`Created file: ${path.relative(process.cwd(), rootDesc)}`);
  }
} catch (e) {
  console.warn('[scaffold] failed to copy src/descriptor.json to root:', e.message);
}

// Done
console.log(`\n🎉 Module "${moduleName}" scaffolded successfully!`);
console.log(`Path: modules/${moduleName}/`);
console.log(`Next: fill in ModuleEntry.tsx + tokens + pages.\n`);

// (already copied src/descriptor.json -> descriptor.json earlier in the flow if present)