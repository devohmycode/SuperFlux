import { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { invoke } from '@tauri-apps/api/core';
import { X, Check, Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import type { VaultSettings } from './passwordTypes';

interface PasswordSettingsProps {
  onClose: () => void;
  settings: VaultSettings;
  onSave: (settings: VaultSettings) => void;
}

export function PasswordSettings({ onClose, settings, onSave }: PasswordSettingsProps) {
  const { t } = useTranslation();
  const [localSettings, setLocalSettings] = useState<VaultSettings>({ ...settings });
  const [saved, setSaved] = useState(false);

  // Change master password state
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);

  const handleSave = useCallback(() => {
    onSave(localSettings);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }, [localSettings, onSave]);

  const handleChangePassword = useCallback(async () => {
    setPwError(null);
    setPwSuccess(false);

    if (newPw.length < 8) {
      setPwError(t('password.minPasswordLength'));
      return;
    }
    if (newPw !== confirmPw) {
      setPwError(t('password.passwordsDoNotMatch'));
      return;
    }

    setPwLoading(true);
    try {
      await invoke('pw_change_master', {
        oldPw: currentPw,
        newPw: newPw,
      });
      setPwSuccess(true);
      setCurrentPw('');
      setNewPw('');
      setConfirmPw('');
    } catch (err) {
      setPwError(typeof err === 'string' ? err : t('password.currentPasswordIncorrect'));
    } finally {
      setPwLoading(false);
    }
  }, [currentPw, newPw, confirmPw]);

  const update = <K extends keyof VaultSettings>(key: K, value: VaultSettings[K]) => {
    setLocalSettings((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-default)]">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t('password.vaultSettings')}</h2>
        <Button variant="ghost" size="icon" onClick={onClose}>
          <X size={16} />
        </Button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Auto-lock */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              {t('password.autoLock')}
            </label>
            <span className="text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded">
              {localSettings.auto_lock_minutes === 0 ? t('settings.disabled') : `${localSettings.auto_lock_minutes} min`}
            </span>
          </div>
          <input
            type="range"
            min={0}
            max={60}
            value={localSettings.auto_lock_minutes}
            onChange={(e) => update('auto_lock_minutes', Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
            <span>{t('settings.disabled')}</span>
            <span>60 min</span>
          </div>
        </div>

        {/* Clipboard clear */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              {t('password.clearClipboard')}
            </label>
            <span className="text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded">
              {localSettings.clipboard_clear_seconds}s
            </span>
          </div>
          <input
            type="range"
            min={10}
            max={120}
            step={5}
            value={localSettings.clipboard_clear_seconds}
            onChange={(e) => update('clipboard_clear_seconds', Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
            <span>10s</span>
            <span>120s</span>
          </div>
        </div>

        {/* Default password length */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--text-secondary)]">
              {t('password.defaultPasswordLength')}
            </label>
            <span className="text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded">
              {localSettings.default_password_length}
            </span>
          </div>
          <input
            type="range"
            min={8}
            max={64}
            value={localSettings.default_password_length}
            onChange={(e) => update('default_password_length', Number(e.target.value))}
            className="w-full accent-[var(--accent)]"
          />
          <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
            <span>8</span>
            <span>64</span>
          </div>
        </div>

        {/* Save settings */}
        <Button className="w-full gap-2" onClick={handleSave}>
          {saved ? <><Check size={14} /> {t('password.saved')}</> : t('password.saveSettings')}
        </Button>

        {/* Divider */}
        <div className="border-t border-[var(--border-default)]" />

        {/* Change master password */}
        <div className="space-y-3">
          <h3 className="text-xs font-semibold text-[var(--text-primary)] uppercase tracking-wider">
            {t('password.changeMasterPassword')}
          </h3>

          <div className="space-y-2">
            <div className="relative">
              <input
                type={showCurrent ? 'text' : 'password'}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 pr-10 text-sm outline-none transition-colors',
                  'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]',
                  'focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]',
                  'placeholder:text-[var(--text-tertiary)]',
                )}
                placeholder={t('password.currentPassword')}
                value={currentPw}
                onChange={(e) => setCurrentPw(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                onClick={() => setShowCurrent(!showCurrent)}
                tabIndex={-1}
              >
                {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            <div className="relative">
              <input
                type={showNew ? 'text' : 'password'}
                className={cn(
                  'w-full rounded-lg border px-3 py-2 pr-10 text-sm outline-none transition-colors',
                  'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]',
                  'focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]',
                  'placeholder:text-[var(--text-tertiary)]',
                )}
                placeholder={t('password.newPassword')}
                value={newPw}
                onChange={(e) => setNewPw(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                onClick={() => setShowNew(!showNew)}
                tabIndex={-1}
              >
                {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </div>

            <input
              type="password"
              className={cn(
                'w-full rounded-lg border px-3 py-2 text-sm outline-none transition-colors',
                'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]',
                'focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]',
                'placeholder:text-[var(--text-tertiary)]',
              )}
              placeholder={t('password.confirmNewPassword')}
              value={confirmPw}
              onChange={(e) => setConfirmPw(e.target.value)}
            />
          </div>

          {pwError && <p className="text-xs text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{pwError}</p>}
          {pwSuccess && <p className="text-xs text-green-500 bg-green-500/10 rounded-lg px-3 py-2">{t('password.masterPasswordChanged')}</p>}

          <Button
            variant="outline"
            className="w-full"
            onClick={handleChangePassword}
            disabled={pwLoading || !currentPw || !newPw || !confirmPw}
          >
            {pwLoading ? t('password.changing') : t('password.changePassword')}
          </Button>
        </div>
      </div>
    </div>
  );
}
