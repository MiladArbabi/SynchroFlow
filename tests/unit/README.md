# Unit Testing Guidelines

## 🎯 Quick Start: Avoid Common Pitfalls

### ⚡ IMMEDIATE SOLUTIONS FOR COMMON ERRORS

#### Problem 1: "Cannot access before initialization"

**Solution**: Always use factory pattern inside `jest.mock`

```typescript
// ✅ CORRECT: Define everything inside factory
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
  };
  
  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };
  
  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn
  };
});

// ❌ WRONG: Using external variables (causes hoisting)
const mockDb = jest.fn(); // Defined outside
jest.mock('api-src/db', () => ({ default: mockDb })); // ReferenceError!
Problem 2: "Cannot read properties of undefined (reading 'now')"
Solution: Mock db.fn.now() properly

typescript
// ✅ CORRECT: Mock db.fn.now()
const mockDb = jest.fn(() => mockDbInstance);
(mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };

// ❌ WRONG: Missing fn.now mock
jest.mock('api-src/db', () => ({ 
  default: jest.fn(() => mockDbInstance) 
  // Missing: fn: { now: jest.fn() }
}));
📁 File Structure & Naming
text
tests/unit/
├── api/              # Backend API tests
│   ├── services/     # Business logic service tests
│   ├── controllers/  # API endpoint tests
│   └── middleware/   # Express middleware tests
├── ui/               # Frontend React component tests
└── shared/           # Shared utilities tests
Naming Convention
Test files: [ComponentName].test.tsx (UI) or [ServiceName].test.ts (API)

Test descriptions: Use "should" pattern: should [expected behavior] when [condition]

🔧 Mocking Standards
Database Mocking Pattern (Knex.js)
Complete Database Mock Template
typescript
import { ServiceName } from 'api-src/services/service-name';

// ✅ PERFECT PATTERN: Everything defined inside factory
jest.mock('api-src/db', () => {
  // 1. Define chainable methods
  const mockDbInstance = {
    // Chainable methods (return this)
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    offset: jest.fn().mockReturnThis(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    onConflict: jest.fn().mockReturnThis(),
    merge: jest.fn().mockReturnThis(),
    del: jest.fn().mockReturnThis(),
    
    // Terminal methods (return data/void)
    first: jest.fn(),
    then: jest.fn(), // For promise chains
  };
  
  // 2. Create db function with fn property
  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { 
    now: jest.fn(() => 'mocked-now') 
  };
  
  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn
  };
});

describe('ServiceName - Feature', () => {
  const mockDbInstance = (require('api-src/db').default() as any);
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Restore ALL chain methods
    Object.keys(mockDbInstance).forEach(key => {
      if (typeof mockDbInstance[key] === 'function' && 
          !['first', 'then'].includes(key)) {
        mockDbInstance[key].mockReturnValue(mockDbInstance);
      }
    });
  });

  test('should work correctly', async () => {
    // Arrange
    mockDbInstance.first.mockResolvedValue({ id: 1, name: 'Test' });
    
    // Act
    const result = await ServiceName.method();
    
    // Assert
    expect(result).toEqual(expected);
  });
});
Component Mocking Pattern
typescript
// Mock external components
jest.mock('ui-component/MasterPanel', () => ({
  __esModule: true,
  default: ({ children, title }) => (
    <div data-testid="master-panel">
      <h1 data-testid="master-panel-title">{title}</h1>
      {children}
    </div>
  )
}));

// Mock Material-UI icons
jest.mock('@mui/icons-material', () => ({
  Analytics: () => <div data-testid="AnalyticsIcon" />,
  Close: () => <div data-testid="CloseIcon" />,
  Add: () => <div data-testid="AddIcon" />,
}));
🧪 Test Structure Templates
Service Test Template (Recommended)
typescript
import { ServiceName } from 'api-src/services/service-name';

// 1. Mock database FIRST (using factory pattern)
jest.mock('api-src/db', () => {
  const mockDbInstance = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    select: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
  };
  
  const mockDb = jest.fn(() => mockDbInstance);
  (mockDb as any).fn = { now: jest.fn(() => 'mocked-now') };
  
  return {
    __esModule: true,
    default: mockDb,
    fn: (mockDb as any).fn
  };
});

describe('ServiceName - FeatureName', () => {
  const mockDbInstance = (require('api-src/db').default() as any);
  
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore chain methods
    mockDbInstance.where.mockReturnValue(mockDbInstance);
    mockDbInstance.select.mockReturnValue(mockDbInstance);
    mockDbInstance.orderBy.mockReturnValue(mockDbInstance);
  });

  describe('methodName', () => {
    test('should return data when successful', async () => {
      // Arrange
      const mockData = { id: 1, name: 'Test' };
      mockDbInstance.first.mockResolvedValue(mockData);

      // Act
      const result = await ServiceName.methodName(params);

      // Assert
      expect(result).toEqual(expected);
      expect(mockDbInstance.where).toHaveBeenCalledWith(expectedCondition);
    });

    test('should handle errors properly', async () => {
      // Arrange
      mockDbInstance.first.mockRejectedValue(new Error('DB error'));

      // Act & Assert
      await expect(ServiceName.methodName(params))
        .rejects.toThrow('Failed to fetch data');
    });
  });
});
Component Test Template
typescript
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import renderWithProviders from '../test-utils';
import Component from '../../path/to/component';

// Mock dependencies
jest.mock('../../path/to/child-component', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="child">{children}</div>
}));

describe('ComponentName - Feature', () => {
  test('should render main elements correctly', () => {
    renderWithProviders(<Component />);
    
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  test('should handle user interactions', async () => {
    const mockHandler = jest.fn();
    renderWithProviders(<Component onClick={mockHandler} />);
    
    fireEvent.click(screen.getByRole('button'));
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });
});
🔄 Common Testing Patterns
Knex.js Query Patterns
typescript
// For list queries (multiple rows)
mockDbInstance.then.mockResolvedValue([{ id: 1 }, { id: 2 }]);

// For single item queries  
mockDbInstance.first.mockResolvedValue({ id: 1, name: 'Test' });

// For not found scenarios
mockDbInstance.first.mockResolvedValue(null);

// For database errors
mockDbInstance.first.mockRejectedValue(new Error('Connection timeout'));

// For insert/update operations
mockDbInstance.then.mockResolvedValue([1]); // Returns inserted ID
Async Service Methods
typescript
test('should degrade gracefully when external service fails', async () => {
  // Arrange
  mockDbInstance.first.mockResolvedValue(mockData);
  const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
  
  // Simulate external service failure
  (ExternalService.method as jest.Mock).mockRejectedValue(new Error('Service Unavailable'));

  // Act
  const result = await service.method();

  // Assert - Service continues despite external failure
  expect(result).toBeDefined();
  expect(result.externalData).toBeUndefined();
  
  consoleSpy.mockRestore();
});
Edge Case Coverage
typescript
test('should handle zero values gracefully', async () => {
  const zeroData = { total_orders: 0, total_spent: 0 };
  mockDbInstance.first.mockResolvedValue(zeroData);

  const result = await service.calculateMetrics();
  expect(result.aov).toBe(0); // Not NaN or Infinity
});

test('should handle null/undefined fields', async () => {
  const dataWithNull = { tags: null, category: undefined };
  mockDbInstance.first.mockResolvedValue(dataWithNull);

  const result = await service.processData();
  expect(result.tags).toEqual([]); // Empty array, not null
});
🚨 Troubleshooting Guide
Common Errors and Solutions
Error Cause Solution
ReferenceError: Cannot access before initialization Variable hoisting in jest.mock Define all mocks INSIDE jest.mock factory
TypeError: Cannot read properties of undefined (reading 'now') Missing db.fn.now() mock Add (mockDb as any).fn = { now: jest.fn() }
TypeError: Cannot read properties of undefined Broken method chaining Restore ALL chain methods in beforeEach
Tests affecting each other Shared mock state Use jest.clearAllMocks() in beforeEach
Mocking Checklist
Before writing tests, ensure you've mocked:

Database connections (using factory pattern)

db.fn.now() function

External API calls

Child components

UI libraries (Material-UI icons, etc.)

Router dependencies

Context providers

📋 Best Practices
1. Factory Pattern First
Always define database mocks inside jest.mock factory to avoid hoisting issues.

2. Complete Chain Restoration
Restore ALL Knex.js chain methods in beforeEach to maintain method chaining.

3. Mock db.fn.now()
Never forget to mock db.fn.now() for timestamp operations.

4. Test Behavior, Not Implementation
Focus on what users see/experience, not internal implementation details.

5. One Assertion Per Test
Each test should verify one specific behavior.

6. Descriptive Test Names
Use "should [expected behavior] when [condition]" pattern.

7. Edge Case Coverage
Include tests for boundary conditions and error scenarios.

🏃 Running Tests
bash
# Run all tests
npm run test

# Run specific test file
npm test -- tests/unit/api/service.test.ts

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch

# Run with verbose output
npm test -- --verbose
📚 Example Reference Files
Study these working examples:

tests/unit/api/user-state.service.test.ts - Basic service testing

tests/unit/api/customers.service.test.ts - Complex query testing

tests/unit/api/user-state/user-state-costs.service.test.ts - Complete pattern with db.fn.now()

tests/unit/ui/CostEntryModal.test.tsx - Component testing

🆘 Getting Help
If you're stuck:

Check this README first for common solutions

Look at existing test files for patterns

Ensure you're using the factory pattern for database mocks

Verify db.fn.now() is properly mocked

Check that all chain methods are restored in beforeEach

Remember: The factory pattern for database mocks is CRITICAL for avoiding hoisting issues and ensuring test reliability.
