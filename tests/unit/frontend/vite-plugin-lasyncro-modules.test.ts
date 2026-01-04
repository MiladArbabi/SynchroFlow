import path from 'path';


function invokeConfigResolved(
  plugin: any,
  config: { root: string }
) {
  const ctx = {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    meta: {},
  };

  const cr = plugin.configResolved;
  if (!cr) return;

  if (typeof cr === 'function') {
    cr.call(ctx, config);
  } else {
    cr.handler.call(ctx, config);
  }
}

// ─────────────────────────────────────────────
// fs mock — package.json–only world
// ─────────────────────────────────────────────
jest.mock('fs', () => {
  const realFs = jest.requireActual('fs');

  const mockFs: Record<string, string> = {
    '/repo/modules/order-nexus/package.json': JSON.stringify({
      name: '@lasyncro/order-nexus',
      exports: {
        '.': './dist/ui/index.js',
      },
    }),
    '/repo/modules/shared/package.json': JSON.stringify({
      name: '@lasyncro/shared',
      exports: {
        '.': './dist/index.js',
      },
    }),
  };

  return {
    ...realFs,

    existsSync: (p: string) =>
      p === '/repo/modules' || Object.prototype.hasOwnProperty.call(mockFs, p),

    readdirSync: (p: string) => {
      if (p === '/repo/modules') {
        // intentionally unsorted
        return ['shared', 'order-nexus'];
      }
      throw new Error(`Unexpected readdirSync(${p})`);
    },

    readFileSync: (p: string) => {
      if (!mockFs[p]) {
        throw new Error(`Unexpected readFileSync(${p})`);
      }
      return mockFs[p];
    },

    statSync: () => ({
      isDirectory: () => true,
      isFile: () => true,
    }),
  };
});

// ─────────────────────────────────────────────
// Dynamic import spy
// ─────────────────────────────────────────────
const mockImportSpy = jest.fn();

jest.mock('@lasyncro/order-nexus', () => {
  mockImportSpy('@lasyncro/order-nexus');
  return { default: { id: 'order-nexus' } };
});

jest.mock('@lasyncro/shared', () => {
  mockImportSpy('@lasyncro/shared');
  return { default: { id: 'shared' } };
});

// ─────────────────────────────────────────────
// System under test
// ─────────────────────────────────────────────
import lasyncroModulesPlugin from '../../../apps/frontend/vite-plugins/vite-plugin-lasyncro-modules';

function loadVirtualModule(plugin: any): string {
  const resolvedId = plugin.resolveId?.('virtual:lasyncro-modules');
  expect(resolvedId).toBeTruthy();
  return plugin.load(resolvedId);
}

describe('vite-plugin-lasyncro-modules (RED)', () => {
  beforeEach(() => {
    mockImportSpy.mockClear();
  });

  test('discovers modules via package.json only (no src scanning)', () => {
    const plugin = lasyncroModulesPlugin();

    invokeConfigResolved(plugin, { root: '/repo/apps/frontend' });

    const code = loadVirtualModule(plugin);

    // Modules discovered
    expect(code).toContain("id: 'order-nexus'");
    expect(code).toContain("id: 'shared'");

    // HARD FAIL CONDITIONS
    expect(code).not.toContain('/src/');
    expect(code).not.toContain('ModuleEntry');
    expect(code).not.toContain('modules/');
  });

  test('load() imports via package name, never file paths', async () => {
    const plugin = lasyncroModulesPlugin();

    invokeConfigResolved(plugin, { root: '/repo/apps/frontend' });

    const code = loadVirtualModule(plugin);

    // Execute virtual module
    const exports: any = {};
    // eslint-disable-next-line no-new-func
    new Function('exports', 'require', code)(exports, require);

    const modules = exports.default;
    expect(Array.isArray(modules)).toBe(true);

    await modules[0].load();
    await modules[1].load();

    expect(mockImportSpy).toHaveBeenCalledWith('@lasyncro/order-nexus');
    expect(mockImportSpy).toHaveBeenCalledWith('@lasyncro/shared');
  });

  test('output order is deterministic (sorted by id)', () => {
    const plugin = lasyncroModulesPlugin();

    invokeConfigResolved(plugin, { root: '/repo/apps/frontend' });

    const code = loadVirtualModule(plugin);

    const ids = [...code.matchAll(/id:\s*'([^']+)'/g)].map(m => m[1]);

    expect(ids).toEqual(['order-nexus', 'shared']);
  });
});