import fs from 'fs';
import path from 'path';
import lasyncroModulesPlugin from '../../../apps/frontend/vite-plugins/vite-plugin-lasyncro-modules';

it('excludes deprecated Customers from real module discovery while retaining active S5 modules', () => {
  const root = path.resolve(__dirname, '../../../apps/frontend');
  // Prove exclusion is deliberate: the deprecated entry still exists.
  expect(fs.existsSync(path.resolve(root, '../../modules/customers/src/ui/ModuleEntry.ts')) ||
    fs.existsSync(path.resolve(root, '../../modules/customers/src/ui/ModuleEntry.tsx'))).toBe(true);
  const plugin = lasyncroModulesPlugin() as any;
  plugin.configResolved.call({}, { root });
  const id = plugin.resolveId.call({}, 'virtual:lasyncro-modules');
  const code = plugin.load.call({}, id) as string;
  const ids = Array.from(code.matchAll(/id:\s*'([^']+)'/g), match => match[1]);
  expect(ids).not.toContain('customers');
  expect(code).not.toContain("import('@lasyncro/customers')");
  expect(ids).toEqual(expect.arrayContaining(['overview', 'order-nexus', 'products', 'floor-planning', 'wms']));
  expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
});
