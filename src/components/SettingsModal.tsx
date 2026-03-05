import { useState, useRef, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import i18n, { setLanguage, getLanguage } from '../i18n';
import { motion, AnimatePresence } from 'motion/react';
import { invoke } from '@tauri-apps/api/core';
import type { FeedSource } from '../types';
import { useAuth } from '../contexts/AuthContext';
import { AuthModal } from './AuthModal';
import { openExternal } from '../lib/tauriFetch';
import { getLLMConfig, saveLLMConfig, checkOllamaStatus, pullOllamaModel, type LLMConfig, type OllamaStatus, type PullProgress } from '../services/llmService';
import { createProvider, type ProviderConfig, type ProviderType } from '../services/providers';
import { getProviderConfig, saveProviderConfig, clearProviderConfig, ProviderSyncService } from '../services/providerSync';
import { getTtsConfig, saveTtsConfig, speak as ttsSpeak, stop as ttsStop, type TtsEngine, type TtsConfig } from '../services/ttsService';
import { getTranslationConfig, saveTranslationConfig, LANGUAGES } from '../services/translationService';
import { usePro } from '../contexts/ProContext';
import { PalettePickerInline } from './PalettePicker';
import { PRO_LIMITS } from '../services/licenseService';
import { getRSSHubInstance, setRSSHubInstance as setRSSHubInstanceConfig } from '../services/rsshubService';

const SYNC_INTERVAL_KEY = 'superflux_sync_interval';
const DEFAULT_SYNC_INTERVAL = 5 * 60 * 1000;

const SYNC_OPTIONS = [
  { value: 1 * 60 * 1000, labelKey: 'settings.oneMinute' },
  { value: 3 * 60 * 1000, labelKey: 'settings.threeMinutes' },
  { value: 5 * 60 * 1000, labelKey: 'settings.fiveMinutes' },
  { value: 10 * 60 * 1000, labelKey: 'settings.tenMinutes' },
  { value: 15 * 60 * 1000, labelKey: 'settings.fifteenMinutes' },
  { value: 30 * 60 * 1000, labelKey: 'settings.thirtyMinutes' },
  { value: 45 * 60 * 1000, labelKey: 'settings.fortyFiveMinutes' },
  { value: 60 * 60 * 1000, labelKey: 'settings.oneHour' },
  { value: 3 * 60 * 60 * 1000, labelKey: 'settings.threeHours' },
  { value: 6 * 60 * 60 * 1000, labelKey: 'settings.sixHours' },
  { value: 12 * 60 * 60 * 1000, labelKey: 'settings.twelveHours' },
] as const;

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportOpml: (feeds: { url: string; name: string; source: FeedSource }[]) => number;
  feedCount?: number;
  onSyncIntervalChange?: (interval: number) => void;
  onShowSysInfoChange?: (show: boolean) => void;
  showSysInfo?: boolean;
}

interface OpmlFeed {
  title: string;
  xmlUrl: string;
  htmlUrl?: string;
  category?: string;
}

type WindowEffect = 'none' | 'mica' | 'acrylic' | 'tabbed' | 'blur';

function getStoredEffect(): WindowEffect {
  return (localStorage.getItem('superflux_window_effect') as WindowEffect) || 'none';
}

function getStoredOpacity(): number {
  const v = localStorage.getItem('superflux_window_opacity');
  return v ? Number(v) : 85;
}

let _effectTimer: ReturnType<typeof setTimeout> | null = null;

function applyWindowEffect(effect: WindowEffect, opacity: number) {
  // Apply CSS immediately for instant visual feedback
  if (effect !== 'none') {
    document.documentElement.classList.add('window-effect-active');
    document.documentElement.style.setProperty('--window-opacity-pct', `${opacity}%`);
  } else {
    document.documentElement.classList.remove('window-effect-active');
    document.documentElement.style.setProperty('--window-opacity-pct', '100%');
  }

  // Debounce the native effect call (triggers a resize nudge for DWM repaint)
  if (_effectTimer) clearTimeout(_effectTimer);
  _effectTimer = setTimeout(() => {
    const isAmoled = document.documentElement.classList.contains('amoled');
    const isDark = isAmoled || document.documentElement.classList.contains('dark');
    let r: number, g: number, b: number;
    if (isAmoled) { r = 0; g = 0; b = 0; }
    else if (isDark) { r = 20; g = 20; b = 20; }
    else { r = 240; g = 240; b = 240; }
    const alpha = Math.round((opacity / 100) * 200);

    invoke('set_window_effect', {
      effect,
      r, g, b,
      a: alpha,
    }).catch((e) => console.warn('[settings] set_window_effect failed:', e));
  }, 150);
}

function detectSource(feed: OpmlFeed): FeedSource {
  const url = (feed.xmlUrl || feed.htmlUrl || '').toLowerCase();
  if (url.includes('reddit.com') || url.includes('/r/')) return 'reddit';
  if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
  if (url.includes('twitter.com') || url.includes('x.com') || url.includes('nitter')) return 'twitter';
  if (url.includes('mastodon') || url.includes('fosstodon') || url.includes('hachyderm')) return 'mastodon';
  return 'article';
}

