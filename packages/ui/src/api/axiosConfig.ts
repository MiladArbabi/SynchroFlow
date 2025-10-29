// packages/ui/src/api/axiosConfig.ts
import axios from 'axios';
import { getToken } from 'utils/authStore'; // Use alias

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

// We'll add the response interceptor (for token refresh) in the next issue
export { axiosInstance };