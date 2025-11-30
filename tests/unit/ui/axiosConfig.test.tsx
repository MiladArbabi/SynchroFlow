// tests/unit/ui/axiosConfig.test.tsx
import { axiosInstance } from '../../../apps/frontend/src/api/axiosConfig';
import { getToken } from '../../../apps/frontend/src/utils/authStore'; 

// Mock the in-memory store module
jest.mock('utils/authStore', () => ({
  getToken: jest.fn(),
}));

const mockedGetToken = getToken as jest.Mock;

describe('Axios Request Interceptor', () => {

  beforeEach(() => {
    mockedGetToken.mockClear();
  });

  it('should add Authorization header if token exists', async () => {
    const mockToken = 'test-token-123';
    mockedGetToken.mockReturnValue(mockToken);

    // Get the interceptor function
    // @ts-expect-error - Accessing private interceptor manager
    const interceptor = axiosInstance.interceptors.request.handlers[0].fulfilled;
    
    const config = { headers: {} };
    const newConfig = interceptor(config);
    
    expect(newConfig.headers.Authorization).toBe(`Bearer ${mockToken}`);
    expect(mockedGetToken).toHaveBeenCalledTimes(1);
  });

  it('should NOT add Authorization header if no token exists', async () => {
    mockedGetToken.mockReturnValue(null); // No token
    
    // @ts-expect-error - Accessing private interceptor manager
    const interceptor = axiosInstance.interceptors.request.handlers[0].fulfilled;

    const config = { headers: {} };
    const newConfig = interceptor(config);

    expect(newConfig.headers.Authorization).toBeUndefined();
    expect(mockedGetToken).toHaveBeenCalledTimes(1);
  });
});