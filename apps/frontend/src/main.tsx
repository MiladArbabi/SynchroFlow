/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-unused-vars */
// apps/frontend/src/main.tsx
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';

// --- OUR CONTEXTS ---
import { UserProvider } from './contexts/UserContext.tsx';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// --- TanStack Query Imports ---
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// --- BERRY THEME IMPORTS ---
import { ConfigProvider } from './contexts/ConfigContext.tsx';

// --- REACT-INTL IMPORT ---
import { IntlProvider } from 'react-intl';
import './debug/lasyncro-module-debug';

// style + assets
import './assets/scss/style.scss'; // Import Berry's global styles
import 'simplebar-react/dist/simplebar.min.css'; // Import Simplebar styles

// google-fonts
import '@fontsource/roboto/400.css';
import '@fontsource/roboto/500.css';
import '@fontsource/roboto/300.css';
import '@fontsource/roboto/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/poppins/400.css';
import '@fontsource/poppins/500.css';
import '@fontsource/poppins/600.css';
import '@fontsource/poppins/700.css';

// --- CSS / STYLING ---
/* import "assets/css/nucleo-icons.css";
import "assets/css/nucleo-svg.css"; */
import "./index.css";
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

import { loadAllModules } from 'runtime/moduleLoader';
import { bootstrapNavGroups } from 'runtime/navBootstrap';
import { RouteLogger } from './debug/RouteLogger';

if (!window._lasyncroNavigate) {
  window._lasyncroNavigate = (path: string) => {
    // use HTML5 history so router reacts; also dispatch popstate so listeners respond
    window.history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
}

// --- Create React Query Client ---
const container = document.getElementById("root");

/**
 * CRITICAL: HARD DOM RESET BEFORE REACT BOOT
 * -----------------------------------------
 * Prevents browser from reusing previous frame DOM (FT_MINUS_ONE flash).
 */
if (container) {
  container.innerHTML = '';
  console.warn('[ROOT_DOM_CLEARED_BEFORE_BOOT]');
}

if (!container) throw new Error("Failed to find the root element");
const root = createRoot(container);

/* // --- [START POSTHOG OPTIONS] ---
const posthogKey = import.meta.env.VITE_PUBLIC_POSTHOG_KEY; */

const options = {
  /* api_host: import.meta.env.VITE_PUBLIC_POSTHOG_HOST, */
  capture_exceptions: true, // This enables capturing exceptions using Error Tracking
  debug: import.meta.env.MODE === 'development',
  capture_pageview: true, // Automatically captures page views
  /* loaded: (posthog: any) => {
    if (!posthogKey) {
      console.warn("PostHog API key is not set. Analytics are disabled.");
    }
  }, */
};

// --- BASIC INTL CONFIG ---
const messages = {}; // No translations yet
const defaultLocale = 'en';

// Check if we are in the Playwright E2E test environment
const isE2ETest = import.meta.env.MODE === 'e2e';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: true,
      // Disable retries in E2E tests for faster, more predictable failure
      retry: isE2ETest ? false : 3,
    },
  },
});

root.render(
  <>
    {/* 1. PostHog (Analytics) */}
      {/* 2. ConfigProvider (Berry Theme) */}
      <ConfigProvider>
        {/* 3. React Query (Data Fetching) */}
        <QueryClientProvider client={queryClient}>
            <UserProvider>
            {/* 5. React Router */}
            <BrowserRouter>
             <RouteLogger />
              {/* 6. IntlProvider (Localization) */}
              <IntlProvider
                locale={defaultLocale}
                defaultLocale={defaultLocale}
                messages={messages}
                onError={(err) => {
                  if (err.code === 'MISSING_TRANSLATION') {
                    return; // Suppress missing translation warnings
                  }
                  console.error(err);
                }}
              >
                {/* The App itself */}
                <App />

              </IntlProvider>
            </BrowserRouter>
           </UserProvider>
          
          {/* React Query DevTools */}
          <ReactQueryDevtools initialIsOpen={false} />
        </QueryClientProvider>
      </ConfigProvider>
    </>
);

(window as any)._lasyncroHost = {
  addNavItem: (n: any) => console.debug('[lasyncro-host] addNavItem', n),
  addRoute: (r: any) => console.debug('[lasyncro-host] addRoute', r),
  // ...other host functions modules expect
};

bootstrapNavGroups();

loadAllModules()
  .then((loaded) => {
    /* console.info('[lasyncro] loaded modules:', Object.keys(loaded)); */
  })
  .catch((err) => {
    /* console.error('[lasyncro] failed to load modules', err); */
  });
