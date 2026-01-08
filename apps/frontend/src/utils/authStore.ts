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