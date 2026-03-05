import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Copy, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { TotpResult } from './passwordTypes';

interface TotpDisplayProps {
  entryId: string;
}

export function TotpDisplay({ entryId }: TotpDisplayProps) {
  const [code, setCode] = useState<string | null>(null);
  const [remaining, setRemaining] = useState(30);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const prevCodeRef = useRef<string | null>(null);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    let active = true;

    const fetchTotp = async () => {
      try {
        const result = await invoke<TotpResult>('pw_get_totp', { entryId });
        if (!active) return;

        if (prevCodeRef.current && prevCodeRef.current !== result.code) {
          setAnimating(true);
          setTimeout(() => {
            if (active) setAnimating(false);
          }, 300);
        }
        prevCodeRef.current = result.code;
        setCode(result.code);
        setRemaining(result.remaining_seconds);
        setError(false);
      } catch {
        if (active) setError(true);
      }
    };

    fetchTotp();
    const interval = setInterval(fetchTotp, 1000);

    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [entryId]);

  const handleCopy = useCallback(async () => {
    if (!code) return;
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [code]);

  if (error) {
    return (
      <div className="text-xs text-[var(--text-tertiary)]">TOTP indisponible</div>
    );
  }

  if (!code) {
    return (
      <div className="text-xs text-[var(--text-tertiary)]">Chargement...</div>
    );
  }

  const formatted = code.slice(0, 3) + ' ' + code.slice(3);
  const circumference = 2 * Math.PI * 12;
  const progress = (remaining / 30) * circumference;

  return (
    <div className="flex items-center gap-3">
      {/* Countdown ring */}
      <div className="relative shrink-0">
        <svg width="32" height="32" viewBox="0 0 32 32" className="-rotate-90">
          <circle
            cx="16" cy="16" r="12"
            fill="none"
            stroke="var(--border-default)"
            strokeWidth="2.5"
          />
          <circle
            cx="16" cy="16" r="12"
            fill="none"
            stroke={remaining <= 5 ? 'var(--red)' : 'var(--accent)'}
            strokeWidth="2.5"
            strokeDasharray={circumference}
            strokeDashoffset={circumference - progress}
            strokeLinecap="round"
            className="transition-all duration-1000 ease-linear"
          />
        </svg>
        <span className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-[var(--text-secondary)]">
          {remaining}
        </span>
      </div>

      {/* Code */}
      <button
        onClick={handleCopy}
        className={cn(
          'font-mono text-xl font-semibold tracking-[0.2em] px-3 py-1 rounded-lg transition-all cursor-pointer',
          'text-[var(--text-primary)] hover:bg-[var(--bg-hover)]',
          animating && 'scale-105 text-[var(--accent)]',
        )}
        title="Cliquer pour copier"
      >
        {formatted}
      </button>

      {/* Copy indicator */}
      <span className="shrink-0 text-[var(--text-tertiary)]">
        {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
      </span>
    </div>
  );
}
