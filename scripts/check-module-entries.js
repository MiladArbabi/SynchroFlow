// scripts/check-module-entries.js
// Usage: node scripts/check-module-entries.js
// Scans modules/* for ModuleEntry.* files and reports ones that don't appear to export an `id`.

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const modulesDir = path.join(repoRoot, 'modules');

if (!fs.existsSync(modulesDir)) {
  console.error('No modules directory found at', modulesDir);
  process.exit(2);
}

const modules = fs.readdirSync(modulesDir, { withFileTypes: true })
  .filter(d => d.isDirectory())
  .map(d => d.name);

const candidates = [
  'src/ui/ModuleEntry.ts',
  'src/ui/ModuleEntry.tsx',
  'src/ui/ModuleEntry/index.ts',
  'dist/src/ui/ModuleEntry.js'
];

const problems = [];

for (const m of modules) {
  const found = candidates
    .map(s => path.join(modulesDir, m, s))
    .find(p => fs.existsSync(p));
  if (!found) continue;

  const content = fs.readFileSync(found, 'utf8');

  // Heuristics:
  // 1) export default { ... id: ... }  <-- old case
  const exportDefaultHasId = /export\s+default\s*{[^}]*\bid\s*:/m.test(content);

  // 2) descriptor object declared with id:  (const descriptor = { id: '...' , ... })
  const descriptorHasId = /(?:const|let|var|export\s+const)\s+descriptor\s*=\s*{[^}]*\bid\s*:/m.test(content);

  // 3) export default descriptor  (or other descriptor-based exports)
  //    matches: export default descriptor;  export default descriptor || export default ({ descriptor }) => ...
  const exportsDefaultDescriptor = /export\s+default\s+(?:descriptor\b|\{?\s*descriptor\s*\}?)/m.test(content) || /\bexport\s+default\s*\(\s*descriptor/m.test(content);

  // Combined decision: consider module having an id if either we exported an object with id,
  // or we exported `descriptor` and that descriptor contains an `id`.
  const hasId = exportDefaultHasId || (descriptorHasId && exportsDefaultDescriptor);

  // Keep the descriptor-pattern flag for reporting (helps debugging)
  const hasDescriptorPattern = /\bdescriptor\b/.test(content) || exportsDefaultDescriptor;

  if (!hasId) {
    problems.push({ module: m, path: found, hasDescriptorPattern });
  }
}

if (problems.length === 0) {
  console.log('OK: no obvious ModuleEntry missing `id` (by heuristic).');
  process.exit(0);
}

console.log('Modules that likely need attention (missing `id`):\n');
problems.forEach(p => {
  console.log(`- ${p.module}`);
  console.log(`  path: ${p.path}`);
  console.log(`  descriptor-like export present: ${p.hasDescriptorPattern}`);
  console.log('');
});

process.exit(1);
