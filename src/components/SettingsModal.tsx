import { useState, useRef, useEffect, useCallback } from 'react';
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
import { usePro } from '../contexts/ProContext';
import { LEMONSQUEEZY_CHECKOUT_URL, PRO_LIMITS } from '../services/licenseService';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportOpml: (feeds: { url: string; name: string; source: FeedSource }[]) => number;
  feedCount?: number;
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
    const isDark = document.documentElement.classList.contains('dark');
    const isSepia = document.documentElement.classList.contains('sepia');
    let r: number, g: number, b: number;
    if (isDark) { r = 20; g = 20; b = 20; }
    else if (isSepia) { r = 210; g = 195; b = 170; }
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
    throw new Error('Fichier OPML invalide');
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

export function SettingsModal({ isOpen, onClose, onImportOpml, feedCount = 0 }: SettingsModalProps) {
  const { user, signOut, isConfigured } = useAuth();
  const { isPro, licenseKey, activateLicense, deactivateLicense, showUpgradeModal } = usePro();
  const [proKeyInput, setProKeyInput] = useState('');
  const [proActivating, setProActivating] = useState(false);
  const [proError, setProError] = useState<string | null>(null);
  const [proSuccess, setProSuccess] = useState(false);

  const handleProActivate = useCallback(async () => {
    if (!proKeyInput.trim()) return;
    setProActivating(true);
    setProError(null);
    setProSuccess(false);
    const result = await activateLicense(proKeyInput.trim());
    if (result.success) {
      setProSuccess(true);
      setProKeyInput('');
    } else {
      setProError(result.error || 'Activation échouée');
    }
    setProActivating(false);
  }, [proKeyInput, activateLicense]);

  const handleProDeactivate = useCallback(async () => {
    await deactivateLicense();
    setProSuccess(false);
    setProError(null);
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
    try {
      await ttsSpeak('Bonjour, ceci est un test de lecture vocale.', () => setTtsTestStatus('idle'));
    } catch {
      setTtsTestStatus('idle');
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
      setPullError(e instanceof Error ? e.message : 'Erreur inconnue');
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
      setProviderImportStatus(`${added} flux importé${added > 1 ? 's' : ''} avec succès`);
    } catch (e) {
      setProviderImportStatus(`Erreur : ${e instanceof Error ? e.message : 'inconnue'}`);
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
      setError('Format non supporté. Utilisez un fichier .opml ou .xml');
      return;
    }

    try {
      const text = await file.text();
      const opmlFeeds = parseOpml(text);

      if (opmlFeeds.length === 0) {
        setError('Aucun flux trouvé dans le fichier OPML');
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
      setError(e instanceof Error ? e.message : 'Erreur lors de la lecture du fichier');
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
              <h2 className="modal-title">Paramètres</h2>
              <button className="modal-close" onClick={handleClose}>×</button>
            </div>

            <div className="settings-body">
              {isConfigured && (
                <div className="settings-section">
                  <h3 className="settings-section-title">Compte</h3>
                  {user ? (
                    <div className="settings-account">
                      <div className="settings-account-info">
                        <span className="settings-account-email">{user.email}</span>
                        <span className="settings-account-status">Connecté — synchronisation cloud active</span>
                      </div>
                      <button
                        className="btn-secondary"
                        onClick={() => { signOut(); }}
                      >
                        Se déconnecter
                      </button>
                    </div>
                  ) : (
                    <div className="settings-account">
                      <p className="settings-section-desc">
                        Connectez-vous pour synchroniser vos flux et préférences entre appareils.
                      </p>
                      <button
                        className="btn-primary"
                        onClick={() => setAuthOpen(true)}
                      >
                        Se connecter
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
                        <span className="ollama-status-text">Pro actif</span>
                      </div>
                      {licenseKey && (
                        <span className="settings-account-status">
                          Clé : {licenseKey.slice(0, 8)}{'••••••••'}
                        </span>
                      )}
                    </div>
                    <button className="btn-secondary" onClick={handleProDeactivate}>
                      Désactiver
                    </button>
                  </div>
                ) : (
                  <>
                    <p className="settings-section-desc">
                      Débloquez les résumés IA, plus de 50 flux et plus de 10 dossiers.
                    </p>
                    <div className="provider-form" style={{ marginTop: 8 }}>
                      <label className="settings-label">Clé de licence</label>
                      <input
                        type="text"
                        className="provider-input"
                        placeholder="Collez votre clé de licence..."
                        value={proKeyInput}
                        onChange={(e) => { setProKeyInput(e.target.value); setProError(null); setProSuccess(false); }}
                      />
                      <div className="provider-actions">
                        <button
                          className="btn-primary"
                          onClick={handleProActivate}
                          disabled={proActivating || !proKeyInput.trim()}
                        >
                          {proActivating ? 'Activation...' : 'Activer'}
                        </button>
                        <button
                          className="btn-secondary"
                          onClick={() => openExternal(LEMONSQUEEZY_CHECKOUT_URL)}
                        >
                          Acheter Pro
                        </button>
                      </div>
                      {proError && (
                        <div className="settings-ollama-status">
                          <span className="ollama-status-dot disconnected" />
                          <span className="ollama-status-text">{proError}</span>
                        </div>
                      )}
                      {proSuccess && (
                        <div className="settings-ollama-status">
                          <span className="ollama-status-dot connected" />
                          <span className="ollama-status-text">Licence activée avec succès</span>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              {/* ── Apparence ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">Apparence</h3>
                <p className="settings-section-desc">
                  Personnalisez l'effet de fenêtre et la transparence de l'interface.
                </p>

                <label className="settings-label">Effet de fenêtre</label>
                <div className="settings-format-toggle">
                  {([
                    ['none', 'Aucun'],
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
                      Opacité du fond
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
              </div>

              {/* ── Fournisseur RSS ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">Fournisseur RSS</h3>
                <p className="settings-section-desc">
                  Connectez un fournisseur RSS externe pour synchroniser vos abonnements et statuts.
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
                          Connecté — {providerConfig.baseUrl || 'api.feedbin.com'}
                        </span>
                      </div>
                      <button className="btn-secondary" onClick={handleProviderDisconnect}>
                        Déconnecter
                      </button>
                    </div>

                    <div className="provider-sync-toggle">
                      <label className="settings-label">Sync automatique des statuts</label>
                      <div className="settings-format-toggle">
                        <button
                          className={`format-option ${providerSyncEnabled ? 'active' : ''}`}
                          onClick={() => handleProviderSyncToggle(true)}
                        >
                          <span className="format-option-label">Activé</span>
                        </button>
                        <button
                          className={`format-option ${!providerSyncEnabled ? 'active' : ''}`}
                          onClick={() => handleProviderSyncToggle(false)}
                        >
                          <span className="format-option-label">Désactivé</span>
                        </button>
                      </div>
                    </div>

                    {providerImportStatus && (
                      <div className="settings-ollama-status" style={{ marginTop: 8 }}>
                        <span className={`ollama-status-dot ${providerImportStatus.startsWith('Erreur') ? 'disconnected' : 'connected'}`} />
                        <span className="ollama-status-text">{providerImportStatus}</span>
                      </div>
                    )}
                  </div>
                ) : (
                  /* Setup state */
                  <>
                    <label className="settings-label">Fournisseur</label>
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
                            <label className="settings-label">URL du serveur</label>
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
                            <label className="settings-label">Clé API</label>
                            <input
                              type="password"
                              className="provider-input"
                              placeholder="Votre clé API Miniflux"
                              value={providerApiKey}
                              onChange={e => setProviderApiKey(e.target.value)}
                            />
                          </>
                        )}

                        {/* Username + Password for FreshRSS, Feedbin, BazQux */}
                        {(providerType === 'freshrss' || providerType === 'feedbin' || providerType === 'bazqux') && (
                          <>
                            <label className="settings-label">
                              {providerType === 'feedbin' ? 'Email' : 'Identifiant'}
                            </label>
                            <input
                              type="text"
                              className="provider-input"
                              placeholder={providerType === 'feedbin' ? 'email@example.com' : 'Nom d\'utilisateur'}
                              value={providerUsername}
                              onChange={e => setProviderUsername(e.target.value)}
                            />
                            <label className="settings-label">Mot de passe</label>
                            <input
                              type="password"
                              className="provider-input"
                              placeholder="Mot de passe"
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
                            {providerTestStatus === 'testing' ? 'Test…' : 'Tester la connexion'}
                          </button>
                          <button
                            className="btn-primary"
                            onClick={handleProviderConnect}
                            disabled={providerImporting}
                          >
                            {providerImporting ? 'Import…' : 'Importer les abonnements'}
                          </button>
                        </div>

                        {providerTestStatus === 'success' && (
                          <div className="settings-ollama-status">
                            <span className="ollama-status-dot connected" />
                            <span className="ollama-status-text">Connexion réussie</span>
                          </div>
                        )}
                        {providerTestStatus === 'error' && (
                          <div className="settings-ollama-status">
                            <span className="ollama-status-dot disconnected" />
                            <span className="ollama-status-text">Échec de la connexion</span>
                          </div>
                        )}
                        {providerImportStatus && (
                          <div className="settings-ollama-status">
                            <span className={`ollama-status-dot ${providerImportStatus.startsWith('Erreur') ? 'disconnected' : 'connected'}`} />
                            <span className="ollama-status-text">{providerImportStatus}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">IA / Résumés</h3>
                <p className="settings-section-desc">
                  Choisissez le fournisseur et le format des résumés.
                </p>

                <label className="settings-label">Fournisseur</label>
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
                    className={`format-option ${llmConfig.provider === 'groq' ? 'active' : ''}`}
                    onClick={() => {
                      const updated = { ...llmConfig, provider: 'groq' as const };
                      setLlmConfig(updated);
                      saveLLMConfig(updated);
                    }}
                  >
                    <span className="format-option-icon">☁</span>
                    <span className="format-option-label">Groq (cloud)</span>
                  </button>
                </div>

                {llmConfig.provider === 'ollama' && (
                  <div className="settings-ollama-block">
                    {ollamaStatus.available ? (
                      <>
                        <div className="settings-ollama-status">
                          <span className="ollama-status-dot connected" />
                          <span className="ollama-status-text">Ollama connecté</span>
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
                            <p className="ollama-setup-text">Aucun modèle installé.</p>
                            <button
                              className="ollama-setup-btn"
                              onClick={() => handlePullModel('llama3.2:3b')}
                              disabled={pullState === 'pulling'}
                            >
                              Installer llama3.2:3b (2 GB)
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
                              + Installer llama3.2:3b (recommandé)
                            </button>
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="ollama-setup-card">
                        <div className="settings-ollama-status">
                          <span className="ollama-status-dot disconnected" />
                          <span className="ollama-status-text">Ollama non détecté</span>
                        </div>
                        <p className="ollama-setup-text">
                          Ollama permet d'exécuter des modèles IA localement, sans connexion internet et gratuitement.
                        </p>
                        <div className="ollama-setup-actions">
                          <button
                            className="ollama-setup-btn"
                            onClick={() => openExternal('https://ollama.com/download')}
                          >
                            Télécharger Ollama
                          </button>
                          <button
                            className="ollama-setup-btn secondary"
                            onClick={refreshOllamaStatus}
                          >
                            Vérifier la connexion
                          </button>
                        </div>
                        <p className="ollama-setup-hint">
                          Après installation, lancez <code>ollama serve</code> puis cliquez sur "Vérifier la connexion".
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
                        <span className="ollama-status-text">Modèle installé avec succès</span>
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

                {llmConfig.provider === 'groq' && !llmConfig.groqApiKey && (
                  <div className="settings-ollama-status">
                    <span className="ollama-status-dot disconnected" />
                    <span className="ollama-status-text">
                      Clé API manquante — ajoutez <code>VITE_GROQ_API_KEY</code> dans .env
                    </span>
                  </div>
                )}

                <label className="settings-label" style={{ marginTop: '12px' }}>Format du résumé</label>
                <div className="settings-format-toggle">
                  <button
                    className={`format-option ${summaryFormat === 'bullets' ? 'active' : ''}`}
                    onClick={() => {
                      setSummaryFormat('bullets');
                      localStorage.setItem('superflux_summary_format', 'bullets');
                    }}
                  >
                    <span className="format-option-icon">•</span>
                    <span className="format-option-label">Points clés</span>
                  </button>
                  <button
                    className={`format-option ${summaryFormat === 'paragraph' ? 'active' : ''}`}
                    onClick={() => {
                      setSummaryFormat('paragraph');
                      localStorage.setItem('superflux_summary_format', 'paragraph');
                    }}
                  >
                    <span className="format-option-icon">¶</span>
                    <span className="format-option-label">Paragraphe</span>
                  </button>
                </div>

              </div>

              {/* ── Lecture vocale ── */}
              <div className="settings-section">
                <h3 className="settings-section-title">Lecture vocale</h3>
                <p className="settings-section-desc">
                  Choisissez le moteur de synthèse vocale pour la lecture des articles.
                </p>

                <label className="settings-label">Moteur</label>
                <div className="settings-format-toggle">
                  <button
                    className={`format-option ${ttsConfig.engine === 'browser' ? 'active' : ''}`}
                    onClick={() => handleTtsEngineChange('browser')}
                  >
                    <span className="format-option-icon">◎</span>
                    <span className="format-option-label">Navigateur</span>
                  </button>
                  <button
                    className={`format-option ${ttsConfig.engine === 'native' ? 'active' : ''}`}
                    onClick={() => handleTtsEngineChange('native')}
                  >
                    <span className="format-option-icon">⌂</span>
                    <span className="format-option-label">Natif</span>
                  </button>
                  <button
                    className={`format-option ${ttsConfig.engine === 'elevenlabs' ? 'active' : ''}`}
                    onClick={() => handleTtsEngineChange('elevenlabs')}
                  >
                    <span className="format-option-icon">☁</span>
                    <span className="format-option-label">ElevenLabs</span>
                  </button>
                </div>

                {(ttsConfig.engine === 'browser' || ttsConfig.engine === 'native') && (
                  <>
                    <label className="settings-label" style={{ marginTop: 12 }}>
                      Vitesse de lecture
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
                    <label className="settings-label">Clé API ElevenLabs</label>
                    <input
                      type="password"
                      className="provider-input"
                      placeholder="Votre clé API ElevenLabs"
                      value={ttsConfig.elevenLabsApiKey}
                      onChange={(e) => handleTtsFieldChange('elevenLabsApiKey', e.target.value)}
                    />
                    <label className="settings-label">Voice ID</label>
                    <input
                      type="text"
                      className="provider-input"
                      placeholder="21m00Tcm4TlvDq8ikWAM (Rachel)"
                      value={ttsConfig.elevenLabsVoiceId}
                      onChange={(e) => handleTtsFieldChange('elevenLabsVoiceId', e.target.value)}
                    />
                    <label className="settings-label">Modèle</label>
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
                      Tester
                    </button>
                  ) : (
                    <button className="btn-secondary" onClick={handleTtsTestStop}>
                      Arrêter le test
                    </button>
                  )}
                </div>
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">Importer des flux</h3>
                <p className="settings-section-desc">
                  Importez vos abonnements depuis un fichier OPML exporté par un autre lecteur RSS.
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
                    Glissez un fichier OPML ici
                  </span>
                  <span className="opml-dropzone-hint">
                    ou cliquez pour parcourir
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
                      <strong>{importResult.added}</strong> flux importé{importResult.added > 1 ? 's' : ''}
                      {importResult.skipped > 0 && (
                        <span className="opml-result-skipped">
                          {' '}({importResult.skipped} déjà existant{importResult.skipped > 1 ? 's' : ''})
                        </span>
                      )}
                    </div>
                  </motion.div>
                )}
              </div>
            </div>

            <div className="modal-actions">
              <button type="button" className="btn-secondary" onClick={handleClose}>
                Fermer
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
      <AuthModal isOpen={authOpen} onClose={() => setAuthOpen(false)} />
    </AnimatePresence>
  );
}
