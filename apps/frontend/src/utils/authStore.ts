// apps/frontend/src/utils/authStore.ts

/**
 * A simple in-memory store for the access token.
 * This is "module-level" state, accessible from anywhere in the
 * frontend, including non-React files like axios interceptors.
 */
let inMemoryAccessToken: string | null = null;

export const setToken = (token: string | null): void => {
  inMemoryAccessToken = token;
  if (token) {
    localStorage.setItem('accessToken', token);
  }
};

export const getToken = (): string | null => {
  if (!inMemoryAccessToken) {
    inMemoryAccessToken = localStorage.getItem('accessToken');
  }
  return inMemoryAccessToken;
};

export const clearToken = (): void => {
  inMemoryAccessToken = null;
  localStorage.removeItem('accessToken');
};

/**
 * SILENT REFRESH BRIDGE
 * ─────────────────────
 * axiosConfig.ts (non-React) calls notifyTokenRefreshed() after a successful
 * silent refresh. AuthContext wires its setAccessToken() here on mount via
 * setOnTokenRefreshed(), keeping React state in sync with authStore.
 *
 * Without this, React state shows the old (expired) token even though
 * authStore and the Authorization header have been updated.
 */
let _onTokenRefreshed: ((token: string) => void) | null = null;

export const setOnTokenRefreshed = (cb: (token: string) => void): void => {
  _onTokenRefreshed = cb;
};

export const notifyTokenRefreshed = (token: string): void => {
  _onTokenRefreshed?.(token);
};