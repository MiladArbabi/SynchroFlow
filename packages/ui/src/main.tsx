/* eslint-disable @typescript-eslint/no-unused-vars */
// packages/ui/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { UserProvider } from './contexts/UserContext.tsx';
import { AuthProvider } from './contexts/AuthContext';
import { User } from '../../api/src/types';

// --- TanStack Query Imports ---
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';

// --- BERRY THEME IMPORTS ---
import { ConfigProvider } from './contexts/ConfigContext.tsx';

// --- REACT-INTL IMPORT ---
import { IntlProvider } from 'react-intl';

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

// --- BASIC INTL CONFIG ---
// We'll just use English for now and let FormattedMessage use defaultMessage
const messages = {
  // Add actual translations here later if needed
};
const defaultLocale = 'en';
// --- END INTL CONFIG ---

// Check if we are in the Playwright E2E test environment
const isE2ETest = import.meta.env.MODE === 'e2e';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Example default: Refetch on window focus
      refetchOnWindowFocus: true,
      retry: isE2ETest ? false : 3,
      // Configure staleTime/gcTime later if needed
      // staleTime: 5 * 60 * 1000, // 5 minutes
      // gcTime: 10 * 60 * 1000, // 10 minutes
    },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ConfigProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <UserProvider>
            <BrowserRouter>
              <ConfigProvider>
              <IntlProvider
                locale={defaultLocale}
                defaultLocale={defaultLocale}
                messages={messages} // Provide empty messages for now
                onError={(err) => {
                  // Suppress missing translation errors for now, rely on defaultMessage
                  if (err.code === 'MISSING_TRANSLATION') {
                    // console.warn('Missing translation:', err.message);
                    return;
                  }
                  console.error(err);
                }}
                >
                  <UserProvider>
                    <App />
                  </UserProvider>
              </IntlProvider>
              </ConfigProvider>
            </BrowserRouter>
          </UserProvider>
        </AuthProvider>
      {/* Add DevTools outside other providers, but inside QueryClientProvider */}
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
    </ConfigProvider>
  </StrictMode>
);