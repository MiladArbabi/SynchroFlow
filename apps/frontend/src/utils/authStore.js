// apps/frontend/src/utils/authStore.ts
/**
 * A simple in-memory store for the access token.
 * This is "module-level" state, accessible from anywhere in the
 * frontend, including non-React files like axios interceptors.
 */
let inMemoryAccessToken = null;
export const setToken = (token) => {
    inMemoryAccessToken = token;
    if (token) {
        localStorage.setItem('accessToken', token);
    }
};
export const getToken = () => {
    if (!inMemoryAccessToken) {
        inMemoryAccessToken = localStorage.getItem('accessToken');
    }
    return inMemoryAccessToken;
};
export const clearToken = () => {
    inMemoryAccessToken = null;
    localStorage.removeItem('accessToken');
};
//# sourceMappingURL=authStore.js.map