import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import type { UnlockResult } from './passwordTypes';

interface PasswordVaultUnlockProps {
  onUnlocked: (result: UnlockResult) => void;
}

export function PasswordVaultUnlock({ onUnlocked }: PasswordVaultUnlockProps) {
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleUnlock = useCallback(async () => {
    if (!password.trim()) return;
    setError(null);
    setLoading(true);
    try {
      const result = await invoke<UnlockResult>('pw_unlock_vault', { password });
      onUnlocked(result);
    } catch (err) {
      setError(typeof err === 'string' ? err : 'Mot de passe incorrect.');
    } finally {
      setLoading(false);
    }
  }, [password, onUnlocked]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && password) {
        e.preventDefault();
        handleUnlock();
      }
    },
    [password, handleUnlock],
  );

  return (
    <div className="flex items-center justify-center h-full w-full p-8">
      <div
        className={cn(
          'w-full max-w-md rounded-2xl border p-8 shadow-2xl',
          'bg-[var(--bg-surface)]/80 border-[var(--border-default)] backdrop-blur-xl',
        )}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="flex items-center justify-center w-16 h-16 rounded-2xl bg-[var(--accent-glow)] text-[var(--accent)]">
            <Lock size={32} />
          </div>
          <h1 className="text-xl font-semibold text-[var(--text-primary)]">
            Déverrouiller le coffre-fort
          </h1>
          <p className="text-sm text-[var(--text-secondary)] text-center">
            Entrez votre mot de passe maître pour accéder à vos identifiants.
          </p>
        </div>

        {/* Password input */}
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Mot de passe maître
            </label>
            <div className="relative">
              <input
                type={showPassword ? 'text' : 'password'}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 pr-10 text-sm outline-none transition-colors',
                  'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]',
                  'focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]',
                  'placeholder:text-[var(--text-tertiary)]',
                )}
                placeholder="Entrez votre mot de passe maître"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoFocus
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Unlock button */}
          <Button
            className="w-full"
            onClick={handleUnlock}
            disabled={loading || !password}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Déverrouillage...
              </span>
            ) : (
              'Déverrouiller'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
