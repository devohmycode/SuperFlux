import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { RefreshCw, Copy, Check } from 'lucide-react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import type { PasswordGenOptions } from './passwordTypes';

interface PasswordGeneratorProps {
  onGenerate?: (password: string) => void;
  initialOptions?: Partial<PasswordGenOptions>;
  embedded?: boolean;
}

function getStrengthFromOptions(opts: PasswordGenOptions): { label: string; color: string; percent: number } {
  let score = 0;
  if (opts.length >= 12) score += 2;
  else if (opts.length >= 8) score += 1;
  if (opts.length >= 20) score += 1;
  if (opts.uppercase) score += 1;
  if (opts.lowercase) score += 1;
  if (opts.digits) score += 1;
  if (opts.symbols) score += 2;

  const percent = Math.min((score / 8) * 100, 100);
  if (score <= 3) return { label: 'Faible', color: 'bg-red-500', percent };
  if (score <= 5) return { label: 'Moyen', color: 'bg-amber-500', percent };
  return { label: 'Fort', color: 'bg-green-500', percent };
}

export function PasswordGenerator({ onGenerate, initialOptions, embedded }: PasswordGeneratorProps) {
  const [options, setOptions] = useState<PasswordGenOptions>({
    length: initialOptions?.length ?? 20,
    uppercase: initialOptions?.uppercase ?? true,
    lowercase: initialOptions?.lowercase ?? true,
    digits: initialOptions?.digits ?? true,
    symbols: initialOptions?.symbols ?? true,
    exclude_ambiguous: initialOptions?.exclude_ambiguous ?? false,
  });
  const [generated, setGenerated] = useState('');
  const [copied, setCopied] = useState(false);

  const strength = getStrengthFromOptions(options);

  const generate = useCallback(async () => {
    try {
      const pw = await invoke<string>('pw_generate_password', { options });
      setGenerated(pw);
      setCopied(false);
    } catch (err) {
      // Fallback: generate client-side
      const charset = buildCharset(options);
      let pw = '';
      const array = new Uint8Array(options.length);
      crypto.getRandomValues(array);
      for (let i = 0; i < options.length; i++) {
        pw += charset[array[i] % charset.length];
      }
      setGenerated(pw);
      setCopied(false);
    }
  }, [options]);

  useEffect(() => {
    generate();
  }, [generate]);

  const handleCopy = useCallback(async () => {
    if (!generated) return;
    await navigator.clipboard.writeText(generated);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [generated]);

  const handleUse = useCallback(() => {
    if (onGenerate && generated) {
      onGenerate(generated);
    }
  }, [onGenerate, generated]);

  const toggleOpt = (key: keyof Omit<PasswordGenOptions, 'length'>) => {
    setOptions((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className={cn(
      'space-y-4',
      !embedded && 'rounded-xl border p-5 bg-[var(--bg-surface)] border-[var(--border-default)]',
    )}>
      {!embedded && (
        <h3 className="text-sm font-semibold text-[var(--text-primary)]">Générateur de mot de passe</h3>
      )}

      {/* Generated password display */}
      <div className={cn(
        'flex items-center gap-2 rounded-lg border p-3',
        'bg-[var(--bg-elevated)] border-[var(--border-default)]',
      )}>
        <code className="flex-1 font-mono text-sm text-[var(--text-primary)] break-all select-all leading-relaxed">
          {generated}
        </code>
        <button
          onClick={handleCopy}
          className="shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="Copier"
        >
          {copied ? <Check size={16} className="text-green-500" /> : <Copy size={16} />}
        </button>
        <button
          onClick={generate}
          className="shrink-0 p-1.5 rounded-md text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover)] transition-colors"
          title="Régénérer"
        >
          <RefreshCw size={16} />
        </button>
      </div>

      {/* Strength bar */}
      <div className="space-y-1">
        <div className="h-1.5 w-full rounded-full bg-[var(--bg-elevated)] overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all duration-300', strength.color)}
            style={{ width: `${strength.percent}%` }}
          />
        </div>
        <p className="text-xs text-[var(--text-tertiary)]">
          Force : <span className={cn(
            strength.percent <= 37 ? 'text-red-500' : strength.percent <= 62 ? 'text-amber-500' : 'text-green-500',
          )}>{strength.label}</span>
        </p>
      </div>

      {/* Length slider */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-[var(--text-secondary)]">Longueur</label>
          <span className="text-xs font-mono text-[var(--text-primary)] bg-[var(--bg-elevated)] px-2 py-0.5 rounded">
            {options.length}
          </span>
        </div>
        <input
          type="range"
          min={8}
          max={128}
          value={options.length}
          onChange={(e) => setOptions((prev) => ({ ...prev, length: Number(e.target.value) }))}
          className="w-full accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[10px] text-[var(--text-tertiary)]">
          <span>8</span>
          <span>128</span>
        </div>
      </div>

      {/* Checkboxes */}
      <div className="grid grid-cols-2 gap-2">
        {([
          { key: 'uppercase' as const, label: 'Majuscules (A-Z)' },
          { key: 'lowercase' as const, label: 'Minuscules (a-z)' },
          { key: 'digits' as const, label: 'Chiffres (0-9)' },
          { key: 'symbols' as const, label: 'Symboles (!@#$)' },
          { key: 'exclude_ambiguous' as const, label: 'Exclure ambigus' },
        ]).map(({ key, label }) => (
          <label
            key={key}
            className={cn(
              'flex items-center gap-2 text-xs rounded-lg px-2.5 py-2 cursor-pointer transition-colors',
              'hover:bg-[var(--bg-hover)]',
              options[key] ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]',
            )}
          >
            <input
              type="checkbox"
              checked={options[key]}
              onChange={() => toggleOpt(key)}
              className="accent-[var(--accent)] rounded"
            />
            {label}
          </label>
        ))}
      </div>

      {/* Use button (when embedded) */}
      {onGenerate && (
        <Button className="w-full" onClick={handleUse} disabled={!generated}>
          Utiliser ce mot de passe
        </Button>
      )}
    </div>
  );
}

function buildCharset(options: PasswordGenOptions): string {
  let charset = '';
  const ambiguous = 'Il1O0o';
  if (options.uppercase) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  if (options.lowercase) charset += 'abcdefghijklmnopqrstuvwxyz';
  if (options.digits) charset += '0123456789';
  if (options.symbols) charset += '!@#$%^&*()_+-=[]{}|;:,.<>?';
  if (options.exclude_ambiguous) {
    charset = charset.split('').filter((c) => !ambiguous.includes(c)).join('');
  }
  if (!charset) charset = 'abcdefghijklmnopqrstuvwxyz';
  return charset;
}
