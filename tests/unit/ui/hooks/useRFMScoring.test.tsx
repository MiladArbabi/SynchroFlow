// tests/unit/ui/hooks/useRFMScoring.test.tsx
import { renderHook } from '@testing-library/react';
import { useRFMScoring } from 'hooks/useRFMScoring';
import { CustomerApiResponse } from 'api-src/api/customers/customers.service';

// Mock customer data based on actual CustomerApiResponse structure
const mockCustomerData: CustomerApiResponse = {
  id: '123',
  profile: {
    name: 'John Doe',
    email: 'john@example.com',
    phone: '+1234567890',
    location: 'New York',
    joined_date: '2023-01-15T00:00:00.000Z',
    tags: ['vip', 'repeat-customer']
  },
  metrics: {
    total_revenue: 1250.50,
    total_orders: 5,
    aov: 250.10,
    ltv: 1500.60
  },
  orders: [
    {
      id: 'order1',
      orderDate: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
      status: 'fulfilled',
      total: 250.75
    },
    {
      id: 'order2',
      orderDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days ago
      status: 'fulfilled',
      total: 499.99
    },
    {
      id: 'order3',
      orderDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days ago
      status: 'fulfilled',
      total: 500.00
    }
  ],
  tickets: [],
  resolution: null
};

const mockCustomerNoOrders: CustomerApiResponse = {
  id: '456',
  profile: {
    name: 'Jane Smith',
    email: 'jane@example.com',
    phone: '+1234567891',
    location: 'Los Angeles',
    joined_date: '2024-01-01T00:00:00.000Z',
    tags: []
  },
  metrics: {
    total_revenue: 0,
    total_orders: 0,
    aov: 0,
    ltv: 0
  },
  orders: [],
  tickets: [],
  resolution: null
};

describe('useRFMScoring', () => {
  it('should calculate RFM scores for a customer with recent activity', () => {
    const { result } = renderHook(() => useRFMScoring(mockCustomerData));

    expect(result.current.rfmScores).toBeDefined();
    expect(result.current.rfmScores.recency).toBeGreaterThan(0);
    expect(result.current.rfmScores.frequency).toBeGreaterThan(0);
    expect(result.current.rfmScores.monetary).toBeGreaterThan(0);
    expect(result.current.rfmScores.composite).toBeGreaterThan(0);
  });

  it('should categorize customer into correct RFM segment', () => {
    const { result } = renderHook(() => useRFMScoring(mockCustomerData));

    expect(result.current.rfmSegment).toBeDefined();
    expect(['Champion', 'Loyal', 'Potential', 'New', 'At Risk', 'Cannot Lose']).toContain(result.current.rfmSegment);
  });

  it('should handle customer with no orders', () => {
    const { result } = renderHook(() => useRFMScoring(mockCustomerNoOrders));

    expect(result.current.rfmScores.recency).toBe(1);
    expect(result.current.rfmScores.frequency).toBe(1);
    expect(result.current.rfmScores.monetary).toBe(1);
    expect(result.current.rfmSegment).toBe('New');
  });

  it('should calculate correct recency score based on last order date', () => {
    const { result } = renderHook(() => useRFMScoring(mockCustomerData));

    // Recent order (7 days ago) should have high recency score (4-5)
    expect(result.current.rfmScores.recency).toBeGreaterThan(3);
  });

  it('should calculate correct frequency score based on order count', () => {
    const { result } = renderHook(() => useRFMScoring(mockCustomerData));

    // 3 orders should have good frequency score (3-4)
    expect(result.current.rfmScores.frequency).toBeGreaterThan(2);
  });

  it('should calculate correct monetary score based on total spend', () => {
    const { result } = renderHook(() => useRFMScoring(mockCustomerData));

    // $1250 total spend should have good monetary score (4-5)
    expect(result.current.rfmScores.monetary).toBeGreaterThan(3);
  });

  it('should provide actionable insights based on RFM segment', () => {
    const { result } = renderHook(() => useRFMScoring(mockCustomerData));

    expect(result.current.insights).toBeDefined();
    expect(Array.isArray(result.current.insights)).toBe(true);
    expect(result.current.insights[0]).toHaveProperty('type');
    expect(result.current.insights[0]).toHaveProperty('message');
    expect(result.current.insights[0]).toHaveProperty('priority');
  });

  it('should provide nudge recommendations based on RFM segment', () => {
    const { result } = renderHook(() => useRFMScoring(mockCustomerData));

    expect(result.current.nudgeRecommendations).toBeDefined();
    expect(Array.isArray(result.current.nudgeRecommendations)).toBe(true);
    expect(result.current.nudgeRecommendations[0]).toHaveProperty('type');
    expect(result.current.nudgeRecommendations[0]).toHaveProperty('message');
    expect(result.current.nudgeRecommendations[0]).toHaveProperty('segment');
  });

  it('should handle missing orders array gracefully', () => {
    const customerWithoutOrders = { ...mockCustomerData, orders: undefined };
    const { result } = renderHook(() => useRFMScoring(customerWithoutOrders as any));

    expect(result.current.rfmScores.frequency).toBe(1);
    expect(result.current.rfmSegment).toBe('New');
  });
});