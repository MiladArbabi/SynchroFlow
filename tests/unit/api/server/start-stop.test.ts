// apps/backend/tests/server/start-stop.test.ts
import app from 'api-src/server';
import { initSpecterStore, closeSpecterStore } from 'api-src/bootstrap/specter-store';
import { initQueue, closeQueue } from 'api-src/bootstrap/queue';
import http from 'http';

jest.setTimeout(15000);

describe('server start/stop smoke', () => {
  let server: http.Server | null = null;

  beforeAll(async () => {
    // run init hooks the same way start() does — but don't start background jobs
    await initSpecterStore();
    await initQueue();
    server = app.listen(0); // random free port
  });

  afterAll(async () => {
    if (server) {
      await new Promise<void>((res) => server!.close(() => res()));
    }
    await closeSpecterStore();
    await closeQueue();
  });

  test('GET /health returns ok', async () => {
    const addr = server!.address();
    const port = (addr && typeof addr === 'object') ? addr.port : 3000;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe('ok');
  });
});
