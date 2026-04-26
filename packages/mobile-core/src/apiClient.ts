// packages/mobile-core/src/apiClient.ts
import axios from 'axios';

/**
 * MOBILE API CLIENT
 * -----------------
 * Typed axios instance for the laSyncro backend.
 * Shares the same API surface as the web frontend.
 *
 * Base URL is configured via EXPO_PUBLIC_API_URL env var.
 * Falls back to localhost for development.
 *
 * Auth token is injected per-request by the auth interceptor
 * set up in useAuth (apps/mobile/src/hooks/useAuth.ts).
 */
export const apiClient = axios.create({
  baseURL: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000',
  timeout: 15_000,
  headers: {
    'Content-Type': 'application/json',
  },
});