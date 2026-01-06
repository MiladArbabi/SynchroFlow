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

  it('deduplicates concurrent 401s into a single refresh call', async () => {
    const protectedUrl = '/api/v1/protected';
    const newAccessToken = 'new-access-token';

    currentToken = 'expired-token';

    // Each initial request fails once
    mock.onGet(protectedUrl).replyOnce(401);
    mock.onGet(protectedUrl).replyOnce(401);
    mock.onGet(protectedUrl).replyOnce(401);

    // Refresh succeeds once
    mock
      .onPost('/api/v1/auth/refresh_token')
      .replyOnce(200, { accessToken: newAccessToken });

    // Retries succeed
    mock.onGet(protectedUrl).reply(200, { ok: true });

    const results = await Promise.all([
      axiosInstance.get(protectedUrl),
      axiosInstance.get(protectedUrl),
      axiosInstance.get(protectedUrl),
    ]);

    expect(mock.history.post.length).toBe(1);

    results.forEach(r => {
      expect(r.data).toEqual({ ok: true });
    });
  });

  it('queues requests arriving during an in-flight refresh', async () => {
    const protectedUrl = '/api/v1/queued';
    const newAccessToken = 'queued-access-token';

    currentToken = 'expired-token';

    // First wave: 401
    mock.onGet(protectedUrl).replyOnce(401);

    // Refresh resolves
    mock
      .onPost('/api/v1/auth/refresh_token')
      .replyOnce(200, { accessToken: newAccessToken });

    // Retry succeeds
    mock.onGet(protectedUrl).reply(200, { ok: true });

    const first = axiosInstance.get(protectedUrl);

    // Second request while refresh is still pending
    const second = axiosInstance.get(protectedUrl);

    const results = await Promise.all([first, second]);

    // Still only ONE refresh
    expect(mock.history.post.length).toBe(1);

    results.forEach(r => {
      expect(r.data).toEqual({ ok: true });
    });
  });

  it('hard-stops and clears token if refresh fails once under concurrency', async () => {
    const protectedUrl = '/api/v1/fail-refresh';

    currentToken = 'expired-token';

    mock.onGet(protectedUrl).reply(401);

    // Refresh fails
    mock
      .onPost('/api/v1/auth/refresh_token')
      .replyOnce(401, { error: 'invalid refresh' });

    const requests = Promise.allSettled([
      axiosInstance.get(protectedUrl),
      axiosInstance.get(protectedUrl),
      axiosInstance.get(protectedUrl),
    ]);

    const results = await requests;

    // Refresh attempted only once
    expect(mock.history.post.length).toBe(1);

    // Token cleared exactly once
    expect(mockedClearToken).toHaveBeenCalledTimes(1);

    // All requests rejected
    results.forEach(r => {
      expect(r.status).toBe('rejected');
    });
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

  it('does NOT attach Authorization header to auth routes', async () => {
    currentToken = 'expired-token';

    mock
      .onPost('/api/v1/auth/login')
      .reply(401, { error: 'Invalid credentials' });

    try {
      await axiosInstance.post('/api/v1/auth/login', {
        email: 'test@test.com',
        password: 'password',
      });
    } catch {
      // expected
    }

    expect(mock.history.post.length).toBe(1);
    expect(mock.history.post[0].headers?.Authorization).toBeUndefined();
  });

  it('does NOT mutate axios default Authorization header during refresh', async () => {
    const protectedUrl = '/api/v1/protected';
    const newAccessToken = 'new-access-token';

    // Simulate expired token in store
    let currentToken: string | null = 'expired-token';

    (getToken as jest.Mock).mockImplementation(() => currentToken);
    (setToken as jest.Mock).mockImplementation((t) => {
      currentToken = t;
    });

    // First request fails
    mock.onGet(protectedUrl).replyOnce(401);

    // Refresh succeeds
    mock
      .onPost('/api/v1/auth/refresh_token')
      .replyOnce(200, { accessToken: newAccessToken });

    // Retried request succeeds
    mock.onGet(protectedUrl).replyOnce(200, { ok: true });

    await axiosInstance.get(protectedUrl);

    // 🔒 CRITICAL ASSERTION
    expect(
      axiosInstance.defaults.headers.common.Authorization
    ).toBeUndefined();
  });

});