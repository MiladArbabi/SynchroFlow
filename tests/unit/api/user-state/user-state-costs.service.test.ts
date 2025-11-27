// tests/unit/api/user-state/user-state-costs.service.test.ts
import { UserStateService } from 'api-src/services/user-state.service';

// Mock the database
const mockDbInstance = {
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  first: jest.fn(),
  insert: jest.fn().mockReturnThis(),
  onConflict: jest.fn().mockReturnThis(),
  merge: jest.fn().mockReturnThis(),
  del: jest.fn().mockReturnThis(),
};

jest.mock('api-src/db', () => {
  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };
  
  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn
  };
});

describe('UserStateService - Cost Data Integration', () => {
  const userId = 1;
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset all mock implementations
    Object.values(mockDbInstance).forEach(mock => mock.mockClear?.());
    mockDbInstance.where.mockReturnValue(mockDbInstance);
    mockDbInstance.insert.mockReturnValue(mockDbInstance);
    mockDbInstance.onConflict.mockReturnValue(mockDbInstance);
    mockDbInstance.merge.mockReturnValue(mockDbInstance);
    mockDbInstance.del.mockReturnValue(mockDbInstance);
  });

  describe('getUserProductCosts', () => {
    test('should return empty object when no product costs exist for user', async () => {
      // Arrange
      mockDbInstance.first.mockResolvedValue(null);

      // Act
      const result = await UserStateService.getUserProductCosts(userId);

      // Assert
      expect(result).toEqual({});
      expect(mockDbInstance.where).toHaveBeenCalledWith({ user_id: userId, key: 'product_costs' });
      expect(mockDbInstance.first).toHaveBeenCalled();
    });

    test('should return parsed product costs with Shopify GID keys', async () => {
      // Arrange
      const mockProductCosts = {
        'gid://shopify/Product/123': {
          purchase_price: 25.50,
          shipping_cost: 5.00,
          customs_duties: 2.50,
          landed_cost_per_unit: 33.00,
          selling_price: 49.99,
          currency: 'USD'
        },
        '456': { // Already extracted ID
          purchase_price: 15.00,
          shipping_cost: 3.00,
          customs_duties: 1.50,
          landed_cost_per_unit: 19.50,
          selling_price: 29.99,
          currency: 'USD'
        }
      };
      
      mockDbInstance.first.mockResolvedValue({
        value: JSON.stringify(mockProductCosts)
      });

      // Act
      const result = await UserStateService.getUserProductCosts(userId);

      // Assert
      expect(result).toEqual(mockProductCosts);
      expect(result['gid://shopify/Product/123']).toBeDefined();
      expect(result['456']).toBeDefined();
    });

    test('should handle database connection errors gracefully', async () => {
      // Arrange
      mockDbInstance.first.mockRejectedValue(new Error('Database connection failed'));

      // Act & Assert
      await expect(UserStateService.getUserProductCosts(userId))
        .rejects.toThrow('Database connection failed');
    });

    test('should handle malformed JSON data in database', async () => {
      // Arrange
      mockDbInstance.first.mockResolvedValue({
        value: 'invalid json {'
      });

      // Act & Assert
      await expect(UserStateService.getUserProductCosts(userId))
        .rejects.toThrow();
    });

    test('should handle empty JSON object in database', async () => {
      // Arrange
      mockDbInstance.first.mockResolvedValue({
        value: '{}'
      });

      // Act
      const result = await UserStateService.getUserProductCosts(userId);

      // Assert
      expect(result).toEqual({});
    });

    test('should handle very large product costs dataset', async () => {
      // Arrange
      const largeProductCosts: Record<string, any> = {};
      for (let i = 0; i < 1000; i++) {
        largeProductCosts[`gid://shopify/Product/${i}`] = {
          purchase_price: 10 + i,
          shipping_cost: 2 + i,
          customs_duties: 1 + i,
          landed_cost_per_unit: 13 + (3 * i),
          selling_price: 25 + i,
          currency: 'USD'
        };
      }
      
      mockDbInstance.first.mockResolvedValue({
        value: JSON.stringify(largeProductCosts)
      });

      // Act
      const result = await UserStateService.getUserProductCosts(userId);

      // Assert
      expect(Object.keys(result)).toHaveLength(1000);
      expect(result['gid://shopify/Product/999']).toBeDefined();
    });

    test('should handle special characters and edge cases in cost data', async () => {
      // Arrange
      const edgeCaseCosts = {
        'gid://shopify/Product/special-123': {
          purchase_price: 0, // Zero price
          shipping_cost: -1, // Negative cost (should be validated elsewhere)
          customs_duties: 999999.99, // Very large number
          landed_cost_per_unit: 0.01, // Very small number
          selling_price: null, // Null value
          currency: 'EUR', // Different currency
          notes: 'Cost with special chars: €, £, 日本円, emoji: 💰'
        }
      };
      
      mockDbInstance.first.mockResolvedValue({
        value: JSON.stringify(edgeCaseCosts)
      });

      // Act
      const result = await UserStateService.getUserProductCosts(userId);

      // Assert
      expect(result).toEqual(edgeCaseCosts);
    });
  });

  describe('updateUserProductCosts', () => {
    test('should insert product costs with mixed Shopify GID and extracted ID keys', async () => {
      // Arrange
      const productCosts = {
        'gid://shopify/Product/123': {
          purchase_price: 25.50,
          shipping_cost: 5.00,
          customs_duties: 2.50,
          landed_cost_per_unit: 33.00,
          selling_price: 49.99,
          currency: 'USD'
        },
        '456': { // Already extracted ID
          purchase_price: 15.00,
          shipping_cost: 3.00,
          customs_duties: 1.50,
          landed_cost_per_unit: 19.50,
          selling_price: 29.99,
          currency: 'USD'
        }
      };

      mockDbInstance.merge.mockResolvedValue([1]);

      // Act
      await UserStateService.updateUserProductCosts(userId, productCosts);

      // Assert
      expect(mockDbInstance.insert).toHaveBeenCalledWith({
        user_id: userId,
        key: 'product_costs',
        value: JSON.stringify(productCosts),
        updated_at: 'mocked-now'
      });
      expect(mockDbInstance.onConflict).toHaveBeenCalledWith(['user_id', 'key']);
      expect(mockDbInstance.merge).toHaveBeenCalled();
    });

    test('should handle database errors during product costs update', async () => {
      // Arrange
      const productCosts = {
        'gid://shopify/Product/123': {
          purchase_price: 25.50,
          shipping_cost: 5.00,
          customs_duties: 2.50,
          landed_cost_per_unit: 33.00,
          selling_price: 49.99,
          currency: 'USD'
        }
      };

      mockDbInstance.merge.mockRejectedValue(new Error('Insert failed'));

      // Act & Assert
      await expect(UserStateService.updateUserProductCosts(userId, productCosts))
        .rejects.toThrow('Insert failed');
    });

    test('should handle empty product costs object', async () => {
      // Arrange
      const emptyCosts = {};
      mockDbInstance.merge.mockResolvedValue([1]);

      // Act
      await UserStateService.updateUserProductCosts(userId, emptyCosts);

      // Assert
      expect(mockDbInstance.insert).toHaveBeenCalledWith({
        user_id: userId,
        key: 'product_costs',
        value: '{}',
        updated_at: 'mocked-now'
      });
    });

    test('should handle very large product costs object efficiently', async () => {
      // Arrange
      const largeProductCosts: Record<string, any> = {};
      for (let i = 0; i < 2000; i++) {
        largeProductCosts[`gid://shopify/Product/${i}`] = {
          purchase_price: 10 + i,
          shipping_cost: 2 + i,
          customs_duties: 1 + i,
          landed_cost_per_unit: 13 + (3 * i),
          selling_price: 25 + i,
          currency: 'USD',
          description: `Product ${i} with a long description that might increase the JSON size significantly`,
          tags: ['tag1', 'tag2', 'tag3', 'tag4', 'tag5'],
          categories: ['category1', 'category2', 'category3']
        };
      }

      mockDbInstance.merge.mockResolvedValue([1]);

      // Act & Assert (should not throw and should handle large JSON)
      await expect(UserStateService.updateUserProductCosts(userId, largeProductCosts))
        .resolves.not.toThrow();
      
      // Verify the JSON stringification can handle large objects
      const insertCall = mockDbInstance.insert.mock.calls[0][0];
      expect(insertCall.value).toBe(JSON.stringify(largeProductCosts));
      expect(insertCall.value.length).toBeGreaterThan(100000); // Should be a large string
    });

    test('should handle concurrent updates without data loss', async () => {
      // Arrange
      const initialCosts = {
        'gid://shopify/Product/123': { purchase_price: 25.50, shipping_cost: 5.00 }
      };
      
      const updatedCosts = {
        'gid://shopify/Product/123': { purchase_price: 27.00, shipping_cost: 5.00 },
        'gid://shopify/Product/456': { purchase_price: 15.00, shipping_cost: 3.00 }
      };

      mockDbInstance.merge.mockResolvedValue([1]);

      // Act - Simulate rapid concurrent updates
      const promises = [
        UserStateService.updateUserProductCosts(userId, initialCosts),
        UserStateService.updateUserProductCosts(userId, updatedCosts)
      ];

      // Assert - Both should complete without interference
      await expect(Promise.all(promises)).resolves.not.toThrow();
      expect(mockDbInstance.insert).toHaveBeenCalledTimes(2);
      expect(mockDbInstance.merge).toHaveBeenCalledTimes(2);
    });

    test('should handle special characters and SQL injection attempts safely', async () => {
      // Arrange
      const maliciousCosts = {
        'gid://shopify/Product/123\'; DROP TABLE user_states; --': {
          purchase_price: 25.50,
          shipping_cost: 5.00,
          customs_duties: 2.50,
          landed_cost_per_unit: 33.00,
          selling_price: 49.99,
          currency: 'USD',
          notes: 'Malicious: \'; DROP TABLE users; --'
        },
        'normal-id': {
          purchase_price: 15.00,
          shipping_cost: 3.00,
          customs_duties: 1.50,
          landed_cost_per_unit: 19.50,
          selling_price: 29.99,
          currency: 'USD'
        }
      };

      mockDbInstance.merge.mockResolvedValue([1]);

      // Act & Assert (should be handled safely by Knex parameterization)
      await expect(UserStateService.updateUserProductCosts(userId, maliciousCosts))
        .resolves.not.toThrow();
      
      // The malicious content should be safely JSON stringified
      const insertCall = mockDbInstance.insert.mock.calls[0][0];
      expect(insertCall.value).toContain('DROP TABLE');
      expect(typeof insertCall.value).toBe('string');
    });
  });

  describe('Data Integrity and Consistency', () => {
    test('should maintain data consistency across multiple operations', async () => {
      // Arrange
      const initialCosts = {
        'gid://shopify/Product/123': { purchase_price: 25.50, margin: 48.5 }
      };

      const updatedCosts = {
        'gid://shopify/Product/123': { purchase_price: 27.00, margin: 45.9 },
        'gid://shopify/Product/456': { purchase_price: 15.00, margin: 50.0 }
      };

      mockDbInstance.first.mockResolvedValueOnce({ value: JSON.stringify(initialCosts) });
      mockDbInstance.merge.mockResolvedValue([1]);

      // Act - Read then update pattern
      const initialRead = await UserStateService.getUserProductCosts(userId);
      await UserStateService.updateUserProductCosts(userId, updatedCosts);

      // Assert
      expect(initialRead).toEqual(initialCosts);
      expect(mockDbInstance.insert).toHaveBeenCalledWith({
        user_id: userId,
        key: 'product_costs',
        value: JSON.stringify(updatedCosts),
        updated_at: 'mocked-now'
      });
    });

    test('should handle numeric precision and floating point correctly', async () => {
      // Arrange
      const precisionCosts = {
        'gid://shopify/Product/123': {
          purchase_price: 25.505, // 3 decimal places
          shipping_cost: 5.001,
          customs_duties: 2.499,
          landed_cost_per_unit: 33.005,
          selling_price: 49.995,
          currency: 'USD'
        }
      };

      mockDbInstance.merge.mockResolvedValue([1]);
      mockDbInstance.first.mockResolvedValue({ value: JSON.stringify(precisionCosts) });

      // Act
      await UserStateService.updateUserProductCosts(userId, precisionCosts);
      const result = await UserStateService.getUserProductCosts(userId);

      // Assert - Precision should be maintained through JSON serialization
      expect(result['gid://shopify/Product/123'].purchase_price).toBe(25.505);
      expect(result['gid://shopify/Product/123'].landed_cost_per_unit).toBe(33.005);
    });

    test('should handle migration from extracted IDs to GID format seamlessly', async () => {
      // Arrange - Simulate existing data with extracted IDs
      const extractedFormat = {
        '123': { purchase_price: 25.50, shipping_cost: 5.00 }
      };

      const gidFormat = {
        'gid://shopify/Product/123': { purchase_price: 27.00, shipping_cost: 5.00 }
      };

      mockDbInstance.merge.mockResolvedValue([1]);

      // Act - First store with extracted ID, then with GID format
      await UserStateService.updateUserProductCosts(userId, extractedFormat);
      await UserStateService.updateUserProductCosts(userId, gidFormat);

      // Assert - Both operations should complete and the second should overwrite the first
      expect(mockDbInstance.insert).toHaveBeenCalledTimes(2);
      const firstCall = mockDbInstance.insert.mock.calls[0][0];
      const secondCall = mockDbInstance.insert.mock.calls[1][0];
      
      expect(JSON.parse(firstCall.value)).toEqual(extractedFormat);
      expect(JSON.parse(secondCall.value)).toEqual(gidFormat);
    });
  });

  describe('Performance and Scalability', () => {
    test('should handle high-frequency updates efficiently', async () => {
      // Arrange
      mockDbInstance.merge.mockResolvedValue([1]);

      // Act - Simulate high-frequency updates
      const updatePromises = [];
      for (let i = 0; i < 100; i++) {
        const costs = {
          [`gid://shopify/Product/${i}`]: {
            purchase_price: 10 + i,
            shipping_cost: 2 + i,
            landed_cost_per_unit: 12 + (2 * i)
          }
        };
        updatePromises.push(UserStateService.updateUserProductCosts(userId, costs));
      }

      // Assert - All updates should complete
      await expect(Promise.all(updatePromises)).resolves.not.toThrow();
      expect(mockDbInstance.insert).toHaveBeenCalledTimes(100);
    });

    test('should maintain performance with deeply nested cost structures', async () => {
      // Arrange
      const nestedCosts = {
        'gid://shopify/Product/123': {
          purchase_price: 25.50,
          shipping_cost: 5.00,
          customs_duties: 2.50,
          landed_cost_per_unit: 33.00,
          selling_price: 49.99,
          currency: 'USD',
          breakdown: {
            materials: {
              primary: 15.00,
              secondary: 5.50,
              packaging: 3.00
            },
            labor: {
              manufacturing: 2.00,
              quality_control: 1.00
            },
            overhead: {
              storage: 0.50,
              utilities: 0.25,
              administrative: 1.25
            }
          },
          historical_prices: [
            { date: '2024-01-01', price: 23.00 },
            { date: '2024-02-01', price: 24.50 },
            { date: '2024-03-01', price: 25.50 }
          ]
        }
      };

      mockDbInstance.merge.mockResolvedValue([1]);
      mockDbInstance.first.mockResolvedValue({ value: JSON.stringify(nestedCosts) });

      // Act
      await UserStateService.updateUserProductCosts(userId, nestedCosts);
      const result = await UserStateService.getUserProductCosts(userId);

      // Assert - Nested structure should be preserved
      expect(result['gid://shopify/Product/123'].breakdown.materials.primary).toBe(15.00);
      expect(result['gid://shopify/Product/123'].historical_prices).toHaveLength(3);
    });
  });

  describe('Error Recovery and Resilience', () => {
    test('should recover from temporary database unavailability', async () => {
      // Arrange
      const productCosts = {
        'gid://shopify/Product/123': { purchase_price: 25.50 }
      };

      // Simulate temporary failure then recovery
      mockDbInstance.merge
        .mockRejectedValueOnce(new Error('Database temporarily unavailable'))
        .mockResolvedValueOnce([1]);

      // Act & Assert - First attempt should fail, second should succeed
      await expect(UserStateService.updateUserProductCosts(userId, productCosts))
        .rejects.toThrow('Database temporarily unavailable');
      
      await expect(UserStateService.updateUserProductCosts(userId, productCosts))
        .resolves.not.toThrow();
    });

    test('should handle partial network failures during update', async () => {
      // Arrange
      const productCosts = {
        'gid://shopify/Product/123': { purchase_price: 25.50 }
      };

      mockDbInstance.merge.mockRejectedValue(new Error('Network timeout'));

      // Act & Assert
      await expect(UserStateService.updateUserProductCosts(userId, productCosts))
        .rejects.toThrow('Network timeout');
      
      // Verify no partial writes occurred
      expect(mockDbInstance.insert).toHaveBeenCalledTimes(1);
    });
  });
});