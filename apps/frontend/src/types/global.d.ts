/* eslint-disable @typescript-eslint/no-explicit-any */
// apps/frontend/src/types/global.d.ts
export {};

declare global {
  interface Window {
    _lasyncroNavigate?: (path: string) => void;
    _lasyncroEntitlements?: { modules: string[]; flags: string[] } | null;
    _lasyncroConfig?: Record<string, any> | null;
  }
}
