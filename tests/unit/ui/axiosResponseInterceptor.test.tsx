// tests/unit/ui/axiosResponseInterceptor.test.ts
import MockAdapter from 'axios-mock-adapter';
import { axiosInstance } from 'api/axiosConfig'; // Import our real instance
import { getToken, setToken, clearToken } from 'utils/authStore'; // Import our real store

// Mock the in-memory store module
jest.mock('utils/authStore', () => ({
  getToken: jest.fn(),
  setToken: jest.fn(),
  clearToken: jest.fn()
}));

const mockedGetToken = getToken as jest.Mock;
const mockedSetToken = setToken as jest.Mock;
const mockedClearToken = clearToken as jest.Mock;

// Simulate token storage behavior for tests
let currentToken: string | null = null;
mockedGetToken.mockImplementation(() => currentToken);
mockedSetToken.mockImplementation((token) => { currentToken = token; });
mockedClearToken.mockImplementation(() => { currentToken = null; });

describe('Axios Response Interceptor (Token Refresh)', () => {
  let mock: MockAdapter;

  beforeEach(() => {
    // Set up the mock adapter on our instance *before* each test
    mock = new MockAdapter(axiosInstance);
    mockedGetToken.mockClear();
    mockedSetToken.mockClear();
    mockedClearToken.mockClear();
  });

  afterEach(() => {
    // Restore the original adapter
    mock.restore();
  });

  it('should refresh token and retry original request on 401', async () => {
    const protectedUrl = '/api/v1/some-protected-data';
    const newAccessToken = 'new-fresh-access-token';

    // 1. Set up the store to return an "expired" token
    currentToken = 'expired-access-token';

    // 2. Mock the API call sequence
    // - First call to /protected-data fails with 401
    mock.onGet(protectedUrl).replyOnce(401, { error: 'Token expired' });
    // - The interceptor then calls /refresh_token, which succeeds
    mock.onPost('/api/v1/auth/refresh_token').reply(200, { accessToken: newAccessToken });
    // - The interceptor retries /protected-data, which now succeeds
    mock.onGet(protectedUrl).reply(200, { data: 'it worked!' });

    // 3. Make the initial (failing) request
    const response = await axiosInstance.get(protectedUrl);
    
    // 4. Assert the refresh endpoint was called
    expect(mock.history.post.length).toBe(1);
    expect(mock.history.post[0].url).toBe('/api/v1/auth/refresh_token');

    // 5. Assert the new token was saved to the store
    expect(mockedSetToken).toHaveBeenCalledWith(newAccessToken);

    // 6. Assert the original request was retried (total 2 GETs)
    expect(mock.history.get.length).toBe(2);
    // Assert the *second* request had the *new* token
    expect(mock.history.get[1].headers?.Authorization).toBe(`Bearer ${newAccessToken}`);

    // 7. Assert the final response is the successful one
    expect(response.data).toEqual({ data: 'it worked!' });
  });

  it('should logout user if refresh fails (e.g., 403)', async () => {
    const protectedUrl = '/api/v1/some-protected-data';

    // 1. Set up store
    currentToken = 'expired-access-token';

    // 2. Mock the API call sequence
    // - First call fails with 401
    mock.onGet(protectedUrl).replyOnce(401, { error: 'Token expired' });
    // - The /refresh_token call *also* fails
    mock.onPost('/api/v1/auth/refresh_token').reply(403, { error: 'Invalid refresh token' });

    // 3. Make the initial request (it should ultimately fail)
    try {
      await axiosInstance.get(protectedUrl);
    } catch (error: any) {
      // We expect this to throw
      expect(error.response.status).toBe(403);
    }

    // 4. Assert refresh was attempted
    expect(mock.history.post.length).toBe(1);

    // 5. Assert the store was CLEARED (logout)
    expect(mockedClearToken).toHaveBeenCalled();
  });
});