import { useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Lock, Eye, EyeOff } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface PasswordVaultSetupProps {
  onCreated: () => void;
}

function getStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score += 1;
  if (password.length >= 12) score += 1;
  if (password.length >= 16) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password)) score += 1;
  if (/[^a-zA-Z0-9]/.test(password)) score += 1;

  if (score <= 2) return { score, label: 'Faible', color: 'bg-red-500' };
  if (score <= 4) return { score, label: 'Moyen', color: 'bg-amber-500' };
  return { score, label: 'Fort', color: 'bg-green-500' };
}

export function PasswordVaultSetup({ onCreated }: PasswordVaultSetupProps) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const strength = getStrength(password);
  const strengthPercent = Math.min((strength.score / 6) * 100, 100);

  const handleCreate = useCallback(async () => {
    setError(null);
    if (password.length < 8) {
      setError('Le mot de passe doit contenir au moins 8 caractères.');
      return;
    }
    if (password !== confirm) {
      setError('Les mots de passe ne correspondent pas.');
      return;
    }
    setLoading(true);
    try {
      await invoke('pw_create_vault', { password });
      onCreated();
    } catch (err) {
      setError(typeof err === 'string' ? err : (err as Error).message || 'Erreur lors de la création du coffre-fort.');
    } finally {
      setLoading(false);
    }
  }, [password, confirm, onCreated]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && password && confirm) {
        e.preventDefault();
        handleCreate();
      }
    },
    [password, confirm, handleCreate],
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
            Créer votre coffre-fort
          </h1>
          <p className="text-sm text-[var(--text-secondary)] text-center">
            Choisissez un mot de passe maître pour protéger vos identifiants.
          </p>
        </div>

        {/* Master password */}
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

          {/* Strength bar */}
          {password.length > 0 && (
            <div className="space-y-1">
              <div className="h-1.5 w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all duration-300', strength.color)}
                  style={{ width: `${strengthPercent}%` }}
                />
              </div>
              <p className="text-xs text-[var(--text-tertiary)]">
                Force : <span className={cn(
                  strength.score <= 2 ? 'text-red-500' : strength.score <= 4 ? 'text-amber-500' : 'text-green-500',
                )}>{strength.label}</span>
              </p>
            </div>
          )}

          {/* Confirm */}
          <div>
            <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1.5">
              Confirmer le mot de passe
            </label>
            <div className="relative">
              <input
                type={showConfirm ? 'text' : 'password'}
                className={cn(
                  'w-full rounded-lg border px-3 py-2.5 pr-10 text-sm outline-none transition-colors',
                  'bg-[var(--bg-elevated)] border-[var(--border-default)] text-[var(--text-primary)]',
                  'focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]',
                  'placeholder:text-[var(--text-tertiary)]',
                )}
                placeholder="Confirmez votre mot de passe"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] transition-colors"
                onClick={() => setShowConfirm(!showConfirm)}
                tabIndex={-1}
              >
                {showConfirm ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-red-500 bg-red-500/10 rounded-lg px-3 py-2">{error}</p>
          )}

          {/* Submit */}
          <Button
            className="w-full mt-2"
            onClick={handleCreate}
            disabled={loading || !password || !confirm}
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Création...
              </span>
            ) : (
              'Créer le coffre-fort'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
