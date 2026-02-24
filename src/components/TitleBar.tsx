import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { fetchViaBackend } from '../lib/tauriFetch';
import type { PinEntry } from './SourcePanel';
import type { FeedCategory, FeedSource } from '../types';

const appWindow = getCurrentWindow();

interface TitleBarProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  unreadCount?: number;
  favoritesCount?: number;
  readLaterCount?: number;
  pinnedItems?: PinEntry[];
  categories?: FeedCategory[];
  onSelectFeed?: (feedId: string, source: FeedSource) => void;
  onSync?: () => void;
  isSyncing?: boolean;
  showSysInfo?: boolean;
}

interface WeatherData {
  temp: number;
  icon: string;
}

const weatherIcons: Record<number, string> = {
  0: '\u2600', // ☀ Clear sky
  1: '\u{1F324}', // 🌤 Mainly clear
  2: '\u26C5', // ⛅ Partly cloudy
  3: '\u2601', // ☁ Overcast
  45: '\u{1F32B}', // 🌫 Fog
  48: '\u{1F32B}', // 🌫 Rime fog
  51: '\u{1F326}', // 🌦 Light drizzle
  53: '\u{1F326}', // 🌦 Moderate drizzle
  55: '\u{1F326}', // 🌦 Dense drizzle
  61: '\u{1F327}', // 🌧 Slight rain
  63: '\u{1F327}', // 🌧 Moderate rain
  65: '\u{1F327}', // 🌧 Heavy rain
  71: '\u{1F328}', // 🌨 Slight snow
  73: '\u{1F328}', // 🌨 Moderate snow
  75: '\u2744', // ❄ Heavy snow
  77: '\u2744', // ❄ Snow grains
  80: '\u{1F327}', // 🌧 Slight showers
  81: '\u{1F327}', // 🌧 Moderate showers
  82: '\u{1F327}', // 🌧 Violent showers
  85: '\u{1F328}', // 🌨 Slight snow showers
  86: '\u{1F328}', // 🌨 Heavy snow showers
  95: '\u26C8', // ⛈ Thunderstorm
  96: '\u26C8', // ⛈ Thunderstorm + hail
  99: '\u26C8', // ⛈ Thunderstorm + heavy hail
};

function getWeatherIcon(code: number): string {
  return weatherIcons[code] ?? '\u2600';
}

