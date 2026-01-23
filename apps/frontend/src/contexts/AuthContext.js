import { jsx as _jsx } from "react/jsx-runtime";
/* eslint-disable @typescript-eslint/no-unused-vars */
/* eslint-disable react-refresh/only-export-components */
// apps/frontend/src/contexts/AuthContext.tsx
import React, { createContext, useState, useContext, useCallback } from 'react';
import { getToken, setToken, clearToken } from 'utils/authStore';
// --- Create Context ---
export const AuthContext = createContext(undefined);
export const AuthProvider = ({ children }) => {
    const [authState, setAuthState] = useState({
        isLoggedIn: false,
        isLoading: true, // Start in loading state
        user: null,
        accessToken: null,
    });
    // --- [START POSTHOG HOOK] ---
    /* const posthog = usePostHog(); */
    // Re-hydrate session from localStorage on app load
    React.useEffect(() => {
        /* console.log("AuthContext: Initializing..."); */
        try {
            // Playwright's storageState will inject these values
            const storedToken = getToken();
            const storedUser = localStorage.getItem('user');
            if (storedToken && storedUser) {
                /* console.log("AuthContext: Found stored session. Re-hydrating state."); */
                setAuthState({
                    isLoggedIn: true,
                    isLoading: false,
                    user: JSON.parse(storedUser), // Parse the user JSON string
                    accessToken: storedToken,
                });
            }
            else {
                /* console.log("AuthContext: No stored session found."); */
                // No session, just finish loading
                setAuthState(prev => ({ ...prev, isLoading: false }));
            }
        }
        catch (error) {
            /* console.error("AuthContext: Failed to parse stored user. Logging out.", error); */
            // Clear corrupted storage and finish loading
            localStorage.removeItem('accessToken');
            localStorage.removeItem('user');
            setAuthState(prev => ({ ...prev, isLoading: false, isLoggedIn: false, user: null, accessToken: null }));
        }
    }, []);
    const login = useCallback((user, accessToken) => {
        setAuthState({
            isLoggedIn: true,
            isLoading: false,
            user,
            accessToken,
        });
        // 🔑 SINGLE TOKEN AUTHORITY
        setToken(accessToken);
        // User stays in localStorage (non-sensitive)
        localStorage.setItem('user', JSON.stringify(user));
        console.info('[AUTH] login(): token stored via authStore');
    }, []);
    const logout = useCallback(() => {
        setAuthState({
            isLoggedIn: false,
            isLoading: false,
            user: null,
            accessToken: null,
        });
        clearToken(); // 🔥 single source cleanup
        localStorage.removeItem('user');
        console.info('[AUTH] logout(): token cleared via authStore');
    }, []);
    const setAccessToken = useCallback((token) => {
        setAuthState(prev => ({ ...prev, accessToken: token }));
        if (token) {
            setToken(token);
        }
        else {
            clearToken();
        }
        console.info('[AUTH] setAccessToken():', Boolean(token));
    }, []);
    const value = {
        ...authState,
        login,
        logout,
        setAccessToken,
    };
    // Render children only after initial loading is false
    return _jsx(AuthContext.Provider, { value: value, children: children });
};
// --- Create Hook for easy access ---
export const useAuth = () => {
    const context = useContext(AuthContext);
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider');
    }
    return context;
};
//# sourceMappingURL=AuthContext.js.map