function parseOpml(xmlString: string): OpmlFeed[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, 'text/xml');

  const parseError = doc.querySelector('parsererror');
  if (parseError) {
    throw new Error(i18n.t('settings.invalidOpml'));
  }

  const feeds: OpmlFeed[] = [];
  const outlines = doc.querySelectorAll('outline');

  outlines.forEach(outline => {
    const xmlUrl = outline.getAttribute('xmlUrl');
    if (!xmlUrl) return; // skip category-only outlines

    const title = outline.getAttribute('title')
      || outline.getAttribute('text')
      || xmlUrl;

    const htmlUrl = outline.getAttribute('htmlUrl') || undefined;

    // Try to get category from parent outline
    const parent = outline.parentElement;
    const category = parent?.tagName === 'outline'
      ? (parent.getAttribute('title') || parent.getAttribute('text') || undefined)
      : undefined;

    feeds.push({ title, xmlUrl, htmlUrl, category });
  });

  return feeds;
}

export function SettingsModal({ isOpen, onClose, onImportOpml, feedCount = 0, onSyncIntervalChange, onShowSysInfoChange, showSysInfo = true }: SettingsModalProps) {
  const { t } = useTranslation();
  const { user, signOut, isConfigured } = useAuth();
  const { isPro, deactivateLicense, showUpgradeModal } = usePro();

  const handleProDeactivate = useCallback(async () => {
    await deactivateLicense();
  }, [deactivateLicense]);
  const [importResult, setImportResult] = useState<{ added: number; skipped: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [summaryFormat, setSummaryFormat] = useState<'bullets' | 'paragraph'>(
    () => (localStorage.getItem('superflux_summary_format') as 'bullets' | 'paragraph') || 'bullets'
  );
  const [llmConfig, setLlmConfig] = useState<LLMConfig>(getLLMConfig);
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus>({ available: false, models: [] });
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'done' | 'error'>('idle');
  const [pullProgress, setPullProgress] = useState<PullProgress | null>(null);
  const [pullError, setPullError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── TTS state ──
  const [ttsConfig, setTtsConfig] = useState<TtsConfig>(getTtsConfig);
  const [ttsTestStatus, setTtsTestStatus] = useState<'idle' | 'playing'>('idle');
  const [ttsError, setTtsError] = useState<string | null>(null);

  // ── Translation state ──
  const [translationLang, setTranslationLang] = useState(() => getTranslationConfig().targetLanguage);

  // ── Sync interval state ──
  const [syncIntervalMs, setSyncIntervalMs] = useState(() => {
    try {
      const v = localStorage.getItem(SYNC_INTERVAL_KEY);
      if (v) return Number(v);
    } catch { /* ignore */ }
    return DEFAULT_SYNC_INTERVAL;
  });

  // ── Retention state ──
  const RETENTION_KEY = 'superflux_retention_days';
  const RETENTION_OPTIONS = [
    { value: 0, labelKey: 'settings.disabled' },
    { value: 30, labelKey: 'settings.thirtyDays' },
    { value: 60, labelKey: 'settings.sixtyDays' },
    { value: 90, labelKey: 'settings.ninetyDays' },
    { value: 180, labelKey: 'settings.oneEightyDays' },
    { value: 365, labelKey: 'settings.threeSixtyFiveDays' },
  ] as const;
  const [retentionDays, setRetentionDays] = useState(() => {
    try {
      const v = localStorage.getItem(RETENTION_KEY);
      if (v) return Number(v);
    } catch { /* ignore */ }
    return 0;
  });

  // ── Notifications state ──
  const NOTIF_KEY = 'superflux_notifications_enabled';
  const [notificationsEnabled, setNotificationsEnabled] = useState(() => {
    try { return localStorage.getItem(NOTIF_KEY) !== 'false'; }
    catch { return true; }
  });

  // ── RSSHub state ──
  const [rsshubInstance, setRsshubInstance] = useState(getRSSHubInstance);

  // ── Storage mode state ──
  const STORAGE_MODE_KEY = 'superflux_storage_mode';
  type StorageMode = 'cloud' | 'local';
  const [storageMode, setStorageMode] = useState<StorageMode>(
    () => (localStorage.getItem(STORAGE_MODE_KEY) as StorageMode) || 'cloud'
  );
  const importDataRef = useRef<HTMLInputElement>(null);

  const handleStorageModeChange = useCallback((mode: StorageMode) => {
    setStorageMode(mode);
    localStorage.setItem(STORAGE_MODE_KEY, mode);
    if (mode === 'cloud' && user) {
      // Re-trigger fullSync when switching back to cloud
      import('../services/syncService').then(({ SyncService }) => {
        SyncService.fullSync().catch(err => console.error('[settings] fullSync after cloud switch failed', err));
      });
    }
  }, [user]);

  const handleExportData = useCallback(async () => {
    const data: Record<string, string> = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('superflux_')) {
        data[key] = localStorage.getItem(key) ?? '';
      }
    }
    const payload = JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), data }, null, 2);
    const defaultName = `superflux-export-${new Date().toISOString().slice(0, 10)}.json`;
    await invoke('save_file_dialog', { content: payload, defaultName });
  }, []);

  const handleImportData = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = '';
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const json = JSON.parse(reader.result as string);
        if (!json.version || !json.data || typeof json.data !== 'object') {
          alert(t('settings.invalidFileFormat'));
          return;
        }
        for (const [key, value] of Object.entries(json.data)) {
          localStorage.setItem(key, value as string);
        }
        window.location.reload();
      } catch {
        alert(t('settings.jsonReadError'));
      }
    };
    reader.readAsText(file);
  }, []);

  const handleTtsEngineChange = useCallback((engine: TtsEngine) => {
    const updated = { ...ttsConfig, engine };
    setTtsConfig(updated);
    saveTtsConfig(updated);
  }, [ttsConfig]);

  const handleTtsRateChange = useCallback((rate: number) => {
    const updated = { ...ttsConfig, rate };
    setTtsConfig(updated);
    saveTtsConfig(updated);
  }, [ttsConfig]);

  const handleTtsFieldChange = useCallback((field: keyof TtsConfig, value: string) => {
    const updated = { ...ttsConfig, [field]: value };
    setTtsConfig(updated);
    saveTtsConfig(updated);
  }, [ttsConfig]);

  const handleTtsTest = useCallback(async () => {
    setTtsTestStatus('playing');
    setTtsError(null);
    try {
      await ttsSpeak(t('settings.ttsTestSentence'), () => setTtsTestStatus('idle'));
    } catch (e) {
      setTtsTestStatus('idle');
      setTtsError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  const handleTtsTestStop = useCallback(() => {
    ttsStop();
    setTtsTestStatus('idle');
  }, []);

  // ── Appearance state ──
  const [windowEffect, setWindowEffect] = useState<WindowEffect>(getStoredEffect);
  const [windowOpacity, setWindowOpacity] = useState(getStoredOpacity);

  // ── Provider state ──
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(() => getProviderConfig());
  const [providerType, setProviderType] = useState<ProviderType | null>(() => providerConfig?.type ?? null);
  const [providerBaseUrl, setProviderBaseUrl] = useState(() => providerConfig?.baseUrl ?? '');
  const [providerApiKey, setProviderApiKey] = useState(() => providerConfig?.credentials.apiKey ?? '');
  const [providerUsername, setProviderUsername] = useState(() => providerConfig?.credentials.username ?? '');
  const [providerPassword, setProviderPassword] = useState(() => providerConfig?.credentials.password ?? '');
  const [providerSyncEnabled, setProviderSyncEnabled] = useState(() => providerConfig?.syncEnabled ?? true);
  const [providerTestStatus, setProviderTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [providerImportStatus, setProviderImportStatus] = useState<string | null>(null);
  const [providerImporting, setProviderImporting] = useState(false);

  // Apply window effect on mount (restore saved settings)
  useEffect(() => {
    applyWindowEffect(windowEffect, windowOpacity);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleEffectChange = useCallback((effect: WindowEffect) => {
    setWindowEffect(effect);
    localStorage.setItem('superflux_window_effect', effect);
    applyWindowEffect(effect, windowOpacity);
  }, [windowOpacity]);

  const handleOpacityChange = useCallback((opacity: number) => {
    setWindowOpacity(opacity);
    localStorage.setItem('superflux_window_opacity', String(opacity));
    applyWindowEffect(windowEffect, opacity);
  }, [windowEffect]);

  const refreshOllamaStatus = useCallback(() => {
    checkOllamaStatus(llmConfig.ollamaUrl).then(setOllamaStatus);
  }, [llmConfig.ollamaUrl]);

  useEffect(() => {
    if (!isOpen) return;
    refreshOllamaStatus();
  }, [isOpen, refreshOllamaStatus]);

  const handlePullModel = useCallback(async (model: string) => {
    setPullState('pulling');
    setPullProgress(null);
    setPullError('');
    try {
      await pullOllamaModel(model, llmConfig.ollamaUrl, (progress) => {
        setPullProgress(progress);
      });
      setPullState('done');
      // Refresh models list and auto-select
      const status = await checkOllamaStatus(llmConfig.ollamaUrl);
      setOllamaStatus(status);
      const updated = { ...llmConfig, ollamaModel: model };
      setLlmConfig(updated);
      saveLLMConfig(updated);
    } catch (e) {
      setPullError(e instanceof Error ? e.message : t('common.unknownError'));
      setPullState('error');
    }
  }, [llmConfig]);

  // ── Provider helpers ──

  const buildProviderConfig = useCallback((): ProviderConfig | null => {
    if (!providerType) return null;
    return {
      type: providerType,
      baseUrl: providerBaseUrl,
      credentials: {
        apiKey: providerApiKey || undefined,
        username: providerUsername || undefined,
        password: providerPassword || undefined,
      },
      syncEnabled: providerSyncEnabled,
    };
  }, [providerType, providerBaseUrl, providerApiKey, providerUsername, providerPassword, providerSyncEnabled]);

  const handleProviderTest = useCallback(async () => {
    const config = buildProviderConfig();
    if (!config) return;
    setProviderTestStatus('testing');
    try {
      const provider = createProvider(config);
      const ok = await provider.testConnection();
      setProviderTestStatus(ok ? 'success' : 'error');
    } catch {
      setProviderTestStatus('error');
    }
  }, [buildProviderConfig]);

  const handleProviderConnect = useCallback(async () => {
    const config = buildProviderConfig();
    if (!config) return;
    setProviderImporting(true);
    setProviderImportStatus(null);
    try {
      saveProviderConfig(config);
      setProviderConfig(config);
      const added = await ProviderSyncService.importFeeds(config);
      setProviderImportStatus(t('settings.feedsImported', { count: added }));
    } catch (e) {
      setProviderImportStatus(`${t('common.error')} : ${e instanceof Error ? e.message : t('common.unknownError')}`);
    } finally {
      setProviderImporting(false);
    }
  }, [buildProviderConfig]);

  const handleProviderDisconnect = useCallback(() => {
    clearProviderConfig();
    setProviderConfig(null);
    setProviderType(null);
    setProviderBaseUrl('');
    setProviderApiKey('');
    setProviderUsername('');
    setProviderPassword('');
    setProviderSyncEnabled(true);
    setProviderTestStatus('idle');
    setProviderImportStatus(null);
  }, []);

  const handleProviderSyncToggle = useCallback((enabled: boolean) => {
    setProviderSyncEnabled(enabled);
    if (providerConfig) {
      const updated = { ...providerConfig, syncEnabled: enabled };
      saveProviderConfig(updated);
      setProviderConfig(updated);
    }
  }, [providerConfig]);

  const handleProviderTypeSelect = useCallback((type: ProviderType) => {
    setProviderType(type);
    setProviderTestStatus('idle');
    setProviderImportStatus(null);
    // Reset fields
    setProviderBaseUrl('');
    setProviderApiKey('');
    setProviderUsername('');
    setProviderPassword('');
  }, []);

  const handleFile = async (file: File) => {
    setError(null);
    setImportResult(null);

    if (!file.name.endsWith('.opml') && !file.name.endsWith('.xml')) {
      setError(t('settings.unsupportedFormat'));
      return;
    }

    try {
      const text = await file.text();
      const opmlFeeds = parseOpml(text);

      if (opmlFeeds.length === 0) {
        setError(t('settings.noFeedsInOpml'));
        return;
      }

      const feedsToImport = opmlFeeds.map(f => ({
        url: f.xmlUrl,
        name: f.title,
        source: detectSource(f),
      }));

      // Pro gate: check if import would exceed feed limit
      if (!isPro && feedCount + feedsToImport.length > PRO_LIMITS.maxFeeds) {
        showUpgradeModal();
        return;
      }

      const added = onImportOpml(feedsToImport);
      setImportResult({
        added,
        skipped: feedsToImport.length - added,
        total: feedsToImport.length,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.fileReadError'));
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
    // Reset so same file can be re-selected
    e.target.value = '';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  const handleClose = () => {
    setError(null);
    setImportResult(null);
    setIsDragging(false);
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="modal-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={handleBackdropClick}
        >
          <motion.div
            className="modal-content"
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <div className="modal-header">
              <h2 className="modal-title">{t('common.settings')}</h2>
              <button className="modal-close" onClick={handleClose}>×</button>
            </div>

            <div className="settings-body">
              {isConfigured && (
                <div className="settings-section">
                  <h3 className="settings-section-title">{t('settings.account')}</h3>
                  {user ? (
                    <div className="settings-account">
                      <div className="settings-account-info">
                        <span className="settings-account-email">{user.email}</span>
                        <span className="settings-account-status">{t('settings.connectedCloudSync')}</span>
                      </div>
                      <button
                        className="btn-secondary"
                        onClick={() => { signOut(); }}
                      >
                        {t('settings.signOut')}
                      </button>
                    </div>
                  ) : (
                    <div className="settings-account">
                      <p className="settings-section-desc">
                        {t('settings.signInDesc')}
                      </p>
                      <button
                        className="btn-primary"
                        onClick={() => setAuthOpen(true)}
                      >
                        {t('settings.signIn')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* ── Superflux Pro ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">Superflux Pro</h3>
                {isPro ? (
                  <div className="settings-account">
                    <div className="settings-account-info">
                      <div className="settings-ollama-status">
                        <span className="ollama-status-dot connected" />
                        <span className="ollama-status-text">{t('settings.proActive')}</span>
                      </div>
                    </div>
                    <button className="btn-secondary" onClick={handleProDeactivate}>
                      {t('settings.deactivate')}
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="settings-section-desc">
                      {t('settings.proDesc')}
                    </p>
                    <div className="provider-actions" style={{ marginTop: 8 }}>
                      <button
                        className="btn-primary"
                        onClick={showUpgradeModal}
                      >
                        {t('settings.upgradeToPro')}
                      </button>
                    </div>
                  </>
                )}
              </div>

              {/* ── Langue ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.language')}</h3>
                <p className="settings-section-desc">{t('settings.languageDesc')}</p>
                <div className="settings-format-toggle">
                  {([
                    ['en', 'English'],
                    ['fr', 'Français'],
                  ] as [string, string][]).map(([code, label]) => (
                    <button
                      key={code}
                      className={`format-option ${getLanguage() === code ? 'active' : ''}`}
                      onClick={() => setLanguage(code)}
                    >
                      <span className="format-option-label">{label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Apparence ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.appearance')}</h3>
                <p className="settings-section-desc">
                  {t('settings.appearanceDesc')}
                </p>

                <label className="settings-label">{t('settings.windowEffect')}</label>
                <div className="settings-format-toggle">
                  {([
                    ['none', t('settings.none')],
                    ['mica', 'Mica'],
                    ['acrylic', 'Acrylic'],
                    ['blur', 'Blur'],
                    ['tabbed', 'Tabbed'],
                  ] as [WindowEffect, string][]).map(([value, label]) => (
                    <button
                      key={value}
                      className={`format-option ${windowEffect === value ? 'active' : ''}`}
                      onClick={() => handleEffectChange(value)}
                    >
                      <span className="format-option-label">{label}</span>
                    </button>
                  ))}
                </div>

                {windowEffect !== 'none' && (
                  <>
                    <label className="settings-label" style={{ marginTop: 12 }}>
                      {t('settings.backgroundOpacity')}
                    </label>
                    <div className="settings-opacity-slider">
                      <input
                        type="range"
                        min={1}
                        max={100}
                        value={windowOpacity}
                        onChange={(e) => handleOpacityChange(Number(e.target.value))}
                      />
                      <span className="settings-opacity-value">{windowOpacity}%</span>
                    </div>
                  </>
                )}

                <label className="settings-label" style={{ marginTop: 12 }}>{t('settings.colorPalette')}</label>
                <PalettePickerInline />

                <label className="settings-label" style={{ marginTop: 12 }}>{t('settings.sysInfoTitleBar')}</label>
                <div className="settings-format-toggle">
                  <button
                    className={`format-option ${showSysInfo ? 'active' : ''}`}
                    onClick={() => onShowSysInfoChange?.(true)}
                  >
                    <span className="format-option-label">{t('settings.enabled')}</span>
                  </button>
                  <button
                    className={`format-option ${!showSysInfo ? 'active' : ''}`}
                    onClick={() => onShowSysInfoChange?.(false)}
                  >
                    <span className="format-option-label">{t('settings.disabled')}</span>
                  </button>
                </div>
              </div>

              {/* ── Synchronisation ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.synchronization')}</h3>
                <p className="settings-section-desc">
                  {t('settings.syncDesc')}
                </p>

                <label className="settings-label">{t('settings.syncInterval')}</label>
                <select
                  className="provider-input"
                  value={syncIntervalMs}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSyncIntervalMs(v);
                    localStorage.setItem(SYNC_INTERVAL_KEY, String(v));
                    onSyncIntervalChange?.(v);
                  }}
                >
                  {SYNC_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                  ))}
                </select>
              </div>

              {/* ── Stockage ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.storage')}</h3>
                <p className="settings-section-desc">
                  {t('settings.storageDesc')}
                </p>

                <div className="settings-format-toggle">
                  <button
                    className={`format-option ${storageMode === 'cloud' ? 'active' : ''}`}
                    onClick={() => handleStorageModeChange('cloud')}
                  >
                    <span className="format-option-icon">☁</span>
                    <span className="format-option-label">Cloud</span>
                  </button>
                  <button
                    className={`format-option ${storageMode === 'local' ? 'active' : ''}`}
                    onClick={() => handleStorageModeChange('local')}
                  >
                    <span className="format-option-icon">⌂</span>
                    <span className="format-option-label">Local</span>
                  </button>
                </div>

                <p className="settings-section-desc" style={{ marginTop: 8, fontSize: '11px', opacity: 0.7 }}>
                  {storageMode === 'cloud'
                    ? t('settings.dataCloudSync')
                    : t('settings.dataLocalOnly')}
                </p>

                {storageMode === 'local' && (
                  <div className="provider-actions" style={{ marginTop: 8, gap: 8 }}>
                    <button className="btn-secondary" onClick={handleExportData}>
                      {t('settings.exportJson')}
                    </button>
                    <button className="btn-secondary" onClick={() => importDataRef.current?.click()}>
                      {t('settings.importJson')}
                    </button>
                    <input
                      ref={importDataRef}
                      type="file"
                      accept=".json"
                      onChange={handleImportData}
                      style={{ display: 'none' }}
                    />
                  </div>
                )}
              </div>

              {/* ── Nettoyage ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.cleanup')}</h3>
                <p className="settings-section-desc">
                  {t('settings.cleanupDesc')}
                </p>

                <label className="settings-label">{t('settings.articleRetention')}</label>
                <select
                  className="provider-input"
                  value={retentionDays}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setRetentionDays(v);
                    localStorage.setItem(RETENTION_KEY, String(v));
                  }}
                >
                  {RETENTION_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{t(o.labelKey)}</option>
                  ))}
                </select>
              </div>

              {/* ── Notifications ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.notifications')}</h3>
                <p className="settings-section-desc">
                  {t('settings.notificationsDesc')}
                </p>

                <label className="settings-label">{t('settings.globalNotifications')}</label>
                <div className="settings-format-toggle">
                  <button
                    className={`format-option ${notificationsEnabled ? 'active' : ''}`}
                    onClick={() => {
                      setNotificationsEnabled(true);
                      localStorage.setItem(NOTIF_KEY, 'true');
                    }}
                  >
                    <span className="format-option-label">{t('settings.enabled')}</span>
                  </button>
                  <button
                    className={`format-option ${!notificationsEnabled ? 'active' : ''}`}
                    onClick={() => {
                      setNotificationsEnabled(false);
                      localStorage.setItem(NOTIF_KEY, 'false');
                    }}
                  >
                    <span className="format-option-label">{t('settings.disabled')}</span>
                  </button>
                </div>
                <p className="settings-section-desc" style={{ marginTop: 8, fontSize: '11px', opacity: 0.7 }}>
                  {t('settings.notificationsHint')}
                </p>
              </div>

              {/* ── RSSHub ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">RSSHub</h3>
                <p className="settings-section-desc">
                  {t('settings.rsshubDesc')}
                </p>
                <div className="settings-row">
                  <label className="settings-label" htmlFor="rsshub-instance">Instance URL</label>
                  <input
                    id="rsshub-instance"
                    type="text"
                    className="form-input"
                    style={{ width: '100%', marginTop: 4 }}
                    placeholder="https://rsshub.app"
                    value={rsshubInstance}
                    onChange={(e) => {
                      setRsshubInstance(e.target.value);
                      setRSSHubInstanceConfig(e.target.value);
                    }}
                  />
                </div>
              </div>

              {/* ── Fournisseur RSS ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.rssProvider')}</h3>
                <p className="settings-section-desc">
                  {t('settings.rssProviderDesc')}
                </p>

                {providerConfig ? (
                  /* Connected state */
                  <div className="provider-connected">
                    <div className="settings-account">
                      <div className="settings-account-info">
                        <span className="settings-account-email">
                          {providerConfig.type.charAt(0).toUpperCase() + providerConfig.type.slice(1)}
                        </span>
                        <span className="settings-account-status">
                          {t('settings.connected')} — {providerConfig.baseUrl || 'api.feedbin.com'}
                        </span>
                      </div>
                      <button className="btn-secondary" onClick={handleProviderDisconnect}>
                        {t('settings.disconnect')}
                      </button>
                    </div>

                    <div className="provider-sync-toggle">
                      <label className="settings-label">{t('settings.autoSyncStatuses')}</label>
                      <div className="settings-format-toggle">
                        <button
                          className={`format-option ${providerSyncEnabled ? 'active' : ''}`}
                          onClick={() => handleProviderSyncToggle(true)}
                        >
                          <span className="format-option-label">{t('settings.enabled')}</span>
                        </button>
                        <button
                          className={`format-option ${!providerSyncEnabled ? 'active' : ''}`}
                          onClick={() => handleProviderSyncToggle(false)}
                        >
                          <span className="format-option-label">{t('settings.disabled')}</span>
                        </button>
                      </div>
                    </div>

                    {providerImportStatus && (
                      <div className="settings-ollama-status" style={{ marginTop: 8 }}>
                        <span className={`ollama-status-dot ${providerImportStatus.startsWith(t('common.error')) ? 'disconnected' : 'connected'}`} />
                        <span className="ollama-status-text">{providerImportStatus}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Setup state */
                  <>
                    <label className="settings-label">{t('settings.provider')}</label>
                    <div className="settings-format-toggle">
                      {(['miniflux', 'freshrss', 'feedbin', 'bazqux'] as ProviderType[]).map(type => (
                        <button
                          key={type}
                          className={`format-option ${providerType === type ? 'active' : ''}`}
                          onClick={() => handleProviderTypeSelect(type)}
                        >
                          <span className="format-option-label">
                            {type === 'miniflux' ? 'Miniflux' :
                             type === 'freshrss' ? 'FreshRSS' :
                             type === 'feedbin' ? 'Feedbin' : 'BazQux'}
                          </span>
                        </button>
                      ))}
                      <button className="format-option" disabled style={{ opacity: 0.4, cursor: 'not-allowed' }}>
                        <span className="format-option-label">Folo</span>
                      </button>
                    </div>

                    {providerType && (
                      <div className="provider-form" style={{ marginTop: 12 }}>
                        {/* URL field for Miniflux and FreshRSS */}
                        {(providerType === 'miniflux' || providerType === 'freshrss') && (
                          <>
                            <label className="settings-label">{t('settings.serverUrl')}</label>
                            <input
                              type="url"
                              className="provider-input"
                              placeholder={providerType === 'miniflux' ? 'https://miniflux.example.com' : 'https://freshrss.example.com'}
                              value={providerBaseUrl}
                              onChange={e => setProviderBaseUrl(e.target.value)}
                            />
                          </>
                        )}

                        {/* API Key for Miniflux */}
                        {providerType === 'miniflux' && (
                          <>
                            <label className="settings-label">{t('settings.apiKey')}</label>
                            <input
                              type="password"
                              className="provider-input"
                              placeholder={t('settings.apiKeyPlaceholder')}
                              value={providerApiKey}
                              onChange={e => setProviderApiKey(e.target.value)}
                            />
                          </>
                        )}

                        {/* Username + Password for FreshRSS, Feedbin, BazQux */}
                        {(providerType === 'freshrss' || providerType === 'feedbin' || providerType === 'bazqux') && (
                          <>
                            <label className="settings-label">
                              {providerType === 'feedbin' ? 'Email' : t('settings.username')}
                            </label>
                            <input
                              type="text"
                              className="provider-input"
                              placeholder={providerType === 'feedbin' ? 'email@example.com' : t('settings.usernamePlaceholder')}
                              value={providerUsername}
                              onChange={e => setProviderUsername(e.target.value)}
                            />
                            <label className="settings-label">{t('settings.password')}</label>
                            <input
                              type="password"
                              className="provider-input"
                              placeholder={t('settings.password')}
                              value={providerPassword}
                              onChange={e => setProviderPassword(e.target.value)}
                            />
                          </>
                        )}

                        <div className="provider-actions">
                          <button
                            className="btn-secondary"
                            onClick={handleProviderTest}
                            disabled={providerTestStatus === 'testing'}
                          >
                            {providerTestStatus === 'testing' ? t('settings.testing') : t('settings.testConnection')}
                          </button>
                          <button
                            className="btn-primary"
                            onClick={handleProviderConnect}
                            disabled={providerImporting}
                          >
                            {providerImporting ? t('settings.importing') : t('settings.importSubscriptions')}
                          </button>
                        </div>

                        {providerTestStatus === 'success' && (
                          <div className="settings-ollama-status">
                            <span className="ollama-status-dot connected" />
                            <span className="ollama-status-text">{t('settings.connectionSuccess')}</span>
                          </div>
                        )}
                        {providerTestStatus === 'error' && (
                          <div className="settings-ollama-status">
                            <span className="ollama-status-dot disconnected" />
                            <span className="ollama-status-text">{t('settings.connectionFailed')}</span>
                          </div>
                        )}
                        {providerImportStatus && (
                          <div className="settings-ollama-status">
                            <span className={`ollama-status-dot ${providerImportStatus.startsWith(t('common.error')) ? 'disconnected' : 'connected'}`} />
                            <span className="ollama-status-text">{providerImportStatus}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.aiSummaries')}</h3>
                <p className="settings-section-desc">
                  {t('settings.aiSummariesDesc')}
                </p>

                <label className="settings-label">{t('settings.provider')}</label>
                <div className="settings-format-toggle">
                  <button
                    className={`format-option ${llmConfig.provider === 'ollama' ? 'active' : ''}`}
                    onClick={() => {
                      const updated = { ...llmConfig, provider: 'ollama' as const };
                      setLlmConfig(updated);
                      saveLLMConfig(updated);
                    }}
                  >
                    <span className="format-option-icon">⌂</span>
                    <span className="format-option-label">Ollama (local)</span>
                  </button>
                  <button
                    className={`format-option ${llmConfig.provider === 'cloud' ? 'active' : ''}`}
                    onClick={() => {
                      const updated = { ...llmConfig, provider: 'cloud' as const };
                      setLlmConfig(updated);
                      saveLLMConfig(updated);
                    }}
                  >
                    <span className="format-option-icon">☁</span>
                    <span className="format-option-label">Cloud</span>
                  </button>
                </div>

                {llmConfig.provider === 'ollama' && (
                  <div className="settings-ollama-block">
                    {ollamaStatus.available ? (
                      <>
                        <div className="settings-ollama-status">
                          <span className="ollama-status-dot connected" />
                          <span className="ollama-status-text">{t('settings.ollamaConnected')}</span>
                          {ollamaStatus.models.length > 0 && (
                            <select
                              className="ollama-model-select"
                              value={llmConfig.ollamaModel}
                              onChange={(e) => {
                                const updated = { ...llmConfig, ollamaModel: e.target.value };
                                setLlmConfig(updated);
                                saveLLMConfig(updated);
                              }}
                            >
                              {ollamaStatus.models.map(m => (
                                <option key={m} value={m}>{m}</option>
                              ))}
                            </select>
                          )}
                        </div>
                        {ollamaStatus.models.length === 0 && (
                          <div className="ollama-setup-card">
                            <p className="ollama-setup-text">{t('settings.noModelsInstalled')}</p>
                            <button
                              className="ollama-setup-btn"
                              onClick={() => handlePullModel('llama3.2:3b')}
                              disabled={pullState === 'pulling'}
                            >
                              {t('settings.installModel', { model: 'llama3.2:3b', size: '2 GB' })}
                            </button>
                          </div>
                        )}
                        {ollamaStatus.models.length > 0 && !ollamaStatus.models.some(m => m.startsWith('llama3.2')) && (
                          <div className="ollama-setup-card">
                            <button
                              className="ollama-setup-btn secondary"
                              onClick={() => handlePullModel('llama3.2:3b')}
                              disabled={pullState === 'pulling'}
                            >
                              + {t('settings.installModelRecommended', { model: 'llama3.2:3b' })}
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="ollama-setup-card">
                        <div className="settings-ollama-status">
                          <span className="ollama-status-dot disconnected" />
                          <span className="ollama-status-text">{t('settings.ollamaNotDetected')}</span>
                        </div>
                        <p className="ollama-setup-text">
                          {t('settings.ollamaDesc')}
                        </p>
                        <div className="ollama-setup-actions">
                          <button
                            className="ollama-setup-btn"
                            onClick={() => openExternal('https://ollama.com/download')}
                          >
                            {t('settings.downloadOllama')}
                          </button>
                          <button
                            className="ollama-setup-btn secondary"
                            onClick={refreshOllamaStatus}
                          >
                            {t('settings.checkConnection')}
                          </button>
                        </div>
                        <p className="ollama-setup-hint">
                          {t('settings.ollamaHint')}
                        </p>
                      </div>
                    )}

                    {/* Pull progress */}
                    {pullState === 'pulling' && pullProgress && (
                      <div className="ollama-pull-progress">
                        <div className="ollama-pull-status">{pullProgress.status}</div>
                        {pullProgress.percent > 0 && (
                          <div className="ollama-pull-bar">
                            <div
                              className="ollama-pull-bar-fill"
                              style={{ width: `${pullProgress.percent}%` }}
                            />
                          </div>
                        )}
                        {pullProgress.percent > 0 && (
                          <span className="ollama-pull-percent">{Math.round(pullProgress.percent)}%</span>
                        )}
                      </div>
                    )}
                    {pullState === 'done' && (
                      <div className="settings-ollama-status">
                        <span className="ollama-status-dot connected" />
                        <span className="ollama-status-text">{t('settings.modelInstalledSuccess')}</span>
                      </div>
                    )}
                    {pullState === 'error' && (
                      <div className="settings-ollama-status">
                        <span className="ollama-status-dot disconnected" />
                        <span className="ollama-status-text">{pullError}</span>
                      </div>
                    )}
                  </div>
                )}

                {llmConfig.provider === 'cloud' && (
                  <div className="settings-ollama-status" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '4px' }}>
                    {!llmConfig.groqApiKey && !llmConfig.mistralApiKey && !llmConfig.geminiApiKey ? (
                      <>
                        <span className="ollama-status-dot disconnected" />
                        <span className="ollama-status-text">
                          {t('settings.noCloudApiKey')}
                        </span>
                      </>
                    ) : (
                      <span className="ollama-status-text" style={{ fontSize: '11px', opacity: 0.7 }}>
                        Failover: {[
                          llmConfig.groqApiKey && 'Groq',
                          llmConfig.mistralApiKey && 'Mistral',
                          llmConfig.geminiApiKey && 'Gemini',
                        ].filter(Boolean).join(' → ')}
                      </span>
                    )}
                  </div>
                )}

                <label className="settings-label" style={{ marginTop: '12px' }}>{t('settings.summaryFormat')}</label>
                <div className="settings-format-toggle">
                  <button
                    className={`format-option ${summaryFormat === 'bullets' ? 'active' : ''}`}
                    onClick={() => {
                      setSummaryFormat('bullets');
                      localStorage.setItem('superflux_summary_format', 'bullets');
                    }}
                  >
                    <span className="format-option-icon">•</span>
                    <span className="format-option-label">{t('settings.keyPoints')}</span>
                  </button>
                  <button
                    className={`format-option ${summaryFormat === 'paragraph' ? 'active' : ''}`}
                    onClick={() => {
                      setSummaryFormat('paragraph');
                      localStorage.setItem('superflux_summary_format', 'paragraph');
                    }}
                  >
                    <span className="format-option-icon">¶</span>
                    <span className="format-option-label">{t('settings.paragraph')}</span>
                  </button>
                </div>

              </div>

              {/* ── Lecture vocale ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.textToSpeech')}</h3>
                <p className="settings-section-desc">
                  {t('settings.ttsDesc')}
                </p>

                <label className="settings-label">{t('settings.engine')}</label>
                <div className="settings-format-toggle">
                  <button
                    className={`format-option ${ttsConfig.engine === 'browser' ? 'active' : ''}`}
                    onClick={() => handleTtsEngineChange('browser')}
                  >
                    <span className="format-option-icon">◎</span>
                    <span className="format-option-label">{t('settings.browser')}</span>
                  </button>
                  <button
                    className={`format-option ${ttsConfig.engine === 'native' ? 'active' : ''}`}
                    onClick={() => handleTtsEngineChange('native')}
                  >
                    <span className="format-option-icon">⌂</span>
                    <span className="format-option-label">{t('settings.native')}</span>
                  </button>
                  <button
                    className={`format-option ${ttsConfig.engine === 'elevenlabs' ? 'active' : ''}`}
                    onClick={isPro ? () => handleTtsEngineChange('elevenlabs') : showUpgradeModal}
                  >
                    <span className="format-option-icon">{isPro ? '☁' : '🔒'}</span>
                    <span className="format-option-label">ElevenLabs{!isPro ? ' (Pro)' : ''}</span>
                  </button>
                </div>

                {(ttsConfig.engine === 'browser' || ttsConfig.engine === 'native') && (
                  <>
                    <label className="settings-label" style={{ marginTop: 12 }}>
                      {t('settings.readingSpeed')}
                    </label>
                    <div className="settings-opacity-slider">
                      <input
                        type="range"
                        min={0.5}
                        max={2}
                        step={0.1}
                        value={ttsConfig.rate}
                        onChange={(e) => handleTtsRateChange(Number(e.target.value))}
                      />
                      <span className="settings-opacity-value">{ttsConfig.rate.toFixed(1)}x</span>
                    </div>
                  </>
                )}

                {ttsConfig.engine === 'elevenlabs' && (
                  <div className="provider-form" style={{ marginTop: 12 }}>
                    <label className="settings-label">Voice ID</label>
                    <input
                      type="text"
                      className="provider-input"
                      placeholder="21m00Tcm4TlvDq8ikWAM (Rachel)"
                      value={ttsConfig.elevenLabsVoiceId}
                      onChange={(e) => handleTtsFieldChange('elevenLabsVoiceId', e.target.value)}
                    />
                    <label className="settings-label">{t('settings.model')}</label>
                    <input
                      type="text"
                      className="provider-input"
                      placeholder="eleven_multilingual_v2"
                      value={ttsConfig.elevenLabsModelId}
                      onChange={(e) => handleTtsFieldChange('elevenLabsModelId', e.target.value)}
                    />
                  </div>
                )}

                <div className="provider-actions" style={{ marginTop: 12 }}>
                  {ttsTestStatus === 'idle' ? (
                    <button className="btn-secondary" onClick={handleTtsTest}>
                      {t('settings.test')}
                    </button>
                  ) : (
                    <button className="btn-secondary" onClick={handleTtsTestStop}>
                      {t('settings.stopTest')}
                    </button>
                  )}
                </div>
                {ttsError && (
                  <div className="settings-ollama-status">
                    <span className="ollama-status-dot disconnected" />
                    <span className="ollama-status-text">{ttsError}</span>
                  </div>
                )}
              </div>

              {/* ── Traduction ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.translation')}</h3>
                <p className="settings-section-desc">
                  {t('settings.translationDesc')}
                </p>

                <label className="settings-label">{t('settings.targetLanguage')}</label>
                <select
                  className="provider-input"
                  value={translationLang}
                  onChange={(e) => {
                    setTranslationLang(e.target.value);
                    saveTranslationConfig({ targetLanguage: e.target.value });
                  }}
                >
                  {LANGUAGES.map(l => (
                    <option key={l.code} value={l.code}>{l.label}</option>
                  ))}
                </select>
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">{t('settings.importFeeds')}</h3>
                <p className="settings-section-desc">
                  {t('settings.importFeedsDesc')}
                </p>

                <div
                  className={`opml-dropzone ${isDragging ? 'dragging' : ''}`}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".opml,.xml"
                    onChange={handleFileChange}
                    className="opml-file-input"
                  />
                  <span className="opml-dropzone-icon">📂</span>
                  <span className="opml-dropzone-text">
                    {t('settings.dropOpmlHere')}
                  </span>
                  <span className="opml-dropzone-hint">
                    {t('settings.orClickToBrowse')}
                  </span>
                </div>

                {error && (
                  <motion.div
                    className="form-error"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    {error}
                  </motion.div>
                )}

                {importResult && (
                  <motion.div
                    className="opml-result"
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                  >
                    <span className="opml-result-icon">✓</span>
                    <div className="opml-result-text">
                      <strong>{importResult.added}</strong> {t('settings.feedsImported', { count: importResult.added })}
                      {importResult.skipped > 0 && (
                        <span className="opml-result-skipped">
                          {' '}({t('settings.alreadyExisting', { count: importResult.skipped })})
                        </span>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={handleClose}>
                {t('common.close')}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </AnimatePresence>
  );
}
