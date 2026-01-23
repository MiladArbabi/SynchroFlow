import React, { ReactNode } from 'react';
import { EntitlementSnapshot } from 'runtime/EntitlementSnapshot';
interface EntitlementsContextValue {
    shopId: number | null;
    modules: string[];
    flags: string[];
    snapshot: EntitlementSnapshot;
    isLoading: boolean;
    hasResolved: boolean;
    error: string | null;
    hasModule: (moduleId: string) => boolean;
    hasFlag: (flagId: string) => boolean;
    refresh: () => void;
}
interface EntitlementsProviderProps {
    children: ReactNode;
}
export declare const EntitlementsProvider: React.FC<EntitlementsProviderProps>;
export declare const useEntitlements: () => EntitlementsContextValue;
export {};
