import type { SummaryFormat } from '../types';

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const MODEL = 'llama-3.3-70b-versatile';
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

export async function summarizeArticle(
  content: string,
  title: string,
  format: SummaryFormat,
): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error('Clé API Groq non configurée. Ajoutez VITE_GROQ_API_KEY dans votre fichier .env');
  }

  const plainText = stripHtml(content);
  const truncated = plainText.length > MAX_CONTENT_LENGTH
    ? plainText.slice(0, MAX_CONTENT_LENGTH) + '...'
    : plainText;

  const response = await fetch(GROQ_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: getSystemPrompt(format) },
        { role: 'user', content: `Titre: ${title}\n\nContenu:\n${truncated}` },
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
