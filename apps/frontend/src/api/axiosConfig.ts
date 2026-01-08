// apps/frontend/src/api/axiosConfig.ts

import axios from 'axios';
import { getToken, clearToken } from 'utils/authStore';

/**
 * AXIOS AUTH PHILOSOPHY (LOCKED)
 *
 * - Frontend does NOT refresh tokens
 * - Access JWT expiry is TERMINAL
 * - Any 401 (non-auth route) forces:
 *   - token destruction
 *   - full app reload
 *   - user re-login
 *
 * This guarantees:
 * - no refresh loops
 * - no poisoned login
 * - no partial UI state
 * - no identity corruption
 */

// ────────────────────────────────────────────────────────────────
// Axios instance (SINGLE source of truth)
// ────────────────────────────────────────────────────────────────
const axiosInstance = axios.create({
  // baseURL may be set here if needed
});

// ────────────────────────────────────────────────────────────────
// Auth routes must ALWAYS be clean-room
// ────────────────────────────────────────────────────────────────
const AUTH_ROUTES = [
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/logout',
];

function isAuthRoute(url?: string) {
  return !!url && AUTH_ROUTES.some(route => url.startsWith(route));
}

// ────────────────────────────────────────────────────────────────
// HARD LOGOUT (terminal, one-way)
// ────────────────────────────────────────────────────────────────
function hardLogout(reason: string) {
  console.warn('[AUTH] Hard logout triggered:', reason);

  // 1. Kill in-memory auth
  clearToken();

  // 2. Kill axios auth header (defensive)
  delete axiosInstance.defaults.headers.common.Authorization;

  // 3. Full reload to clean runtime
  //    (kills React state, queries, polling, interceptors, memory)
  window.location.href = '/login';
}

// ────────────────────────────────────────────────────────────────
// Request interceptor
// - inject Authorization ONLY for non-auth routes
// - never leak auth headers into login/register
// ────────────────────────────────────────────────────────────────
axiosInstance.interceptors.request.use(
  (config) => {
    if (isAuthRoute(config.url)) {
      delete config.headers?.Authorization;
      return config;
    }

    const token = getToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    } else {
      delete config.headers?.Authorization;
    }

    // Instrumentation (remove if noisy later)
    console.debug(
      '[HTTP →]',
      config.method?.toUpperCase(),
      config.url,
      'auth:',
      Boolean(token)
    );

    return config;
  },
  (error) => Promise.reject(error)
);
// ────────────────────────────────────────────────────────────────
// Response interceptor
// - ANY 401 (non-auth route) is TERMINAL
// - NO refresh
// - NO retry
// ────────────────────────────────────────────────────────────────
axiosInstance.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    const url = error?.config?.url;

    console.warn('[HTTP ← ERROR]', status, url);

    if (status === 401 && !isAuthRoute(url)) {
      hardLogout('401 Unauthorized (JWT expired or invalid)');
      return Promise.reject(error);
    }

    return Promise.reject(error);
  }
);

export { axiosInstance };