function formatSpeed(kbps: number): string {
  if (kbps >= 1024) return `${(kbps / 1024).toFixed(1)} MB/s`;
  return `${Math.round(kbps)} KB/s`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function TitleBar({ isCollapsed, onToggleCollapse, unreadCount = 0, favoritesCount = 0, readLaterCount = 0, pinnedItems = [], categories = [], onSelectFeed, onSync, isSyncing = false, showSysInfo = true }: TitleBarProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [now, setNow] = useState(new Date());
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [cpuUsage, setCpuUsage] = useState<number | null>(null);
  const [memUsage, setMemUsage] = useState<{ used_gb: number; total_gb: number; percent: number } | null>(null);
  const [netSpeed, setNetSpeed] = useState<{ download_kbps: number; upload_kbps: number } | null>(null);
  const [alwaysOnTop, setAlwaysOnTop] = useState(() => {
    try { return localStorage.getItem('superflux_always_on_top') === 'true'; }
    catch { return false; }
  });

  useEffect(() => {
    appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    const unlisten = appWindow.onResized(() => {
      appWindow.isMaximized().then(setIsMaximized).catch(() => {});
    });
    return () => { unlisten.then(fn => fn()); };
  }, []);

  // Apply always-on-top on mount and when toggled
  useEffect(() => {
    appWindow.setAlwaysOnTop(alwaysOnTop).catch(() => {});
  }, [alwaysOnTop]);

  const toggleAlwaysOnTop = useCallback(() => {
    setAlwaysOnTop(prev => {
      const next = !prev;
      localStorage.setItem('superflux_always_on_top', String(next));
      return next;
    });
  }, []);

  // Clock: update every 30 seconds
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(interval);
  }, []);

  // System monitors: poll every 2s when collapsed and sysinfo visible
  useEffect(() => {
    if (!isCollapsed || !showSysInfo) {
      setCpuUsage(null);
      setMemUsage(null);
      setNetSpeed(null);
      return;
    }
    let cancelled = false;
    const poll = () => {
      invoke<number>('get_cpu_usage')
        .then(v => { if (!cancelled) setCpuUsage(Math.round(v)); })
        .catch(() => {});
      invoke<{ used_gb: number; total_gb: number; percent: number }>('get_memory_usage')
        .then(v => { if (!cancelled) setMemUsage(v); })
        .catch(() => {});
      invoke<{ download_kbps: number; upload_kbps: number }>('get_net_speed')
        .then(v => { if (!cancelled) setNetSpeed(v); })
        .catch(() => {});
    };
    poll();
    const interval = setInterval(poll, 2000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [isCollapsed, showSysInfo]);

  // Weather: fetch on mount + every 15 minutes
  useEffect(() => {
    let cancelled = false;

    async function fetchWeather() {
      try {
        // Try geolocation, fall back to Paris
        const coords = await new Promise<{ lat: number; lon: number }>((resolve) => {
          if (!navigator.geolocation) {
            resolve({ lat: 48.86, lon: 2.35 });
            return;
          }
          navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
            () => resolve({ lat: 48.86, lon: 2.35 }),
            { timeout: 5000 }
          );
        });

        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code`;
        const raw = await fetchViaBackend(url);
        const data = JSON.parse(raw);
        if (!cancelled && data.current) {
          setWeather({
            temp: Math.round(data.current.temperature_2m),
            icon: getWeatherIcon(data.current.weather_code),
          });
        }
      } catch {
        // Silently fail — weather is optional
      }
    }

    fetchWeather();
    const interval = setInterval(fetchWeather, 15 * 60_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const handleCollapse = useCallback(async () => {
    try {
      if (!isCollapsed) {
        await invoke('collapse_window');
      } else {
        await invoke('expand_window');
      }
    } catch (err) {
      console.error('[TitleBar] collapse/expand error:', err);
    }
    onToggleCollapse();
  }, [isCollapsed, onToggleCollapse]);

  return (
    <div className={`titlebar ${isCollapsed ? 'titlebar--collapsed' : ''}`} data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <span className="titlebar-brand" data-tauri-drag-region>◈</span>
        <span className="titlebar-title" data-tauri-drag-region>SuperFlux</span>
        {isCollapsed && (
          <div className="titlebar-badges" data-tauri-drag-region>
            {unreadCount > 0 && (
              <span className="titlebar-badge titlebar-badge--unread">{unreadCount}</span>
            )}
            {favoritesCount > 0 && (
              <span className="titlebar-badge titlebar-badge--favorites">★ {favoritesCount}</span>
            )}
            {readLaterCount > 0 && (
              <span className="titlebar-badge titlebar-badge--readlater">🔖 {readLaterCount}</span>
            )}
          </div>
        )}
        {isCollapsed && pinnedItems.length > 0 && (
          <div className="titlebar-pins">
            {pinnedItems.map(pin => {
              let count = 0;
              let icon = '◇';
              let label = '';
              if (pin.kind === 'feed') {
                for (const cat of categories) {
                  const feed = cat.feeds.find(f => f.id === pin.feedId);
                  if (feed) { count = feed.unreadCount; icon = pin.icon; label = pin.label; break; }
                }
              } else {
                const cat = categories.find(c => c.id === pin.categoryId);
                if (cat) {
                  count = cat.feeds
                    .filter(f => f.folder === pin.folderPath || f.folder?.startsWith(pin.folderPath + '/'))
                    .reduce((s, f) => s + f.unreadCount, 0);
                  icon = '📁';
                  label = pin.label;
                }
              }
              const key = pin.kind === 'feed' ? `feed::${pin.feedId}` : `folder::${pin.categoryId}::${pin.folderPath}`;
              return (
                <button
                  key={key}
                  className="titlebar-pin"
                  title={label}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (pin.kind === 'feed' && onSelectFeed) {
                      const cat = categories.find(c => c.feeds.some(f => f.id === pin.feedId));
                      const feed = cat?.feeds.find(f => f.id === pin.feedId);
                      if (feed) onSelectFeed(feed.id, feed.source);
                    }
                  }}
                >
                  <span className="titlebar-pin-icon">{icon}</span>
                  <span className="titlebar-pin-label">{label}</span>
                  {count > 0 && <span className="titlebar-pin-badge">{count}</span>}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {isCollapsed && (
        <div className="titlebar-info" data-tauri-drag-region>
          {weather && (
            <span className="titlebar-weather" data-tauri-drag-region>
              {weather.icon} {weather.temp}°
            </span>
          )}
          <span className="titlebar-datetime" data-tauri-drag-region>
            <span className="titlebar-time">{formatTime(now)}</span>
            <span className="titlebar-date">{formatDate(now)}</span>
          </span>
        </div>
      )}
      {isCollapsed && showSysInfo && (
        <div className="titlebar-sysinfo" data-tauri-drag-region>
          {cpuUsage !== null && (
            <span className={`titlebar-monitor ${cpuUsage > 80 ? 'titlebar-monitor--high' : cpuUsage > 50 ? 'titlebar-monitor--mid' : ''}`} data-tauri-drag-region title="CPU">
              <span className="titlebar-monitor-bar" style={{ width: `${cpuUsage}%` }} />
              <span className="titlebar-monitor-text">CPU {cpuUsage}%</span>
            </span>
          )}
          {memUsage !== null && (
            <span className={`titlebar-monitor ${memUsage.percent > 85 ? 'titlebar-monitor--high' : memUsage.percent > 65 ? 'titlebar-monitor--mid' : ''}`} data-tauri-drag-region title={`RAM ${memUsage.used_gb} / ${memUsage.total_gb} Go`}>
              <span className="titlebar-monitor-bar" style={{ width: `${memUsage.percent}%` }} />
              <span className="titlebar-monitor-text">RAM {memUsage.used_gb}G</span>
            </span>
          )}
          {netSpeed !== null && (
            <span className="titlebar-net" data-tauri-drag-region title="Réseau">
              <span className="titlebar-net-row">↓ {formatSpeed(netSpeed.download_kbps)}</span>
              <span className="titlebar-net-row">↑ {formatSpeed(netSpeed.upload_kbps)}</span>
            </span>
          )}
        </div>
      )}
      <div className="titlebar-controls">
        {!isCollapsed && (
          <>
            <button
              className="titlebar-btn titlebar-btn-close"
              onClick={() => appWindow.close()}
              title="Fermer"
            >
              <svg width="10" height="10" viewBox="0 0 10 10">
                <line x1="1" y1="1" x2="9" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                <line x1="9" y1="1" x2="1" y2="9" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
              </svg>
            </button>
            <button
              className="titlebar-btn titlebar-btn-maximize"
              onClick={() => appWindow.toggleMaximize()}
              title={isMaximized ? 'Restaurer' : 'Agrandir'}
            >
              {isMaximized ? (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <polyline points="2,3 2,0 10,0 10,7 7,7" fill="none" stroke="currentColor" strokeWidth="1.2" />
                  <rect x="0" y="3" width="7" height="7" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              ) : (
                <svg width="10" height="10" viewBox="0 0 10 10">
                  <rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="1.2" />
                </svg>
              )}
            </button>
          </>
        )}
        {isCollapsed && onSync && (
          <button
            className={`titlebar-btn titlebar-btn-sync ${isSyncing ? 'syncing' : ''}`}
            onClick={onSync}
            disabled={isSyncing}
            title={isSyncing ? 'Synchronisation en cours…' : 'Forcer la synchronisation'}
          >
            <svg width="11" height="11" viewBox="0 0 11 11">
              <path d="M5.5 1 A4.5 4.5 0 1 1 1 5.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <polyline points="5.5,0 5.5,2.5 3,1" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {isCollapsed && (
          <button
            className={`titlebar-btn titlebar-btn-pin ${alwaysOnTop ? 'active' : ''}`}
            onClick={toggleAlwaysOnTop}
            title={alwaysOnTop ? 'Désépingler' : 'Toujours au-dessus'}
          >
            <svg width="10" height="12" viewBox="0 0 10 12">
              {alwaysOnTop ? (
                <>
                  <line x1="5" y1="1" x2="5" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <line x1="2" y1="8" x2="8" y2="8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                  <circle cx="5" cy="1" r="1.2" fill="currentColor" />
                </>
              ) : (
                <>
                  <line x1="5" y1="3" x2="5" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <line x1="2" y1="10" x2="8" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  <circle cx="5" cy="3" r="1" fill="currentColor" />
                </>
              )}
            </svg>
          </button>
        )}
        <button
          className="titlebar-btn titlebar-btn-collapse"
          onClick={handleCollapse}
          title={isCollapsed ? 'Agrandir la fenêtre' : 'Réduire en barre'}
        >
          <svg width="10" height="10" viewBox="0 0 10 10">
            {isCollapsed ? (
              <polyline points="1,3 5,8 9,3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            ) : (
              <polyline points="1,7 5,2 9,7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
            )}
          </svg>
        </button>
      </div>
    </div>
  );
}
