import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './app.js';
import { loadWebConfig } from './platform/config/index.js';
import './styles.css';

loadWebConfig(import.meta.env);

const rootElement = document.querySelector('#root');

if (!rootElement) {
  throw new Error('The application root element is missing.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
