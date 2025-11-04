//tests/unit/ui/components/OpsCommandCenter/naturalLanguage/entityExtractor.test.tsx
// This import will fail
import { extractEntities } from "components/OpsCommandCenter/naturalLanguage/entityExtractor";

// Define the entity types we expect to find (from trainingData.ts)
const allEntityTypes = [
  'status',
  'date',
  'customer',
  'product',
  'orderId',
  'amount',
  'reason',
  'threshold',
  'customerName',
  'email',
  'phone',
  'metrics',
];

describe('Kore NLP Entity Extractor', () => {
  it('should extract a single status', () => {
    const query = 'show me all unfulfilled orders';
    const entities = extractEntities(query, allEntityTypes);
    expect(entities.status).toBe('unfulfilled');
  });

  it('should extract a date keyword', () => {
    const query = 'orders from yesterday';
    const entities = extractEntities(query, allEntityTypes);
    expect(entities.date).toBe('yesterday');
  });

  it('should extract an order ID', () => {
    const query = 'refund order #123-ABC';
    const entities = extractEntities(query, allEntityTypes);
    expect(entities.orderId).toBe('123-ABC');
  });

  it('should extract a customer name', () => {
    const query = 'find customer John Doe';
    const entities = extractEntities(query, allEntityTypes);
    expect(entities.customerName).toBe('John Doe');
  });

  it('should extract an amount', () => {
    const query = 'refund $50.25';
    const entities = extractEntities(query, allEntityTypes);
    expect(entities.amount).toBe(50.25);
  });

  it('should extract multiple entities from one query', () => {
    const query = 'show me all unfulfilled orders from yesterday';
    const entities = extractEntities(query, allEntityTypes);
    expect(entities.status).toBe('unfulfilled');
    expect(entities.date).toBe('yesterday');
  });

  it('should return an empty object if no entities are found', () => {
    const query = 'show me a thing';
    const entities = extractEntities(query, allEntityTypes);
    expect(Object.keys(entities).length).toBe(0);
  });

  it('should extract the *first* match if multiple are present', () => {
    const query = 'show fulfilled and pending orders';
    const entities = extractEntities(query, allEntityTypes);
    expect(entities.status).toBe('fulfilled'); // 'fulfilled' comes first
  });
});