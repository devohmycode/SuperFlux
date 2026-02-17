import type { SummaryFormat } from '../types';

// --- Types ---
export type LLMProvider = 'ollama' | 'groq';

export interface LLMConfig {
  provider: LLMProvider;
  ollamaUrl: string;
  ollamaModel: string;
  groqApiKey: string;
  groqModel: string;
}

const DEFAULT_CONFIG: LLMConfig = {
  provider: 'ollama',
  ollamaUrl: 'http://localhost:11434',
  ollamaModel: 'llama3.2:3b',
  groqApiKey: import.meta.env.VITE_GROQ_API_KEY || '',
  groqModel: 'llama-3.3-70b-versatile',
};

// --- Persistence ---
const STORAGE_KEY = 'superflux_llm_config';

export function getLLMConfig(): LLMConfig {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
  }
  // Auto-detect: si pas de clé Groq, utiliser Ollama par défaut
  if (!DEFAULT_CONFIG.groqApiKey) {
    return { ...DEFAULT_CONFIG, provider: 'ollama' };
  }
  return DEFAULT_CONFIG;
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
  return callGroq(config, systemPrompt, userMessage);
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
