// packages/api/__tests__/worker.test.ts
import { processMessage } from '../src/worker';
import db from '../src/db';
import { channelWrapper } from '../src/queue';

// Mock the entire db module
jest.mock('../src/db');
const mockedDb = db as unknown as jest.Mock; // Use a two-step cast

// Mock the entire queue module
jest.mock('../src/queue');
// Create a typed mock that we can control in our tests
const mockedChannelWrapper = channelWrapper as jest.Mocked<typeof channelWrapper>;

// Create a typed mock for the knex chain
const mockFirst = jest.fn();
const mockWhere = jest.fn().mockReturnValue({ first: mockFirst });
mockedDb.mockReturnValue({ where: mockWhere }); // Use the typed mock

describe('API Queue Worker', () => {

  beforeEach(() => {
    // Clear mock history before each test
    mockFirst.mockClear();
    mockedDb.mockClear(); // Use the typed mock
    mockWhere.mockClear();
    console.log = jest.fn(); // Mock console.log to check its output

    // Reset our queue mock and provide a dummy implementation for the test
    (mockedChannelWrapper.ack as jest.Mock).mockClear();
    (mockedChannelWrapper.nack as jest.Mock).mockClear();
  });

  it('should process a message, fetch data from db, and log the payload', async () => {
    // 1. SETUP
    const fakeStagedEvent = {
      id: 123,
      source_platform: 'shopify',
      raw_payload: { order_id: 54321, note: 'Live test webhook' }
    };
    mockFirst.mockResolvedValue(fakeStagedEvent); // Tell our DB mock what to return

    const fakeMessage = {
      content: Buffer.from(JSON.stringify({ staged_event_id: 123 }))
    };

    // 2. EXECUTION
    // We cast fakeMessage to `any` because it's a simplified version of a real amqplib message
    await processMessage(fakeMessage as any);

    // 3. ASSERTION
    // Check if we queried the DB for the right ID
    expect(mockWhere).toHaveBeenCalledWith({ id: 123 });
    expect(mockFirst).toHaveBeenCalled();

    // Check if we logged the correct payload
    expect(console.log).toHaveBeenCalledWith(
      '[worker] Processing staged event payload:',
      fakeStagedEvent.raw_payload
    );

    // Check that we acknowledged the message on the queue
    expect(mockedChannelWrapper.ack).toHaveBeenCalled();
  });
});