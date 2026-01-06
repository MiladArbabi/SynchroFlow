/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/api/axiosConfig.ts
import axios from 'axios';
import { getToken, setToken, clearToken } from 'utils/authStore'; // Use alias

// Create a new Axios instance
const axiosInstance = axios.create({
  // You can set base URLs or other defaults here
  // baseURL: 'http://localhost:3000/api/v1' 
});

// 🔒 Auth routes MUST be clean-room (no Authorization header ever)
const AUTH_ROUTES = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/refresh_token',
  '/api/v1/auth/logout',
];

function isAuthRoute(url?: string) {
  return !!url && AUTH_ROUTES.some(r => url.startsWith(r));
}

// --- Request Interceptor ---
// This function runs *before* every request is sent.
axiosInstance.interceptors.request.use(
  (config) => {
    // Get the token from our in-memory store
    const token = getToken();
    
    // 🔒 NEVER attach Authorization to auth routes
    if (isAuthRoute(config.url)) {
      delete config.headers?.Authorization;
      return config;
    }

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
    const authRoute = isAuthRoute(originalRequest.url);

    if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !authRoute
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

              return newAccessToken;
            } catch (err: any) {
              /**
               * 🔒 REFRESH FAILURE IS ALWAYS TERMINAL IN BROWSER CONTEXT
               *
               * Reason:
               * - Prevent infinite refresh loops
               * - Prevent rate-limit cascades
               * - Prevent poisoned login
               * - Prevent identity corruption
               *
               * Backend may call it "transient",
               * but frontend cannot safely retry.
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