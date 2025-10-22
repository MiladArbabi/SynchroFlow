// packages/ui/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { UserProvider } from './contexts/UserContext.tsx';

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
// --- END IMPORTS ---

// --- BASIC INTL CONFIG ---
// We'll just use English for now and let FormattedMessage use defaultMessage
const messages = {
  // Add actual translations here later if needed
};
const defaultLocale = 'en';
// --- END INTL CONFIG ---

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/* 1. Berry's ConfigProvider (manages theme state) */}
      <ConfigProvider>
        {/* 2. React Intl Provider */}
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
          {/* 3. Our UserProvider (manages user state) */}
          <UserProvider>
            <App />
          </UserProvider>
        </IntlProvider>
      </ConfigProvider>
    </BrowserRouter>
  </StrictMode>
);