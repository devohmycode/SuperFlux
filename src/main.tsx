import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { invoke } from '@tauri-apps/api/core'
import './index.css'
import App from './App'
import { AuthProvider } from './contexts/AuthContext'

// Restore window effect settings on startup
;(function restoreWindowEffect() {
  const effect = localStorage.getItem('superflux_window_effect') || 'none';
  const opacity = Number(localStorage.getItem('superflux_window_opacity') || '85');

  if (effect !== 'none') {
    const isDark = document.documentElement.classList.contains('dark');
    const base = isDark ? 20 : 240;
    const alpha = Math.round((opacity / 100) * 200);

    invoke('set_window_effect', { effect, r: base, g: base, b: base, a: alpha }).catch((e) => {
      console.warn('[startup] set_window_effect failed:', e);
    });
    document.documentElement.classList.add('window-effect-active');
    document.documentElement.style.setProperty('--window-opacity-pct', `${opacity}%`);
  }
})();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <App />
    </AuthProvider>
  </StrictMode>,
)
