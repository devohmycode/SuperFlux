import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'
import { ProProvider } from './contexts/ProContext'

// Restore window effect settings on startup
;(function restoreWindowEffect() {
  const effect = localStorage.getItem('superflux_window_effect') || 'none';
  const opacity = Number(localStorage.getItem('superflux_window_opacity') || '85');

  if (effect !== 'none') {
    const isDark = document.documentElement.classList.contains('dark');
    const isSepia = document.documentElement.classList.contains('sepia');
    let r: number, g: number, b: number;
    if (isDark) { r = 20; g = 20; b = 20; }
    else if (isSepia) { r = 210; g = 195; b = 170; }
    else { r = 240; g = 240; b = 240; }
    const alpha = Math.round((opacity / 100) * 200);

    invoke('set_window_effect', { effect, r, g, b, a: alpha }).catch((e) => {
      console.warn('[startup] set_window_effect failed:', e);
    });
    document.documentElement.classList.add('window-effect-active');
    document.documentElement.style.setProperty('--window-opacity-pct', `${opacity}%`);
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <ProProvider>
        <App />
      </ProProvider>
    </AuthProvider>
  </StrictMode>,
)
