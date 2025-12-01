/* eslint-disable */

/// <reference types="vite/client" />

interface ImportMetaEnv {
  // Add whatever VITE_ variables you actually use. Safe defaults:
  readonly VITE_API_URL?: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
