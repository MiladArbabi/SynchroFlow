//tests/unit/ui/components/OpsCommandCenter/naturalLanguage/intentParser.test.tsx
import { Intent } from 'components/OpsCommandCenter/naturalLanguage/types';
// This import will fail
import { parseIntent } from 'components/OpsCommandCenter/naturalLanguage/intentParser';

// We mock our dependencies: trainingData and the entityExtractor
jest.mock(
  'components/OpsCommandCenter/naturalLanguage/trainingData',
  () => ({
    TRAINING_DATA: {
      'find-orders': {
        phrases: ['show orders', 'find orders'],
        entities: ['status', 'date'],
      },
      'customer-lookup': {
        phrases: ['find customer', 'look up user'],
        entities: ['customerName', 'email'],
      },
    },
  }),
);

jest.mock(
  'components/OpsCommandCenter/naturalLanguage/entityExtractor',
  () => ({
    extractEntities: jest.fn(() => ({ status: 'pending' })),
  }),
);

// Get a typed mock of the mocked extractor
const { extractEntities } = jest.requireMock(
  'components/OpsCommandCenter/naturalLanguage/entityExtractor',
);

describe('Kore NLP Intent Parser', () => {
  beforeEach(() => {
    extractEntities.mockClear();
  });

  it('should correctly parse a matching intent', () => {
    const query = 'show orders from yesterday';
    const intent: Intent = parseIntent(query, null);

    expect(intent).toBeDefined();
    expect(intent.name).toBe('find-orders');
    expect(intent.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('should call entityExtractor with the correct entities for the intent', () => {
    const query = 'show orders from yesterday';
    parseIntent(query, null);

    // It should have called extractEntities with the 'find-orders' entity list
    expect(extractEntities).toHaveBeenCalledWith(query, ['status', 'date']);
    
    // Check that the entities from the extractor are in the final intent
    const intent: Intent = parseIntent(query, null);
    expect(intent.entities).toEqual({ status: 'pending' });
  });

  it('should return a "search" intent as a fallback', () => {
    const query = 'a query with no matching intent';
    const intent: Intent = parseIntent(query, null);

    expect(intent.name).toBe('search');
    expect(intent.confidence).toBeLessThan(0.4);
    expect(intent.entities.query).toBe(query);
  });

  it('should handle an exact phrase match with high confidence', () => {
    const query = 'find customer'; // An exact match
    const intent: Intent = parseIntent(query, null);

    expect(intent.name).toBe('customer-lookup');
    expect(intent.confidence).toBe(1.0);
  });

  it('should return a "reset" intent for reset keywords', () => {
    const resetQueries = ['reset', 'clear', 'start over', 'new search'];

    for (const query of resetQueries) {
      const intent: Intent = parseIntent(query, {
        topic: 'find-orders',
        entities: {},
        timestamp: 0,
      });
      expect(intent.name).toBe('reset');
      expect(intent.confidence).toBe(1.0);
    }
  });
});