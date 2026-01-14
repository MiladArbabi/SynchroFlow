// apps/frontend/vite-plugins/vite-plugin-lasyncro-modules.ts
import { Plugin } from 'vite';
import path from 'path';
import fs from 'fs';

console.log('[lasyncro-plugin] plugin module loaded');

const MODULE_GLOB = /modules\/((?!.*-test)[^/]+)\/src\/ui\/ModuleEntry\.(ts|tsx)$/;

// The virtual module name the host will import:
const VIRTUAL_ID = 'virtual:lasyncro-modules';
const RESOLVED_VIRTUAL_ID = '\0' + VIRTUAL_ID;

export default function lasyncroModulesPlugin(): Plugin {
  let rootDir: string = '';
  let cachedModuleList: string | null = null;

  function scanModules(): string {
    const modulesDir = path.resolve(rootDir, '../../modules');

    if (!fs.existsSync(modulesDir)) {
      return `exports.default = [];`;
    }

    const modulePkgs = fs
      .readdirSync(modulesDir)
      .filter((name) => name !== 'specter')
      .filter((name) => name !== 'my-test-module')
      .filter((name) => {
        const entryTsx = path.join(modulesDir, name, 'src/ui/ModuleEntry.tsx');
        const entryTs  = path.join(modulesDir, name, 'src/ui/ModuleEntry.ts');
        return fs.existsSync(entryTsx) || fs.existsSync(entryTs);
      })
      .map((name) => {
        const pkgPath = path.join(modulesDir, name, 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        return {
          pkgName: pkg.name as string,
          id: pkg.name.replace(/^@lasyncro\//, ''),
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    const entries = modulePkgs
      .map(
        (m) => `
  {
    id: '${m.id}',
    load: async () => {
      const mod = await import('${m.pkgName}');
      return mod.default;
    }
  }`
      )
      .join(',\n');

    return `
  export default [
  ${entries}
  ];
  `;
  }

  return {
    name: 'vite-plugin-lasyncro-modules',

    configResolved(config) {
      rootDir = config.root ?? process.cwd();
      console.log('[lasyncro-plugin] configResolved rootDir=', rootDir);
      // Eager scan at config time so dev-server prints what modules (if any) exist.
      try {
        const preview = scanModules();
        // Extract simple list of module ids for quick human-readable terminal output.
        const ids = (preview.match(/id:\s*'([^']+)'/g) || []).map(m => m.replace(/id:\s*'/, '').replace(/'/g, ''));
        console.log('[lasyncro-plugin] eager-scan found modules:', ids.length ? ids.join(', ') : '<none>');
      } catch (err) {
        console.warn('[lasyncro-plugin] eager-scan failed:', err);
      }
    },

    resolveId(id) {
      /* console.log('[lasyncro-plugin] resolveId called with id=', id); */
      if (id === VIRTUAL_ID) {
        console.log('[lasyncro-plugin] resolveId -> returning resolved virtual id');
        return RESOLVED_VIRTUAL_ID;
      }
      return null;
    },

    load(id) {
      if (id === RESOLVED_VIRTUAL_ID) {
        console.log('[lasyncro-plugin] load virtual module (build time)');
        if (!cachedModuleList) cachedModuleList = scanModules();
        return cachedModuleList;
      }
      return null;
    },

    // HMR: if a module entry changes, invalidate the virtual module
    handleHotUpdate(ctx) {
      if (MODULE_GLOB.test(ctx.file)) {
        cachedModuleList = null;
        ctx.server.moduleGraph.invalidateModule(
          ctx.server.moduleGraph.getModuleById(RESOLVED_VIRTUAL_ID)!
        );
      }
    },
  };
}
