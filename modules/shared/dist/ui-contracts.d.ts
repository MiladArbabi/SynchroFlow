import React from 'react';
/**
 * Shared UI contract types — authoritative.
 * Keep this file small and stable. Import these types from modules and host code.
 */
export * from './contracts/finances-intelligence.js';
export type ThemeSnapshot = {
    mode: 'light' | 'dark';
    palette?: Record<string, any>;
    spacing?: (n: number) => number | string;
};
export type EntitlementSnapshot = {
    modules: string[];
    flags: string[];
};
/**
 * CURRENCY CONTEXT — passed to all FT2 modules via props
 * -------------------------------------------------------
 * Drives Intl.NumberFormat formatting across all monetary displays.
 * Never hardcode 'USD' or 'en-US' in module components.
 *
 * displayCurrency: ISO 4217 code from shop_memberships.display_currency
 * locale: Intl locale tag from shop_memberships.locale
 */
export type CurrencyContext = {
    displayCurrency: string;
    locale: string;
    /**
     * Exchange rates map: { EUR: 0.92, GBP: 0.79, ... }
     * 1 USD = N target currency.
     * Optional — if absent, amounts display in base currency without conversion.
     * Populated by useExchangeRates() hook in host app pages.
     */
    rates?: Record<string, number>;
};
export type UserSnapshot = {
    id: string;
    email?: string;
    displayName?: string;
    roles?: string[];
};
export interface ToastOptions {
    duration?: number;
    type?: 'info' | 'success' | 'warning' | 'error';
}
export interface TelemetryEvent {
    name: string;
    payload?: Record<string, any>;
    ts?: number;
}
export interface RuntimeRouteDescriptor {
    id: string;
    name?: string;
    path: string;
    component: React.ComponentType<any> | React.LazyExoticComponent<any>;
    requiredModuleId?: string;
    requiredFlagId?: string;
    upgradeRoute?: string | null;
    meta?: Record<string, any>;
    order?: number;
}
export interface NavItemDescriptor {
    id: string;
    label: string;
    path?: string;
    icon?: React.ReactNode;
    requiredModuleId?: string;
    order?: number;
}
export interface HostApi {
    getThemeSnapshot(): ThemeSnapshot;
    getEntitlements(): EntitlementSnapshot | null;
    getUserSnapshot(): UserSnapshot;
    navigate(path: string, opts?: {
        replace?: boolean;
        state?: any;
    }): void;
    resolveRoutePathById?(routeId: string): string | null;
    registerRoute(route: RuntimeRouteDescriptor): void;
    unregisterRoute(routeId: string): void;
    addNavItem(item: NavItemDescriptor): void;
    removeNavItem(navId: string): void;
    getRegisteredRoutes(): RuntimeRouteDescriptor[];
    openModal(modalId: string, payload?: any): void;
    openDrawer(drawerId: string, payload?: any): void;
    showToast(message: string, opts?: ToastOptions): void;
    telemetry(ev: TelemetryEvent): void;
    publishEvent(name: string, payload?: any): void;
    subscribeEvent(name: string, handler: (payload?: any) => void): () => void;
}
export interface ModuleDescriptor {
    id: string;
    version: string;
    displayName: string;
    mountPath?: string;
    entitlements?: string[];
    lazy?: boolean;
}
export interface ModuleLayoutProps {
    moduleId: string;
    host: {
        theme: ThemeSnapshot;
        entitlements: EntitlementSnapshot | null;
        user: UserSnapshot;
        navigate: (path: string) => void;
        openGlobalModal?: (id: string, payload?: any) => void;
    };
}
export interface MountContext {
    host: HostApi;
    moduleId: string;
}
export interface ActivateContext {
    host: HostApi;
    moduleId: string;
    route?: string;
}
export interface ModuleRegistration {
    mount: React.ComponentType<ModuleLayoutProps> | React.ReactNode;
    onMount?: (ctx: MountContext) => Promise<void> | void;
    onActivate?: (ctx: ActivateContext) => Promise<void> | void;
    onDeactivate?: (ctx: ActivateContext) => Promise<void> | void;
    onUnmount?: (ctx: MountContext) => Promise<void> | void;
}
export interface GatedPlaceholderProps {
    routeName: string;
    missingModules?: string[];
    missingFlags?: string[];
    upgradeRoute?: string | null;
    backRoute?: string;
}
export type ChecklistUiIntent = {
    type: 'TASK_CLICK';
    moduleId: string;
    taskId: string;
};
//# sourceMappingURL=ui-contracts.d.ts.map