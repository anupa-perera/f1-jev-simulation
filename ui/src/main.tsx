import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Both are injected into the page shell by src/dashboard.js: the live server
// sends only the form defaults, the exported report sends only the run data.
const defaults = window.__F1_DEFAULTS__ ?? { model: 'gpt-5.6-luna', reasoning: 'low' };

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App defaults={defaults} />
  </StrictMode>,
);
