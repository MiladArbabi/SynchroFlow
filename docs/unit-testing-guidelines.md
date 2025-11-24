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

### Database Mocking Pattern

**✅ CORRECT: Use shared mock instance**
```typescript
const mockDbInstance = {
  where: jest.fn().mockReturnThis(),
  first: jest.fn(),
  orderBy: jest.fn(),
  // ... other methods
};

jest.mock('../../../packages/api/src/db', () => ({
  fn: { now: jest.fn() },
  __esModule: true,
  default: jest.fn(() => mockDbInstance)
}));

describe('Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Reset mock implementations
    Object.values(mockDbInstance).forEach(mock => mock.mockClear?.());
    mockDbInstance.where.mockReturnValue(mockDbInstance);
  });
});
```

**❌ INCORRECT: Inline complex mocking**
```typescript
// This creates fragile, hard-to-maintain mocks
jest.mock('../../../packages/api/src/db', () => ({
  default: jest.fn(() => ({
    where: jest.fn().mockReturnThis(),
    first: jest.fn().mockResolvedValue({}),
    // ... more complex inline logic
  }))
}));
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

### Service Test Template
```typescript
import { Service } from '../../../path/to/service';

// 1. Set up mocks at top level
const mockDbInstance = {
  where: jest.fn().mockReturnThis(),
  first: jest.fn(),
  // ... other methods
};

jest.mock('../../../packages/api/src/db', () => ({
  __esModule: true,
  default: jest.fn(() => mockDbInstance)
}));

describe('ServiceName - Feature', () => {
  // 2. Reset mocks before each test
  beforeEach(() => {
    jest.clearAllMocks();
    Object.values(mockDbInstance).forEach(mock => mock.mockClear?.());
    mockDbInstance.where.mockReturnValue(mockDbInstance);
  });

  // 3. Group related tests
  describe('methodName', () => {
    test('should do X when Y', async () => {
      // 4. Arrange
      mockDbInstance.first.mockResolvedValue(mockData);

      // 5. Act
      const result = await Service.methodName(params);

      // 6. Assert
      expect(result).toEqual(expected);
      expect(mockDbInstance.first).toHaveBeenCalledWith(expectedQuery);
    });

    test('should handle errors properly', async () => {
      // Arrange
      mockDbInstance.first.mockRejectedValue(new Error('DB error'));

      // Act & Assert
      await expect(Service.methodName(params))
        .rejects.toThrow('DB error');
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

### Async Service Methods
```typescript
test('handles async operations', async () => {
  // Arrange
  mockDbInstance.first.mockResolvedValue({ id: 1 });

  // Act
  const result = await service.asyncMethod();

  // Assert
  expect(result).toEqual(expected);
});
```

### Error Scenarios
```typescript
test('handles errors gracefully', async () => {
  // Arrange
  mockDbInstance.first.mockRejectedValue(new Error('DB unavailable'));

  // Act & Assert
  await expect(service.method())
    .rejects.toThrow('DB unavailable');
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

- [ ] Database connections
- [ ] External API calls
- [ ] Child components
- [ ] UI libraries (Material-UI icons, etc.)
- [ ] Router dependencies
- [ ] Context providers

## Common Pitfalls & Solutions

### Pitfall 1: Undefined Mock Methods
**Problem**: `TypeError: Cannot read properties of undefined`
**Solution**: Use shared mock instance pattern and ensure all methods are defined

### Pitfall 2: Test Isolation Issues
**Problem**: Tests affecting each other due to shared state
**Solution**: Always clear mocks in `beforeEach` and avoid global test state

### Pitfall 3: Over-Mocking
**Problem**: Tests become brittle and hard to maintain
**Solution**: Only mock what's necessary, test behavior not implementation

### Pitfall 4: Async Timing Issues
**Problem**: Tests pass/fail intermittently
**Solution**: Use proper async/await and `findBy*` queries for UI updates

## Best Practices

1. **Test Behavior, Not Implementation**: Focus on what users see/experience
2. **One Assertion Per Test**: Each test should verify one behavior
3. **Descriptive Test Names**: Use "should [expected behavior] when [condition]"
4. **Minimal Mocks**: Only mock external dependencies, not internal logic
5. **Clean Test Data**: Reset data between tests to prevent contamination
6. **Consistent Structure**: Follow the established patterns in this guide

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

## Example: Complete Service Test

See `tests/unit/api/user-state.service.test.ts` for a complete example following these guidelines.
