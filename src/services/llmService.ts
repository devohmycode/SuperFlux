import type { SummaryFormat } from '../types';

// --- Types ---
export type LLMProvider = 'ollama' | 'cloud';

export interface LLMConfig {
  provider: LLMProvider;
  ollamaUrl: string;
  ollamaModel: string;
  groqApiKey: string;
  groqModel: string;
  mistralApiKey: string;
  mistralModel: string;
  geminiApiKey: string;
  geminiModel: string;
}

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  groqApiKey: import.meta.env.VITE_GROQ_API_KEY || '',
  groqModel: 'llama-3.3-70b-versatile',
  mistralApiKey: import.meta.env.VITE_MISTRAL_API_KEY || '',
  mistralModel: 'mistral-small-latest',
  geminiApiKey: import.meta.env.VITE_GEMINI_API_KEY || '',
  geminiModel: 'gemini-2.0-flash',
};

// --- Persistence ---
const STORAGE_KEY = 'superflux_llm_config';

export function getLLMConfig(): LLMConfig {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    const parsed = { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    // Migration: ancien provider 'groq' → 'cloud'
    if ((parsed.provider as string) === 'groq') parsed.provider = 'cloud';
    return parsed;
  }
  // Auto-detect: si aucune clé cloud, utiliser Ollama par défaut
  if (!DEFAULT_CONFIG.groqApiKey && !DEFAULT_CONFIG.mistralApiKey && !DEFAULT_CONFIG.geminiApiKey) {
    return { ...DEFAULT_CONFIG, provider: 'ollama' };
  }
  return DEFAULT_CONFIG;
}

/** Retourne true si au moins une clé API cloud est configurée */
export function hasAnyCloudKey(config?: LLMConfig): boolean {
  const c = config ?? getLLMConfig();
  return !!(c.groqApiKey || c.mistralApiKey || c.geminiApiKey);
}

export function saveLLMConfig(config: Partial<LLMConfig>) {
  const current = getLLMConfig();
  const merged = { ...current, ...config };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
}

// --- Prompts ---
const MAX_CONTENT_LENGTH = 4000;

function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, '').trim();
}

function getSystemPrompt(format: SummaryFormat): string {
  if (format === 'bullets') {
    return "Tu es un assistant qui résume des articles. Fournis 3 à 5 points clés en français, sous forme de liste à puces concise. Chaque point doit être une phrase courte et informative.";
  }
  return "Tu es un assistant qui résume des articles. Fournis un résumé concis en 2-3 phrases en français, capturant l'essentiel de l'article.";
}

// --- API calls ---
async function callOllama(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const response = await fetch(`${config.ollamaUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.ollamaModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
    }),
  });

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error(`Modèle "${config.ollamaModel}" non trouvé. Lancez: ollama pull ${config.ollamaModel}`);
    }
    throw new Error(`Erreur Ollama (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message?.content;
  if (!message) {
    throw new Error('Réponse vide d\'Ollama');
  }

  return message.trim();
}

async function callGroq(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  if (!config.groqApiKey) {
    throw new Error('Clé API Groq non configurée. Ajoutez VITE_GROQ_API_KEY dans votre fichier .env');
  }

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.groqApiKey}`,
    },
    body: JSON.stringify({
      model: config.groqModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
    }),
  });

  if (response.status === 429) {
    throw new Error('Limite de requêtes atteinte (rate limit). Réessayez dans quelques secondes.');
  }

  if (!response.ok) {
    throw new Error(`Erreur API Groq (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message?.content;
  if (!message) {
    throw new Error('Réponse vide de l\'API Groq');
  }

  return message.trim();
}

async function callMistral(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  if (!config.mistralApiKey) {
    throw new Error('Clé API Mistral non configurée');
  }

  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${config.mistralApiKey}`,
    },
    body: JSON.stringify({
      model: config.mistralModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.3,
    }),
  });

  if (response.status === 429) {
    throw new Error('Limite Mistral atteinte (rate limit)');
  }
  if (!response.ok) {
    throw new Error(`Erreur API Mistral (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  const message = data?.choices?.[0]?.message?.content;
  if (!message) {
    throw new Error('Réponse vide de l\'API Mistral');
  }
  return message.trim();
}

async function callGemini(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  if (!config.geminiApiKey) {
    throw new Error('Clé API Gemini non configurée');
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: [{ role: 'user', parts: [{ text: userMessage }] }],
      generationConfig: { temperature: 0.3 },
    }),
  });

  if (response.status === 429) {
    throw new Error('Limite Gemini atteinte (rate limit)');
  }
  if (!response.ok) {
    throw new Error(`Erreur API Gemini (${response.status}): ${response.statusText}`);
  }

  const data = await response.json();
  const message = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!message) {
    throw new Error('Réponse vide de l\'API Gemini');
  }
  return message.trim();
}

