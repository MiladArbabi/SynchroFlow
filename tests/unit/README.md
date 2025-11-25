Here's the updated comprehensive unit test guidelines incorporating the learnings from the successful test configuration:

```markdown
# Unit Testing Guidelines

## Overview
This document outlines the standards and patterns for writing unit tests in our project to ensure consistency and avoid common mocking pitfalls.

## File Structure & Naming

### Test File Location
```
tests/unit/
├── api/           # Backend API tests
├── ui/            # Frontend React component tests  
└── services/      # Business logic service tests
```

### Naming Convention
- Test files: `[ComponentName].test.tsx` (UI) or `[ServiceName].test.ts` (API)
- Test descriptions: `[Component/Service] - [Feature]`

## Mocking Standards

### Database Mocking Pattern (Knex.js)

**✅ CORRECT: Define mock inside factory to avoid hoisting issues**
```typescript
// 1. Mock the DB inside factory function
jest.mock('../../../packages/api/src/db', () => {
  const mockChain = {
    select: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
    // Include ALL methods used in service
  };
  return {
    __esModule: true,
    default: mockChain
  };
});

// 2. Create type-safe reference AFTER jest.mock
const mockDb = db as unknown as {
  select: jest.Mock;
  where: jest.Mock;
  first: jest.Mock;
  from: jest.Mock;
  orderBy: jest.Mock;
};

describe('Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore ALL chain methods
    mockDb.select.mockReturnValue(mockDb);
    mockDb.where.mockReturnValue(mockDb);
    mockDb.from.mockReturnValue(mockDb);
    mockDb.orderBy.mockReturnValue(mockDb);
  });
});
```

**❌ INCORRECT: Using external variable (causes hoisting ReferenceError)**
```typescript
const mockDb = { ... }; // Defined outside
jest.mock('path', () => mockDb); // ❌ ReferenceError: Cannot access before initialization
```

### Component Mocking Pattern

**✅ CORRECT: Mock at module level**
```typescript
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

// Mock icons
jest.mock('@mui/icons-material', () => ({
  Analytics: () => <div data-testid="AnalyticsIcon" />,
  // ... other icons
}));
```

## Test Structure Template

### Service Test Template (Updated)
```typescript
import { Service } from '../../../path/to/service';
import db from '../../../path/to/db';

// 1. Mock dependencies FIRST using factory pattern
jest.mock('../../../path/to/db', () => {
  const mockChain = {
    where: jest.fn().mockReturnThis(),
    first: jest.fn(),
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    orderBy: jest.fn().mockReturnThis(),
  };
  return {
    __esModule: true,
    default: mockChain
  };
});

// 2. Create type-safe reference
const mockDb = db as unknown as {
  where: jest.Mock;
  first: jest.Mock;
  select: jest.Mock;
  from: jest.Mock;
  orderBy: jest.Mock;
};

describe('ServiceName - Feature', () => {
  // 3. Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    // Restore ALL chain methods
    Object.keys(mockDb).forEach(key => {
      if (key !== 'first') mockDb[key].mockReturnValue(mockDb);
    });
  });

  describe('methodName', () => {
    test('should return data when successful', async () => {
      // 4. Arrange - Mock final promise resolution
      const mockData = [{ id: 1, name: 'Test' }];
      mockDb.orderBy.mockResolvedValue(mockData); // For lists
      // OR: mockDb.first.mockResolvedValue(mockData); // For single items

      // 5. Act
      const result = await Service.methodName(params);

      // 6. Assert
      expect(result).toEqual(expected);
      expect(mockDb.select).toHaveBeenCalledWith('*');
    });

    test('should handle errors properly', async () => {
      // Arrange
      mockDb.orderBy.mockRejectedValue(new Error('DB error'));

      // Act & Assert
      await expect(Service.methodName(params))
        .rejects.toThrow('Failed to fetch data');
    });
  });
});
```

### Component Test Template
```typescript
import React from 'react';
import { screen } from '@testing-library/react';
import renderWithProviders from '../../test-utils';
import Component from '../../path/to/component';

// Mock dependencies
jest.mock('../../path/to/child-component', () => ({
  __esModule: true,
  default: ({ children }) => <div data-testid="child">{children}</div>
}));

describe('ComponentName - Feature', () => {
  test('renders main elements', () => {
    renderWithProviders(<Component />);
    
    expect(screen.getByText('Expected Text')).toBeInTheDocument();
    expect(screen.getByTestId('child')).toBeInTheDocument();
  });

  test('handles user interactions', async () => {
    const mockHandler = jest.fn();
    renderWithProviders(<Component onClick={mockHandler} />);
    
    fireEvent.click(screen.getByRole('button'));
    expect(mockHandler).toHaveBeenCalledTimes(1);
  });
});
```

## Common Testing Patterns

### Knex.js Chain Mocking
```typescript
// For list queries
mockDb.orderBy.mockResolvedValue([{ id: 1 }, { id: 2 }]);

