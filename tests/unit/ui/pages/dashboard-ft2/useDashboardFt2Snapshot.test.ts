/**
 * @jest-environment jsdom
 */
import { renderHook } from '@testing-library/react';
import { useDashboardFt2Snapshot } from 'pages/dashboard-ft2/useDashboardFt2Snapshot';
import { axiosInstance } from 'api/axiosConfig';
import { useQuery } from '@tanstack/react-query';

jest.mock('api/axiosConfig', () => ({
  axiosInstance: {
    get: jest.fn(),
  },
}));

jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));

describe('useDashboardFt2Snapshot — contract', () => {
  it('wires a single FT2 dashboard snapshot query correctly', () => {
    (useQuery as jest.Mock).mockReturnValue({
      data: null,
      isLoading: false,
      isSuccess: true,
    });

    renderHook(() => useDashboardFt2Snapshot());

    expect(useQuery).toHaveBeenCalledTimes(1);

    const queryArg = (useQuery as jest.Mock).mock.calls[0][0];

    expect(queryArg.queryKey).toEqual(['dashboard', 'ft2']);
    expect(typeof queryArg.queryFn).toBe('function');
  });
});