/** Nom du dernier provider cloud utilisé avec succès */
export let lastCloudProvider: string | null = null;

type CloudCaller = (config: LLMConfig, sys: string, usr: string) => Promise<string>;

async function callCloud(
  config: LLMConfig,
  systemPrompt: string,
  userMessage: string,
): Promise<string> {
  const providers: { name: string; available: boolean; call: CloudCaller }[] = [
    { name: 'Groq', available: !!config.groqApiKey, call: callGroq },
    { name: 'Mistral', available: !!config.mistralApiKey, call: callMistral },
    { name: 'Gemini', available: !!config.geminiApiKey, call: callGemini },
  ];

  const available = providers.filter(p => p.available);
  if (available.length === 0) {
    throw new Error('Aucune clé API cloud configurée (Groq, Mistral ou Gemini). Ajoutez au moins une clé dans .env');
  }

  const errors: string[] = [];
  for (const provider of available) {
    try {
      const result = await provider.call(config, systemPrompt, userMessage);
      lastCloudProvider = provider.name;
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`${provider.name}: ${msg}`);
      console.warn(`[LLM] ${provider.name} échoué, tentative suivante...`, msg);
    }
  }

  lastCloudProvider = null;
  throw new Error(`Tous les providers cloud ont échoué:\n${errors.join('\n')}`);
}

// --- Public API (même signature que l'ancien groqService) ---
export async function summarizeArticle(
  content: string,
  title: string,
  format: SummaryFormat,
): Promise<string> {
  const config = getLLMConfig();
  const plainText = stripHtml(content);
  const truncated = plainText.length > MAX_CONTENT_LENGTH
    ? plainText.slice(0, MAX_CONTENT_LENGTH) + '...'
    : plainText;

  const systemPrompt = getSystemPrompt(format);
  const userMessage = `Titre: ${title}\n\nContenu:\n${truncated}`;

  if (config.provider === 'ollama') {
    return callOllama(config, systemPrompt, userMessage);
  }
  return callCloud(config, systemPrompt, userMessage);
}

// --- Digest multi-articles ---
export interface DigestArticle {
  title: string;
  excerpt: string;
  feedName: string;
}

const DIGEST_SYSTEM_PROMPT =
  "Tu es un assistant éditorial. À partir de la liste d'articles de flux RSS ci-dessous, identifie les 3 à 5 informations les plus importantes et rédige un briefing concis en français, sous forme de liste à puces. Chaque point doit citer la source.";

export async function summarizeDigest(articles: DigestArticle[]): Promise<string> {
  const config = getLLMConfig();

  const lines = articles.slice(0, 30).map(
    (a, i) => `${i + 1}. [${a.feedName}] ${a.title}\n   ${a.excerpt}`
  );
  let userMessage = lines.join('\n\n');
  if (userMessage.length > MAX_CONTENT_LENGTH) {
    userMessage = userMessage.slice(0, MAX_CONTENT_LENGTH) + '...';
  }

  if (config.provider === 'ollama') {
    return callOllama(config, DIGEST_SYSTEM_PROMPT, userMessage);
  }
  return callCloud(config, DIGEST_SYSTEM_PROMPT, userMessage);
}

// --- Utilitaire: vérifier si Ollama est disponible ---
export interface OllamaStatus {
  available: boolean;
  models: string[];
}

export async function checkOllamaStatus(url = 'http://localhost:11434'): Promise<OllamaStatus> {
  try {
    const res = await fetch(`${url}/api/tags`);
    if (!res.ok) return { available: false, models: [] };
    const data = await res.json();
    const models = (data.models || []).map((m: { name: string }) => m.name);
    return { available: true, models };
  } catch {
    return { available: false, models: [] };
  }
}

// --- Télécharger (pull) un modèle Ollama ---
export interface PullProgress {
  status: string;
  percent: number;
}

export async function pullOllamaModel(
  model: string,
  url = 'http://localhost:11434',
  onProgress?: (progress: PullProgress) => void,
): Promise<void> {
  const response = await fetch(`${url}/api/pull`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: model }),
  });

  if (!response.ok) {
    throw new Error(`Erreur Ollama (${response.status}): ${response.statusText}`);
  }

  // Ollama streams NDJSON progress lines
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error('Impossible de lire la réponse Ollama');
  }

  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const data = JSON.parse(line);
        if (data.error) {
          throw new Error(data.error);
        }
        const percent = data.total && data.completed
          ? (data.completed / data.total) * 100
          : 0;
        onProgress?.({
          status: data.status || 'Téléchargement...',
          percent,
        });
      } catch (e) {
        if (e instanceof SyntaxError) continue;
        throw e;
      }
    }
  }
}
