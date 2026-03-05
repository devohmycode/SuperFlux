import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { translateRaw, LANGUAGES } from '../services/translationService';

export function SuperTranslate() {
  const { t } = useTranslation();
  const ALL_LANGS = [{ code: 'auto', label: t('translate.detectLanguage') }, ...LANGUAGES];
  const [sourceText, setSourceText] = useState('');
  const [resultText, setResultText] = useState('');
  const [sourceLang, setSourceLang] = useState('auto');
  const [targetLang, setTargetLang] = useState('fr');
  const [detectedLang, setDetectedLang] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);
  const abortRef = useRef(0);

  const doTranslate = useCallback(async (text: string, sl: string, tl: string) => {
    if (!text.trim()) {
      setResultText('');
      setDetectedLang('');
      return;
    }
    const id = ++abortRef.current;
    setIsTranslating(true);
    try {
      const res = await translateRaw(text, sl, tl);
      if (id !== abortRef.current) return; // stale
      setResultText(res.text);
      if (sl === 'auto' && res.detectedLang) setDetectedLang(res.detectedLang);
    } catch (err) {
      if (id !== abortRef.current) return;
      setResultText(`${t('common.error')} : ${err instanceof Error ? err.message : t('translate.translationFailed')}`);
    } finally {
      if (id === abortRef.current) setIsTranslating(false);
    }
  }, []);

  // Auto-translate with debounce
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!sourceText.trim()) {
      setResultText('');
      setDetectedLang('');
      return;
    }
    debounceRef.current = setTimeout(() => {
      doTranslate(sourceText, sourceLang, targetLang);
    }, 800);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [sourceText, sourceLang, targetLang, doTranslate]);

  const handleSwap = useCallback(() => {
    // Can't swap if source is 'auto' and no detection yet
    const newSource = sourceLang === 'auto' ? (detectedLang || 'en') : sourceLang;
    const newTarget = newSource;
    setSourceLang(targetLang);
    setTargetLang(newSource);
    setSourceText(resultText);
    setResultText(sourceText);
    setDetectedLang('');
    // If previous source was auto, we now have a concrete lang — re-detect won't apply
    void newTarget; // used above
  }, [sourceLang, targetLang, sourceText, resultText, detectedLang]);

  const handleCopy = useCallback(async () => {
    if (resultText) {
      await navigator.clipboard.writeText(resultText);
    }
  }, [resultText]);

  const handleClear = useCallback(() => {
    setSourceText('');
    setResultText('');
    setDetectedLang('');
  }, []);

  const detectedLabel = detectedLang
    ? LANGUAGES.find(l => l.code === detectedLang)?.label || detectedLang
    : '';

  return (
    <div className="super-translate">
      <div className="translate-toolbar">
        <select
          className="translate-lang-select"
          value={sourceLang}
          onChange={e => { setSourceLang(e.target.value); setDetectedLang(''); }}
        >
          {ALL_LANGS.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>

        {sourceLang === 'auto' && detectedLabel && (
          <span className="translate-detected">({detectedLabel})</span>
        )}

        <button className="translate-swap-btn" onClick={handleSwap} title={t('translate.swapLanguages')}>
          ⇄
        </button>

        <select
          className="translate-lang-select"
          value={targetLang}
          onChange={e => setTargetLang(e.target.value)}
        >
          {LANGUAGES.map(l => (
            <option key={l.code} value={l.code}>{l.label}</option>
          ))}
        </select>

        <div className="translate-actions">
          <button className="translate-action-btn" onClick={handleCopy} title={t('translate.copyTranslation')} disabled={!resultText}>
            📋
          </button>
          <button className="translate-action-btn" onClick={handleClear} title={t('translate.clear')} disabled={!sourceText}>
            ✕
          </button>
        </div>
      </div>

      <div className="translate-panels">
        <textarea
          className="translate-textarea"
          value={sourceText}
          onChange={e => setSourceText(e.target.value)}
          placeholder={t('translate.enterText')}
          autoFocus
        />
        <textarea
          className="translate-textarea translate-textarea--result"
          value={isTranslating ? t('translate.translating') : resultText}
          readOnly
          placeholder={t('translate.translation')}
        />
      </div>
    </div>
  );
}
