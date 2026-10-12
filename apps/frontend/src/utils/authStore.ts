// apps/frontend/src/utils/authStore.ts

/**
 * A simple in-memory store for the access token.
 * This is "module-level" state, accessible from anywhere in the
 * frontend, including non-React files like axios interceptors.
 */
let inMemoryAccessToken: string | null = null;
let sessionGeneration = 0;
export const getSessionGeneration = (): number => sessionGeneration;
export const advanceSessionGeneration = (): number => ++sessionGeneration;

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
  advanceSessionGeneration();
  inMemoryAccessToken = null;
  localStorage.removeItem('accessToken');
  localStorage.removeItem('user');
  _onTokenRefreshed?.(null, sessionGeneration);
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
let _onTokenRefreshed: ((token: string | null, generation: number) => void) | null = null;

export const setOnTokenRefreshed = (cb: typeof _onTokenRefreshed): void => {
  _onTokenRefreshed = cb;
};

export const notifyTokenRefreshed = (token: string, generation = sessionGeneration): void => {
  if (generation === sessionGeneration) _onTokenRefreshed?.(token, generation);
};
