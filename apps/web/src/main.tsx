import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import { App } from './App';
import { applyTheme } from './theme/tokens';
import { branding } from './config/branding';
import './theme/global.css';

// Apply the config-driven theme + branding at startup.
applyTheme(undefined, document.documentElement);
document.title = branding.appName;

const container = document.getElementById('root');
if (!container) throw new Error('Root container #root not found');

// HashRouter keeps routing client-only, so the SPA works when served as static
// files behind CloudFront without server-side rewrite rules.
createRoot(container).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>
);
