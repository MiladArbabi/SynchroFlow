// packages/ui/src/utils/authStore.ts

/**
 * A simple in-memory store for the access token.
 * This is "module-level" state, accessible from anywhere in the
 * frontend, including non-React files like axios interceptors.
 */
let inMemoryAccessToken: string | null = null;

export const setToken = (token: string | null): void => {
  inMemoryAccessToken = token;
};

export const getToken = (): string | null => {
  return inMemoryAccessToken;
};

export const clearToken = (): void => {
  inMemoryAccessToken = null;
};