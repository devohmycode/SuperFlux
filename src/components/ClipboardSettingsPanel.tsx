import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
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
  { value: 0, labelKey: 'clipboard.unlimited' },
  { value: 1 * 60 * 60 * 1000, labelKey: 'clipboard.oneHour' },
  { value: 6 * 60 * 60 * 1000, labelKey: 'clipboard.sixHours' },
  { value: 24 * 60 * 60 * 1000, labelKey: 'clipboard.twentyFourHours' },
  { value: 3 * 24 * 60 * 60 * 1000, labelKey: 'clipboard.threeDays' },
  { value: 7 * 24 * 60 * 60 * 1000, labelKey: 'clipboard.sevenDays' },
  { value: 30 * 24 * 60 * 60 * 1000, labelKey: 'clipboard.thirtyDays' },
];

export type ClipClickAction = 'copy' | 'paste';

export function getClipClickAction(): ClipClickAction {
  try {
    const v = localStorage.getItem(CLICK_ACTION_KEY);
    return v === 'paste' ? 'paste' : 'copy';
  } catch { return 'copy'; }
}

export function ClipboardSettingsPanel() {
  const { t } = useTranslation();
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
        <div className="clip-settings-label">{t('clipboard.maxItems')}</div>
        <div className="clip-settings-desc">{t('clipboard.maxItemsDesc')}</div>
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
        <div className="clip-settings-label">{t('clipboard.retention')}</div>
        <div className="clip-settings-desc">{t('clipboard.retentionDesc')}</div>
        <div className="clip-settings-options">
          {RETENTION_OPTIONS.map(o => (
            <button
              key={o.value}
              className={`clip-settings-chip ${retentionMs === o.value ? 'clip-settings-chip--active' : ''}`}
              onClick={() => handleRetentionChange(o.value)}
            >
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </div>

      <div className="clip-settings-section">
        <div className="clip-settings-label">{t('clipboard.clickAction')}</div>
        <div className="clip-settings-desc">{t('clipboard.clickActionDesc')}</div>
        <div className="clip-settings-options">
          <button
            className={`clip-settings-chip ${clickAction === 'copy' ? 'clip-settings-chip--active' : ''}`}
            onClick={() => handleClickAction('copy')}
          >
            {t('clipboard.copyToClipboard')}
          </button>
          <button
            className={`clip-settings-chip ${clickAction === 'paste' ? 'clip-settings-chip--active' : ''}`}
            onClick={() => handleClickAction('paste')}
          >
            {t('clipboard.pasteInApp')}
          </button>
        </div>
      </div>
    </div>
  );
}
