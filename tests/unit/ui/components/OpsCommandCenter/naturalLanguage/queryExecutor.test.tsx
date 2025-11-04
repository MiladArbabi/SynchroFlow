//tests/unit/ui/components/OpsCommandCenter/naturalLanguage/queryExecutor.test.tsx
import { Intent } from 'components/OpsCommandCenter/naturalLanguage/types';
// This import will fail
import { executeNaturalLanguage } from 'components/OpsCommandCenter/naturalLanguage/queryExecutor';
import { useNavigate } from 'react-router-dom';

// Mock react-router-dom
jest.mock('react-router-dom', () => ({
  useNavigate: jest.fn(),
}));
const mockNavigate = jest.fn();
(useNavigate as jest.Mock).mockReturnValue(mockNavigate);

describe('Kore NLP Query Executor', () => {
  beforeEach(() => {
    mockNavigate.mockClear();
  });

  it('should return null for an unhandled or "search" intent', () => {
    const searchIntent: Intent = {
      name: 'search',
      confidence: 0.1,
      entities: { query: 'hello' },
    };
    const action = executeNaturalLanguage(searchIntent);
    expect(action).toBeNull();
  });

  it('should create a dynamic "find-orders" action', async () => {
    const findIntent: Intent = {
      name: 'find-orders',
      confidence: 0.9,
      entities: {
        status: 'unfulfilled',
        date: 'yesterday',
      },
    };
    
    const action = executeNaturalLanguage(findIntent);

    // 1. Check that the action is created correctly
    expect(action).toBeDefined();
    expect(action).not.toBeNull();
    expect(action?.id).toBe('find-orders-nlp');
    expect(action?.name).toContain('Find orders');
    expect(action?.name).toContain('unfulfilled');
    expect(action?.name).toContain('yesterday');

    // 2. Check that the action's execute function works
    if (action) {
      await action.execute({} as any, mockNavigate);
      // It should call navigate with the correct query params
      expect(mockNavigate).toHaveBeenCalledWith('/orders?status=unfulfilled&date=yesterday');
    }
  });

  it('should create a dynamic "check-inventory" action', async () => {
    const inventoryIntent: Intent = {
      name: 'check-inventory',
      confidence: 0.8,
      entities: {
        product: 'My Product',
      },
    };

    const action = executeNaturalLanguage(inventoryIntent);

    expect(action).toBeDefined();
    expect(action?.id).toBe('check-inventory-nlp');
    expect(action?.name).toContain('Check inventory');
    expect(action?.name).toContain('My Product');

    if (action) {
      await action.execute({} as any, mockNavigate);
      expect(mockNavigate).toHaveBeenCalledWith('/inventory?product=My+Product');
    }
  });
});