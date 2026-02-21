// Google Translate (free, no API key) via unofficial endpoint

import { httpRequest } from '../lib/tauriFetch';

export interface TranslationConfig {
  targetLanguage: string;
}

const STORAGE_KEY = 'superflux_translation_config';

const DEFAULT_CONFIG: TranslationConfig = {
  targetLanguage: 'fr',
};

export function getTranslationConfig(): TranslationConfig {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  } catch { /* ignore */ }
  return DEFAULT_CONFIG;
}

export function saveTranslationConfig(config: Partial<TranslationConfig>) {
  const current = getTranslationConfig();
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...current, ...config }));
}

export const LANGUAGES = [
  { code: 'fr', label: 'Français' },
  { code: 'en', label: 'English' },
  { code: 'es', label: 'Español' },
  { code: 'de', label: 'Deutsch' },
  { code: 'it', label: 'Italiano' },
  { code: 'pt', label: 'Português' },
  { code: 'nl', label: 'Nederlands' },
  { code: 'ru', label: 'Русский' },
  { code: 'ja', label: '日本語' },
  { code: 'zh', label: '中文' },
  { code: 'ko', label: '한국어' },
  { code: 'ar', label: 'العربية' },
] as const;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

// Split text into chunks to respect the ~5000 char limit per request
function splitIntoChunks(text: string, maxLength = 4500): string[] {
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      chunks.push(remaining);
      break;
    }
    // Try to split at a sentence boundary
    let splitIdx = remaining.lastIndexOf('. ', maxLength);
    if (splitIdx < maxLength * 0.5) {
      splitIdx = remaining.lastIndexOf(' ', maxLength);
    }
    if (splitIdx < maxLength * 0.3) {
      splitIdx = maxLength;
    }
    chunks.push(remaining.slice(0, splitIdx + 1));
    remaining = remaining.slice(splitIdx + 1);
  }
  return chunks;
}

export async function translateText(
  html: string,
  targetLang: string,
): Promise<string> {
  const text = stripHtml(html);
  if (!text) return '';

  const chunks = splitIntoChunks(text);
  const results: string[] = [];

  for (const chunk of chunks) {
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(chunk)}`;

    const res = await httpRequest({ method: 'GET', url });

    if (res.status !== 200) {
      throw new Error(`Erreur de traduction (${res.status})`);
    }

    const data = JSON.parse(res.body);
    // Response format: [[["translated text","original text",null,null,10],...],null,"en"]
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error('Réponse inattendue du service de traduction');
    }

    const translated = data[0]
      .filter((seg: unknown) => Array.isArray(seg) && seg[0])
      .map((seg: unknown[]) => seg[0] as string)
      .join('');

    results.push(translated);
  }

  return results.join(' ');
}
