import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';

import { App } from './App.js';
import { applyTheme, readTheme } from './lib/branding.js';
import { ToastProvider } from './store/toast.js';
import './styles.css';

// El tema guardado se aplica antes del primer render para que no haya un
// destello de pantalla clara al abrir la carta de noche.
applyTheme(readTheme());

const container = document.getElementById('root');
if (!container) throw new Error('Falta el nodo #root en index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <App />
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
