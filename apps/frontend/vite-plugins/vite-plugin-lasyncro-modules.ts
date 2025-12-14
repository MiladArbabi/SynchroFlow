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
      console.warn(`[lasyncro-modules] No ./modules directory found.`);
      return `export default [];`;
    }

    const moduleEntries: Array<{ id: string; entry: string }> = [];

    function walk(dir: string) {
      const files = fs.readdirSync(dir, { withFileTypes: true });
      for (const file of files) {
        const fullPath = path.join(dir, file.name);

        if (file.isDirectory()) {
          walk(fullPath);
          continue;
        }

        const rel = fullPath.replace(rootDir + '/', '');

        if (MODULE_GLOB.test(rel)) {
          const match = rel.match(MODULE_GLOB);
          const moduleId = match?.[1];
          if (!moduleId) continue;

          moduleEntries.push({
            id: moduleId,
            entry: fullPath,
          });
        }
      }
    }

    walk(modulesDir);

    // deterministic ordering for reproducible builds
    moduleEntries.sort((a, b) => a.id.localeCompare(b.id));

    const imports = moduleEntries
      .map(
        (m, i) =>
          `import * as m${i} from '${m.entry.split(path.sep).join('/')}';`
      )
      .join('\n');

    const exportList = moduleEntries
      .map(
        (m, i) =>
          `{ id: '${m.id}', load: async () => m${i}.default }`
      )
      .join(',\n');

    return `
${imports}

export default [
${exportList}
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
