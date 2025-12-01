import { CustomersService } from 'api-src/api/customers/customers.service';
import { CustomerResolutionService } from 'api-src/services/customer-resolution.service';
import db from 'api-src/db';

// ----------------------------------------------------------------------------
// MOCK SETUP
// ----------------------------------------------------------------------------

// 1. Mock the DB
// We define the mock implementation INSIDE the factory to avoid hoisting ReferenceErrors.
jest.mock('api-src/db', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
  };
  return {
    __esModule: true,
    default: mockChain
  };
});

// 2. Mock the Resolution Service
jest.mock('api-src/services/customer-resolution.service', () => ({
  __esModule: true,
  CustomerResolutionService: {
    findCustomersByEmail: jest.fn()
  }
}));

// 3. Create a type-safe reference to the mocked db for use in tests
const mockDb = db as unknown as {
  select: jest.Mock;
  where: jest.Mock;
  first: jest.Mock;
  from: jest.Mock;
  orderBy: jest.Mock;
};

// ----------------------------------------------------------------------------
// TEST SUITE
// ----------------------------------------------------------------------------

describe('CustomersService', () => {
  // Reset mocks before every test to ensure isolation
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Restore chainability (crucial for Knex mocks)
    mockDb.select.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.orderBy.mockReturnValue(mockDb);
  });

  // --------------------------------------------------------------------------
  // Method: getCustomerList
  // --------------------------------------------------------------------------
  describe('getCustomerList', () => {
    test('should return list of customers from database for a specific shop', async () => {
      // Arrange
      const mockCustomers = [
        { id: 1, email: 'a@test.com', shop_id: 1, created_at: new Date() },
        { id: 2, email: 'b@test.com', shop_id: 1, created_at: new Date() }
      ];
      mockDb.orderBy.mockResolvedValue(mockCustomers);

      // Act
      const result = await CustomersService.getCustomerList(1);

      // Assert
      expect(result).toEqual(mockCustomers);
      expect(mockDb.select).toHaveBeenCalledWith('*');
      expect(mockDb.from).toHaveBeenCalledWith('customers');
      expect(mockDb.where).toHaveBeenCalledWith({ shop_id: 1 });
      expect(mockDb.orderBy).toHaveBeenCalledWith('created_at', 'desc');
    });

    test('should return empty array when no customers found', async () => {
      // Arrange
      mockDb.orderBy.mockResolvedValue([]);

      // Act
      const result = await CustomersService.getCustomerList(999);

      // Assert
      expect(result).toEqual([]);
    });

    test('should throw descriptive error when database fails', async () => {
      // Arrange
      mockDb.orderBy.mockRejectedValue(new Error('Connection timeout'));

      // Act & Assert
      await expect(CustomersService.getCustomerList(1))
        .rejects
        .toThrow('Failed to fetch customers');
    });
  });

  // --------------------------------------------------------------------------
  // Method: getCustomerDetailsById
  // --------------------------------------------------------------------------
  describe('getCustomerDetailsById', () => {
    const baseCustomer = {
      id: 1,
      platform_customer_id: 'shp_1',
      email: 'john@example.com',
      first_name: 'John',
      last_name: 'Doe',
      phone: '+15555555',
      total_orders: 5,
      total_spent: 1000, // Implies AOV = 200
      state: 'active',
      created_at: new Date('2023-01-01'),
      tags: 'VIP, New'
    };

    test('should return full customer details with calculated metrics and identity resolution', async () => {
      // Arrange
      const mockResolution = {
        unified_customer_id: 'u_1',
        primary_email: 'john@example.com',
        confidence_score: 0.95
      };

      mockDb.first.mockResolvedValue(baseCustomer);
      (CustomerResolutionService.findCustomersByEmail as jest.Mock).mockResolvedValue(mockResolution);

      // Act
      const result = await CustomersService.getCustomerDetailsById(1, 1);

      // Assert
      expect(result).not.toBeNull();
      // Check Metrics
      expect(result?.metrics.aov).toBe(200.00); // 1000 / 5
      expect(result?.metrics.ltv).toBe(1200.00); // 1000 * 1.2
      // Check Profile
      expect(result?.profile.name).toBe('John Doe');
      expect(result?.profile.tags).toEqual(['VIP', 'New']);
      // Check Resolution
      expect(result?.resolution).toEqual(mockResolution);
      // Check DB calls
      expect(CustomerResolutionService.findCustomersByEmail).toHaveBeenCalledWith(1, 'john@example.com');
    });

    test('should return null if customer does not exist in DB', async () => {
      // Arrange
      mockDb.first.mockResolvedValue(null);

      // Act
      const result = await CustomersService.getCustomerDetailsById(999, 1);

      // Assert
      expect(result).toBeNull();
    });

    test('should handle Division by Zero (0 orders) gracefully', async () => {
      // Arrange
      const zeroOrderCustomer = { ...baseCustomer, total_orders: 0, total_spent: 0 };
      mockDb.first.mockResolvedValue(zeroOrderCustomer);

      // Act
      const result = await CustomersService.getCustomerDetailsById(1, 1);

      // Assert
      expect(result?.metrics.aov).toBe(0); // Should not be NaN or Infinity
      expect(result?.metrics.total_orders).toBe(0);
    });

    test('should handle null tags gracefully', async () => {
      // Arrange
      const noTagCustomer = { ...baseCustomer, tags: null };
      mockDb.first.mockResolvedValue(noTagCustomer);

      // Act
      const result = await CustomersService.getCustomerDetailsById(1, 1);

      // Assert
      expect(result?.profile.tags).toEqual([]); // Should be empty array, not null/crash
    });

    test('should degrade gracefully if Resolution Service fails (swallow error)', async () => {
      // Arrange
      mockDb.first.mockResolvedValue(baseCustomer);
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(); // Suppress console.warn
      
      // Simulate external service failure
      (CustomerResolutionService.findCustomersByEmail as jest.Mock)
        .mockRejectedValue(new Error('Service Unavailable'));

      // Act
      const result = await CustomersService.getCustomerDetailsById(1, 1);

      // Assert
      expect(result).toBeDefined();
      expect(result?.resolution).toBeUndefined(); // Field is missing but execution continued
      expect(result?.profile.email).toBe('john@example.com'); // Core data still exists
      
      consoleSpy.mockRestore();
    });

    test('should throw descriptive error if DB fetch fails', async () => {
      // Arrange
      mockDb.first.mockRejectedValue(new Error('DB Critical Failure'));

      // Act & Assert
      await expect(CustomersService.getCustomerDetailsById(1, 1))
        .rejects
        .toThrow('Failed to fetch customer details');
    });
  });

  // --------------------------------------------------------------------------
  // Method: getCustomerByEmail
  // --------------------------------------------------------------------------
  describe('getCustomerByEmail', () => {
    test('should return customer object when email matches', async () => {
      // Arrange
      const mockCustomer = { id: 10, email: 'target@test.com' };
      mockDb.first.mockResolvedValue(mockCustomer);

      // Act
      const result = await CustomersService.getCustomerByEmail(1, 'target@test.com');

      // Assert
      expect(result).toEqual(mockCustomer);
      expect(mockDb.where).toHaveBeenCalledWith({ shop_id: 1, email: 'target@test.com' });
    });

    test('should return null when no customer found', async () => {
      // Arrange
      mockDb.first.mockResolvedValue(undefined); // Knex returns undefined for empty .first()

      // Act
      const result = await CustomersService.getCustomerByEmail(1, 'missing@test.com');

      // Assert
      expect(result).toBeNull();
    });

    test('should throw descriptive error on DB failure', async () => {
      // Arrange
      mockDb.first.mockRejectedValue(new Error('DB Down'));

      // Act & Assert
      await expect(CustomersService.getCustomerByEmail(1, 'fail@test.com'))
        .rejects
        .toThrow('Failed to fetch customer by email');
    });
  });
});