import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';

import { App } from './app.js';
import { initializeTheme, ThemeProvider } from './app/theme/theme-provider.js';
import { TooltipProvider } from './components/ui/tooltip.js';
import { queryClient, SessionBoundary } from './features/auth/index.js';
import { loadWebConfig } from './platform/config/index.js';
import { AppUpdatePrompt } from './platform/update/app-update-prompt.js';
import './styles.css';

loadWebConfig(import.meta.env);
initializeTheme();

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

createRoot(rootElement, {
  // React's default diagnostics serialize caught errors/component stacks, which may contain
  // private route props. Feature boundaries show recovery UI; logs retain only a fixed event.
  onCaughtError: () => console.error('Application view failed.'),
  onUncaughtError: () => console.error('Application view failed.'),
}).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <TooltipProvider>
          <SessionBoundary />
          <div className="flex h-dvh flex-col">
            <AppUpdatePrompt />
            <div className="min-h-0 flex-1">
              <App />
            </div>
          </div>
        </TooltipProvider>
      </ThemeProvider>
    </QueryClientProvider>
  </StrictMode>,
);
