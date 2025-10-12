//packages/api/__tests__/transformer.test.ts
import { transformPayload } from '../src/transformer';

describe('Payload Transformer', () => {
  it('should transform a flat payload based on mapping rules', () => {
    // 1. Define the raw data from Shopify
    const rawPayload = {
      id: 12345,
      customer_email: 'test@example.com',
      total_price: '99.99',
    };

    // 2. Define the user's mapping rules
    const mappingRules = [
      { source_field_path: 'id', target_field_path: 'orderId' },
      { source_field_path: 'customer_email', target_field_path: 'customer.emailAddress' },
      { source_field_path: 'total_price', target_field_path: 'financials.total' },
    ];

    // 3. Define the expected output
    const expectedTransformedObject = {
      orderId: 12345,
      customer: {
        emailAddress: 'test@example.com',
      },
      financials: {
        total: '99.99',
      },
    };

    // 4. Execute the function and assert the result
    const result = transformPayload(rawPayload, mappingRules);
    expect(result).toEqual(expectedTransformedObject);
  });
});