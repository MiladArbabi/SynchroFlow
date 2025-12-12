// scripts/patch-module-entry.js
// OPTIONAL helper. Use only if you explicitly want to auto-insert an `id` fallback.
// Usage: node scripts/patch-module-entry.js <path/to/ModuleEntry.ts>

const fs = require('fs');
const path = require('path');

const target = process.argv[2];
if (!target) {
  console.error('Usage: node scripts/patch-module-entry.js <path/to/ModuleEntry.ts>');
  process.exit(2);
}
const p = path.resolve(target);
if (!fs.existsSync(p)) {
  console.error('File not found:', p);
  process.exit(2);
}
const orig = fs.readFileSync(p, 'utf8');
fs.writeFileSync(p + '.bak', orig, 'utf8');

let s = orig;

// Simple replacement when pattern is exactly "export default { register }"
const simplePattern = /export\s+default\s*{\s*register\s*}\s*;?\s*$/m;
if (simplePattern.test(s)) {
  const moduleId = path.basename(path.dirname(path.dirname(p)));
  s = s.replace(simplePattern, `export default { id: descriptor?.id || "${moduleId}", ...descriptor, register };`);
  fs.writeFileSync(p, s, 'utf8');
  console.log('Patched (simple replace):', p);
  process.exit(0);
}

// Try to inject id if export default object exists
const exportObjPattern = /(export\s+default\s*{)([\s\S]*?)(}\s*;?\s*)$/m;
if (exportObjPattern.test(s)) {
  const moduleId = path.basename(path.dirname(path.dirname(p)));
  s = s.replace(exportObjPattern, (m0, start, body, end) => {
    if (/\bid\s*:/.test(body)) return m0;
    return `${start}\n  id: descriptor?.id || "${moduleId}",\n${body}\n${end}`;
  });
  fs.writeFileSync(p, s, 'utf8');
  console.log('Patched (injected id):', p);
  process.exit(0);
}

// fallback: append a safe default export
const moduleId = path.basename(path.dirname(path.dirname(p)));
const append = `\n\n// Fallback safe export added by script\nexport default { id: descriptor?.id || "${moduleId}", ...descriptor, register };\n`;
fs.appendFileSync(p, append, 'utf8');
console.log('Appended fallback export to', p);
process.exit(0);
