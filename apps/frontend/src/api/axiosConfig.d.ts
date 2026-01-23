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
declare const axiosInstance: import("axios").AxiosInstance;
export { axiosInstance };
