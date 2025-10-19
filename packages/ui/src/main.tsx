import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { UserProvider } from './contexts/UserContext.tsx';
import App from './App.tsx'
import { ThemeProvider } from '@emotion/react';
import { createTheme } from '@mui/material';
import CssBaseline from '@mui/material/CssBaseline';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
     <ThemeProvider theme={createTheme()}>
        <CssBaseline />
        <UserProvider>
          <App />
        </UserProvider>
    </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
