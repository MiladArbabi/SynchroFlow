// apps/frontend/src/api/axiosConfig.ts
import axios from 'axios';
import { getToken, setToken, clearToken } from 'utils/authStore'; // Use alias

// Create a new Axios instance
const axiosInstance = axios.create({
  // You can set base URLs or other defaults here
  // baseURL: 'http://localhost:3000/api/v1' 
});

// --- Request Interceptor ---
// This function runs *before* every request is sent.
axiosInstance.interceptors.request.use(
  (config) => {
    // Get the token from our in-memory store
    const token = getToken();
    
    // If a token exists, add it to the Authorization header
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    // Handle request errors
    return Promise.reject(error);
  }
);

  /**
   * Single-flight refresh promise.
   *
   * Guarantees:
   * - Exactly ONE refresh request in flight at any time
   * - All concurrent 401s await the same promise
   * - Refresh failure is terminal (hard logout)
   */
  let refreshPromise: Promise<string> | null = null;

axiosInstance.interceptors.response.use(
  (response) => {
    // Any status code that lies within the range of 2xx causes this function to trigger
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    const isAuthRoute =
      originalRequest.url === '/api/v1/auth/login' ||
      originalRequest.url === '/api/v1/auth/register' ||
      originalRequest.url === '/api/v1/auth/refresh_token';

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthRoute
    ) {
      originalRequest._retry = true;

      try {
        if (!refreshPromise) {
          refreshPromise = (async () => {
            try {
              /**
               * IMPORTANT:
               * Use axiosInstance (not raw axios) so that:
               * - requests are mockable in tests
               * - headers / base config are consistent
               * - refresh behavior is observable & instrumentable
               */
              const { data } = await axiosInstance.post('/api/v1/auth/refresh_token');
              const newAccessToken = data.accessToken;

              setToken(newAccessToken);
              axiosInstance.defaults.headers.common.Authorization =
                `Bearer ${newAccessToken}`;

              return newAccessToken;
            } catch (err) {
              /**
               * HARD STOP:
               * Refresh failure is terminal.
               * We intentionally clear auth state exactly once.
               */
              clearToken();
              throw err;
            } finally {
              /**
               * Reset latch so a future session can refresh again.
               * Never cleared early.
               */
              refreshPromise = null;
            }
          })();
        }

        const token = await refreshPromise;
        originalRequest.headers.Authorization = `Bearer ${token}`;
        return axiosInstance(originalRequest);

      } catch (refreshError) {
        return Promise.reject(refreshError);
      }
    }

    return Promise.reject(error);
  }
);

export { axiosInstance };