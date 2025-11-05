//tests/unit/integration/sse.test.ts
import app from 'api-server'; // Assuming your server.ts exports 'app'
import http from 'http';
import { EventSource } from 'eventsource'; // We need this dev dependency
import { opsIntelEmitter } from 'api-src/services/opsIntel/emitter';
import { ProactiveInsight } from 'api-src/services/opsIntel/types';

let server: http.Server;
let port: number;

// Start the server before all tests
beforeAll((done) => {
  server = app.listen(0, () => {
    // 0 means assign a random free port
    const address = server.address();
    port = typeof address === 'string' ? 0 : address!.port;
    done();
  });
});

// Stop the server after all tests
afterAll((done) => {
  server.close(done);
});

describe('Kore Comlink (SSE Endpoint)', () => {
  let client: EventSource;

  // Clean up any open client after each test
  afterEach(() => {
    if (client) {
      client.close();
    }
  });

  it('should receive a proactive insight event', (done) => {
    // This endpoint will 404, causing the test to fail
    const url = `http://localhost:${port}/api/v1/kore/subscribe`;
    
    // Connect to the SSE endpoint
    client = new EventSource(url);

    // 1. Define the mock insight we're going to send
    const mockInsight: ProactiveInsight = {
      id: 'test-insight',
      type: 'alert',
      title: 'Test Alert',
      message: 'This is a test',
      urgency: 'high',
      timestamp: Date.now(),
      source: 'orders',
      actionPayload: [],
    };

    // 2. Set up the event listener
    client.addEventListener('insight', (event: { data: string; }) => {
      // 4. This is our assertion.
      // If we get here, the test passed.
      const data = JSON.parse(event.data);
      expect(data.id).toBe('test-insight');
      expect(data.title).toBe('Test Alert');
      client.close();
      done(); // Tell Jest the async test is complete
    });

    // 3. After the client connects, manually emit an event
    //    from the "backend" to trigger the listener.
    //    We add a small delay to ensure the connection is open.
    setTimeout(() => {
      opsIntelEmitter.emit('insight', mockInsight);
    }, 100);
  });
});