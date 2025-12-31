/* eslint-disable @typescript-eslint/no-explicit-any */
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

// --- Response Interceptor ---
// This function runs *after* a response is received.

// Variable to prevent multiple refresh attempts simultaneously
let isRefreshing = false;
let failedQueue: Array<{ resolve: (value: any) => void; reject: (reason: any) => void }> = [];

const processQueue = (error: any, token: string | null = null) => {
  failedQueue.forEach(prom => {
    if (error) {
      prom.reject(error);
    } else {
      prom.resolve(token);
    }
  });
  failedQueue = [];
};

axiosInstance.interceptors.response.use(
  (response) => {
    // Any status code that lies within the range of 2xx causes this function to trigger
    return response;
  },
  async (error) => {
    const originalRequest = error.config;

    // Check for 401 and ensure it's not a retry or a failed refresh
    // Add exclusion for login/register routes ---
    const isAuthRoute =
      originalRequest.url === '/api/v1/auth/login' ||
      originalRequest.url === '/api/v1/auth/register' ||
      originalRequest.url === '/api/v1/auth/refresh_token';

      if (
      error.response?.status === 401 &&
      !originalRequest._retry &&
      !isAuthRoute // <-- Do not attempt to refresh token on auth routes
      ) {

      if (isRefreshing) {
        // If already refreshing, wait for the new token
        return new Promise((resolve, reject) => {
          failedQueue.push({ resolve, reject });
        }).then(token => {
          originalRequest.headers.Authorization = 'Bearer ' + token;
          return axiosInstance(originalRequest);
        });
      }

      originalRequest._retry = true; // Mark as retried
      isRefreshing = true;

      try {
        // Call the refresh token endpoint
        const { data } = await axios.post('/api/v1/auth/refresh_token');
        const newAccessToken = data.accessToken;

        setToken(newAccessToken); // Update in-memory store
        axiosInstance.defaults.headers.common.Authorization = `Bearer ${newAccessToken}`; // Update default header
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`; // Update current request
        
        processQueue(null, newAccessToken); // Resume queued requests
        isRefreshing = false;
        return axiosInstance(originalRequest); // Retry original request

      } catch (refreshError: any) {
        processQueue(refreshError, null); // Reject queued requests
        isRefreshing = false;
        
        clearToken(); // Logout: Clear token
        // Optional: Redirect to login
        // window.location.href = '/login';

        return Promise.reject(refreshError);
      }
    }

    // For any other errors, just reject
    return Promise.reject(error);
  }
);
export { axiosInstance };