// For single item queries  
mockDb.first.mockResolvedValue({ id: 1, name: 'Test' });

// For not found scenarios
mockDb.first.mockResolvedValue(null);

// For database errors
mockDb.orderBy.mockRejectedValue(new Error('Connection timeout'));
```

### Async Service Methods with Graceful Degradation
```typescript
test('should degrade gracefully when external service fails', async () => {
  // Arrange
  mockDb.first.mockResolvedValue(mockData);
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
```

### Edge Case Coverage
```typescript
test('should handle division by zero gracefully', async () => {
  // Test AOV calculation with zero orders
  const zeroOrderCustomer = { total_orders: 0, total_spent: 0 };
  mockDb.first.mockResolvedValue(zeroOrderCustomer);

  const result = await service.calculateMetrics();
  expect(result.aov).toBe(0); // Not NaN or Infinity
});

test('should handle null/undefined fields', async () => {
  const customerWithNullTags = { tags: null };
  mockDb.first.mockResolvedValue(customerWithNullTags);

  const result = await service.processCustomer();
  expect(result.tags).toEqual([]); // Empty array, not null
});
```

### Error Scenarios
```typescript
test('should throw descriptive error on DB failure', async () => {
  // Arrange
  mockDb.first.mockRejectedValue(new Error('DB Critical Failure'));

  // Act & Assert
  await expect(service.method())
    .rejects.toThrow('Failed to fetch customer details'); // Service-specific message
});
```

### Component Props Testing
```typescript
test('renders different states based on props', () => {
  const { rerender } = renderWithProviders(<Component status="loading" />);
  expect(screen.getByTestId('spinner')).toBeInTheDocument();

  rerender(<Component status="success" />);
  expect(screen.getByText('Success!')).toBeInTheDocument();
});
```

## Mocking Checklist

Before writing tests, ensure you've mocked:

- [ ] Database connections (using factory pattern)
- [ ] External API calls  
- [ ] Child components
- [ ] UI libraries (Material-UI icons, etc.)
- [ ] Router dependencies
- [ ] Context providers

## Critical Success Patterns

### 1. Factory Pattern for Database Mocks
**Always define Knex.js mocks INSIDE the jest.mock factory** to avoid hoisting issues.

### 2. Complete Chain Restoration
**Restore ALL chain methods** in beforeEach to maintain Knex.js method chaining.

### 3. Type-Safe Mock References
**Create typed references** after jest.mock for better TypeScript support.

### 4. Comprehensive Error Testing
**Test both rejection and graceful degradation** scenarios.

### 5. Edge Case Coverage
**Include boundary conditions** like zero values, null fields, and empty results.

## Common Pitfalls & Solutions

### Pitfall 1: Hoisting ReferenceError
**Problem**: `ReferenceError: Cannot access before initialization`
**Solution**: Define mock implementation INSIDE jest.mock factory function

### Pitfall 2: Broken Method Chaining
**Problem**: `TypeError: Cannot read properties of undefined`
**Solution**: Restore ALL chain methods in beforeEach, not just commonly used ones

### Pitfall 3: Test Isolation Issues
**Problem**: Tests affecting each other due to shared state
**Solution**: Always clear mocks in `beforeEach` and avoid global test state

### Pitfall 4: Over-Mocking
**Problem**: Tests become brittle and hard to maintain
**Solution**: Only mock what's necessary, test behavior not implementation

### Pitfall 5: Incomplete Edge Cases
**Problem**: Tests pass but production fails on edge cases
**Solution**: Include tests for zero values, null fields, and error scenarios

## Best Practices

1. **Factory Pattern First**: Always define database mocks inside jest.mock factory
2. **Complete Chain Restoration**: Restore ALL Knex.js chain methods in beforeEach
3. **Type Safety**: Create typed references for better development experience
4. **Test Behavior, Not Implementation**: Focus on what users see/experience
5. **One Assertion Per Test**: Each test should verify one behavior
6. **Descriptive Test Names**: Use "should [expected behavior] when [condition]"
7. **Edge Case Coverage**: Include boundary conditions and error scenarios
8. **Graceful Degradation**: Test how services handle external failures

## Running Tests

```bash
# Run all tests
npm run test

# Run specific test file
npm test -- tests/unit/api/service.test.ts

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

## Example: Complete Service Tests

See these files for complete examples:
- `tests/unit/api/customers.service.test.ts` - Knex.js chain mocking with factory pattern
- `tests/unit/api/user-state.service.test.ts` - Database service testing
- `tests/unit/api/customer-resolution.service.test.ts` - External service integration

**Key Takeaway**: The factory pattern for database mocks is CRITICAL for avoiding hoisting issues and ensuring test reliability.
```

The key updates emphasize:
1. **Factory pattern for database mocks** to avoid hoisting issues
2. **Complete chain restoration** for Knex.js methods
3. **Type-safe mock references** 
4. **Comprehensive edge case coverage**
5. **Graceful degradation testing**
6. **Clear examples of successful patterns** from the working test files