//tests/unit/ui/components/OpsCommandCenter/naturalLanguage/intentParser.test.tsx
import { Intent, KoreConversation } from 'components/OpsCommandCenter/naturalLanguage/types';
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
   extractEntities: jest.fn(),
  }),
);

// Get a typed mock of the mocked extractor
const { extractEntities: mockExtractEntities } = jest.requireMock(
  'components/OpsCommandCenter/naturalLanguage/entityExtractor',
);

describe('Kore NLP Intent Parser', () => {
  beforeEach(() => {
    mockExtractEntities.mockClear();
  });

  it('should correctly parse a matching intent', () => {
    // Make the mock return what we expect for this query
    mockExtractEntities.mockReturnValue({ date: 'yesterday' });
    const query = 'show orders from yesterday';
    const intent: Intent = parseIntent(query, null);

    expect(intent).toBeDefined();
    expect(intent.name).toBe('find-orders');
    expect(intent.confidence).toBeGreaterThanOrEqual(0.5);
  });

  it('should call entityExtractor with the correct entities for the intent', () => {
    mockExtractEntities.mockReturnValue({ status: 'pending' });
    const query = 'show orders from yesterday';
    parseIntent(query, null);

    // It should have called extractEntities with the 'find-orders' entity list
    expect(mockExtractEntities).toHaveBeenCalledWith(query, ['status', 'date']);
    
    // Check that the entities from the extractor are in the final intent
    const intent: Intent = parseIntent(query, null);
    expect(intent.entities).toEqual({ status: 'pending' });
  });

  it('should return a "search" intent as a fallback', () => {
    mockExtractEntities.mockReturnValue({});
    const query = 'a query with no matching intent';
    const intent: Intent = parseIntent(query, null);

    expect(intent.name).toBe('search');
    expect(intent.confidence).toBeLessThan(0.4);
    expect(intent.entities.query).toBe(query);
  });

  it('should handle an exact phrase match with high confidence', () => {
    mockExtractEntities.mockReturnValue({});
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

describe('Kore NLP Intent Parser: Follow-ups', () => {
  const previousConversation: KoreConversation = {
    topic: 'find-orders',
    entities: { customerName: 'John Doe' },
    timestamp: Date.now(),
  };

  it('should merge new entities with the previous conversation topic', () => {
    mockExtractEntities.mockReturnValue({ status: 'pending' });
    const query = 'show me all pending ones'; // "pending" is a new entity
    const intent: Intent = parseIntent(query, previousConversation);

    // It should keep the *old* topic
    expect(intent.name).toBe('find-orders');
    // It should be highly confident
    expect(intent.confidence).toBeGreaterThan(0.8);
    // It should *merge* entities
    expect(intent.entities).toEqual({
      customerName: 'John Doe',
      status: 'pending',
    });
  });

  it('should override existing entities with new ones', () => {
    mockExtractEntities.mockReturnValue({ customerName: 'Jane Smith' });
    const query = 'what about for customer Jane Smith'; // "Jane Smith" overrides "John Doe"
    const intent: Intent = parseIntent(query, previousConversation);

    expect(intent.name).toBe('find-orders');
    expect(intent.entities).toEqual({ customerName: 'Jane Smith' });
  });

  it('should ignore conversation and start a new intent if confidence is high', () => {
    mockExtractEntities.mockReturnValue({}); // No entities
    const query = 'find customer'; // This is a new, high-confidence intent
    const intent: Intent = parseIntent(query, previousConversation);

    expect(intent.name).toBe('customer-lookup');
    expect(intent.confidence).toBe(1.0);
  });
});