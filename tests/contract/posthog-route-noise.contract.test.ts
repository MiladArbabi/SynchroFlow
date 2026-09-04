import fs from 'fs';
import path from 'path';

const root = process.cwd();

function source(relativePath: string): string {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('AN-PH-01 route analytics noise', () => {
  test('RouteLogger does not emit analytics page-view events', () => {
    const logger = source('apps/frontend/src/debug/RouteLogger.tsx');

    expect(logger).not.toContain("emit('ui.intent'");
    expect(logger).not.toContain("action: 'page_view'");
  });

  test('RouteLogger is not mounted in the production application tree', () => {
    const main = source('apps/frontend/src/main.tsx');

    expect(main).not.toContain('<RouteLogger />');
  });
});
