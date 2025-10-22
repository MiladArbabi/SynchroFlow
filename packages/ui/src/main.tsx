// packages/ui/src/main.tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.tsx';
import { UserProvider } from './contexts/UserContext.tsx';

// --- BERRY THEME IMPORTS ---
import { ConfigProvider } from './contexts/ConfigContext.tsx';

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
// --- END BERRY IMPORTS ---

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      {/* 1. Berry's ConfigProvider (manages theme state) */}
      <ConfigProvider>
        {/* 2. Our UserProvider (manages user state) */}
        <UserProvider>
          <App />
        </UserProvider>
      </ConfigProvider>
    </BrowserRouter>
  </StrictMode>
);