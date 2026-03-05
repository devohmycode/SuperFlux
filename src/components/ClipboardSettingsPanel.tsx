import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface ClipboardSettings {
  max_entries: number;
  retention_ms: number;
}

const CLICK_ACTION_KEY = 'superflux_clip_click_action';

const MAX_OPTIONS = [
  { value: 25, label: '25' },
  { value: 50, label: '50' },
  { value: 100, label: '100' },
  { value: 200, label: '200' },
  { value: 500, label: '500' },
  { value: 1000, label: '1 000' },
];

const RETENTION_OPTIONS = [
  { value: 0, label: 'Illimité' },
  { value: 1 * 60 * 60 * 1000, label: '1 heure' },
  { value: 6 * 60 * 60 * 1000, label: '6 heures' },
  { value: 24 * 60 * 60 * 1000, label: '24 heures' },
  { value: 3 * 24 * 60 * 60 * 1000, label: '3 jours' },
  { value: 7 * 24 * 60 * 60 * 1000, label: '7 jours' },
  { value: 30 * 24 * 60 * 60 * 1000, label: '30 jours' },
];

export type ClipClickAction = 'copy' | 'paste';

export function getClipClickAction(): ClipClickAction {
  try {
    const v = localStorage.getItem(CLICK_ACTION_KEY);
    return v === 'paste' ? 'paste' : 'copy';
  } catch { return 'copy'; }
}

export function ClipboardSettingsPanel() {
  const [maxEntries, setMaxEntries] = useState(200);
  const [retentionMs, setRetentionMs] = useState(0);
  const [clickAction, setClickAction] = useState<ClipClickAction>(getClipClickAction);

  useEffect(() => {
    invoke<ClipboardSettings>('get_clipboard_settings')
      .then(s => {
        setMaxEntries(s.max_entries);
        setRetentionMs(s.retention_ms);
      })
      .catch(() => {});
  }, []);

  const saveSettings = useCallback((max: number, ret: number) => {
    invoke('set_clipboard_settings', { maxEntries: max, retentionMs: ret }).catch(() => {});
  }, []);

  const handleMaxChange = (val: number) => {
    setMaxEntries(val);
    saveSettings(val, retentionMs);
  };

  const handleRetentionChange = (val: number) => {
    setRetentionMs(val);
    saveSettings(maxEntries, val);
  };

  const handleClickAction = (val: ClipClickAction) => {
    setClickAction(val);
    localStorage.setItem(CLICK_ACTION_KEY, val);
  };

  return (
    <div className="clip-settings-panel">
      <div className="clip-settings-section">
        <div className="clip-settings-label">Nombre max. d'éléments</div>
        <div className="clip-settings-desc">Limite d'éléments conservés en mémoire. Les plus anciens (non épinglés) seront supprimés.</div>
        <div className="clip-settings-options">
          {MAX_OPTIONS.map(o => (
            <button
              key={o.value}
              className={`clip-settings-chip ${maxEntries === o.value ? 'clip-settings-chip--active' : ''}`}
              onClick={() => handleMaxChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="clip-settings-section">
        <div className="clip-settings-label">Durée de rétention</div>
        <div className="clip-settings-desc">Les éléments plus anciens que cette durée seront automatiquement supprimés.</div>
        <div className="clip-settings-options">
          {RETENTION_OPTIONS.map(o => (
            <button
              key={o.value}
              className={`clip-settings-chip ${retentionMs === o.value ? 'clip-settings-chip--active' : ''}`}
              onClick={() => handleRetentionChange(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      </div>

      <div className="clip-settings-section">
        <div className="clip-settings-label">Action au clic</div>
        <div className="clip-settings-desc">Comportement quand vous cliquez sur un élément de la liste.</div>
        <div className="clip-settings-options">
          <button
            className={`clip-settings-chip ${clickAction === 'copy' ? 'clip-settings-chip--active' : ''}`}
            onClick={() => handleClickAction('copy')}
          >
            Copier dans le presse-papier
          </button>
          <button
            className={`clip-settings-chip ${clickAction === 'paste' ? 'clip-settings-chip--active' : ''}`}
            onClick={() => handleClickAction('paste')}
          >
            Coller dans l'app active
          </button>
        </div>
      </div>
    </div>
  );
}
