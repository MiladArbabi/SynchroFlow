import React, { ReactNode } from 'react';
import { PublicUser } from 'api-types';
interface AuthState {
    isLoggedIn: boolean;
    isLoading: boolean;
    user: PublicUser | null;
    accessToken: string | null;
}
interface AuthContextType extends AuthState {
    login: (user: PublicUser, accessToken: string) => void;
    logout: () => void;
    setAccessToken: (token: string | null) => void;
}
export declare const AuthContext: React.Context<AuthContextType | undefined>;
interface AuthProviderProps {
    children: ReactNode;
}
export declare const AuthProvider: React.FC<AuthProviderProps>;
export declare const useAuth: () => AuthContextType;
export {};
