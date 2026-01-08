// tests/unit/backend/analytics/analyticsFt2.routes.test.ts
import request from 'supertest';
import { createApp } from 'api-src/bootstrap/express';

function collectRoutes(
  stack: any[],
  prefix = ''
): string[] {
  const routes: string[] = [];

  for (const layer of stack) {
    if (layer.route?.path) {
      routes.push(prefix + layer.route.path);
      continue;
    }

    if (layer.name === 'router' && layer.handle?.stack) {
      const match = layer.regexp?.toString().match(/^\/\^\\\/(.+?)\\\/\?\(\?=\\\/\|\$\)\/$/);

      const mountPath = match
        ? '/' + match[1].replace(/\\\//g, '/')
        : '';

      routes.push(
        ...collectRoutes(layer.handle.stack, prefix + mountPath)
      );
    }
  }

  return routes;
}

describe('Analytics FT2 route registration', () => {
  it('exposes GET /api/v1/modules/analytics/ft2', async () => {
    const app = createApp();

    const res = await request(app)
      .get('/api/v1/modules/analytics/ft2');

    // We do NOT care about auth success here.
    // 401 proves the route exists and auth is enforced.
    expect([401, 403]).toContain(res.status);
  });
});