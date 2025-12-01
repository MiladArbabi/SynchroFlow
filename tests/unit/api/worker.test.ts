//packages/api/__tests__/worker.test.ts
import { processMessage } from 'api-src/worker';
import db from 'api-src/db';
import * as queueModule from 'api-src/queue';
import { transformPayload } from 'api-src/transformer';

const { channelWrapper, queueConnection } = queueModule as any;

// Mock all external dependencies
jest.mock('api-src/db');
jest.mock('api-src/queue');
jest.mock('api-src/transformer');

// Create typed variables for our mocks
const mockedDb = db as unknown as jest.Mock;
const mockedChannelWrapper = channelWrapper as jest.Mocked<typeof channelWrapper>;
const mockedTransformPayload = transformPayload as jest.Mock;

// Setup the mock for the Knex query chain
const mockFirst = jest.fn();
const mockWhere = jest.fn();
mockedDb.mockReturnValue({ where: mockWhere });

describe('API Queue Worker', () => {

  beforeEach(() => {
    // Clear all mock history before each test
    mockFirst.mockClear();
    mockedDb.mockClear();
    mockWhere.mockClear();
    mockedTransformPayload.mockClear();

    // Provide a clear implementation for the ack/nack functions on the channel mock
    if (mockedChannelWrapper) {
      mockedChannelWrapper.ack = jest.fn();
      mockedChannelWrapper.nack = jest.fn();
    }
  });

  it.skip('should fetch a staged event, get mapping rules, and call the transformer', async () => {
    // 1. SETUP
    const fakeStagedEvent = {
      id: 123,
      shop_id: 1,
      source_platform: 'shopify',
      raw_payload: { order_id: 54321, note: 'Live test webhook' }
    };
    const fakeMappingRules = [
      { source_field_path: 'order_id', target_field_path: 'orderId' }
    ];

    // Configure the mock DB calls:
    // When where() is called for the event, return a mock that resolves to our fake event
    mockWhere.mockImplementation((query) => {
      if (query.id) { // This is the query for the staged event
        return { first: mockFirst.mockResolvedValue(fakeStagedEvent) };
      }
      if (query.shop_id) { // This is the query for the mapping rules
        return Promise.resolve(fakeMappingRules);
      }
      return { first: jest.fn().mockResolvedValue(null) };
    });

    const fakeMessage = {
      content: Buffer.from(JSON.stringify({ staged_event_id: 123 }))
    };

    // 2. EXECUTION
    await processMessage(fakeMessage as any);

    // 3. ASSERTION
    expect(mockedDb).toHaveBeenCalledWith('staged_events');
    expect(mockWhere).toHaveBeenCalledWith({ id: 123 });
    
    expect(mockedDb).toHaveBeenCalledWith('data_mapping_rules');
    expect(mockWhere).toHaveBeenCalledWith({ shop_id: fakeStagedEvent.shop_id });

    expect(mockedTransformPayload).toHaveBeenCalledWith(
      fakeStagedEvent.raw_payload,
      fakeMappingRules
    );

    expect(mockedChannelWrapper.ack).toHaveBeenCalled();
  });
});