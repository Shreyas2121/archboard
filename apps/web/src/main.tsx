import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import { App } from './app.js';
import { initializeTheme, ThemeProvider } from './app/theme/theme-provider.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import { queryClient, SessionBoundary } from './features/auth/index.js';
import { loadWebConfig } from './platform/config/index.js';
import './styles.css';

loadWebConfig(import.meta.env);
initializeTheme();

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionBoundary />
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
