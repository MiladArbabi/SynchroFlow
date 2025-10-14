import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { UserProvider } from './contexts/UserContext.tsx';
import App from './App.tsx'
import { ThemeProvider } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import theme from './assets/theme';
import { MaterialUIControllerProvider } from './contexts/MaterialUI.tsx';


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
     <MaterialUIControllerProvider>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <UserProvider>
          <App />
        </UserProvider>
      </ThemeProvider>
    </MaterialUIControllerProvider>
    </BrowserRouter>
  </StrictMode>,
)
