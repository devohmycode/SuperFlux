import { invoke } from '@tauri-apps/api/core';

export type TtsEngine = 'browser' | 'native' | 'elevenlabs';

export interface TtsConfig {
  engine: TtsEngine;
  rate: number;
  elevenLabsApiKey: string;
  elevenLabsVoiceId: string;
  elevenLabsModelId: string;
}

const STORAGE_KEY = 'superflux_tts_config';

const DEFAULT_CONFIG: TtsConfig = {
  engine: 'browser',
  rate: 1.0,
  elevenLabsApiKey: import.meta.env.VITE_ELEVENLABS_API_KEY || '',
  elevenLabsVoiceId: '21m00Tcm4TlvDq8ikWAM',
  elevenLabsModelId: 'eleven_multilingual_v2',
};

export function getTtsConfig(): TtsConfig {
  const envKey = import.meta.env.VITE_ELEVENLABS_API_KEY || '';
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...saved, elevenLabsApiKey: envKey || saved.elevenLabsApiKey || '' };
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_CONFIG, elevenLabsApiKey: envKey };
}

export function saveTtsConfig(config: TtsConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// Active audio element for ElevenLabs playback
let activeAudio: HTMLAudioElement | null = null;

type StatusCallback = (status: 'idle' | 'playing') => void;

export async function speak(text: string, onEnd?: StatusCallback): Promise<void> {
  const config = getTtsConfig();

  switch (config.engine) {
    case 'native': {
      await invoke('tts_speak', { text, rate: config.rate });
      // Native TTS is fire-and-forget from the frontend perspective
      break;
    }

    case 'elevenlabs': {
      const apiKey = config.elevenLabsApiKey || import.meta.env.VITE_ELEVENLABS_API_KEY || '';
      if (!apiKey) {
        throw new Error('Clé API ElevenLabs manquante (VITE_ELEVENLABS_API_KEY)');
      }
      const base64: string = await invoke('tts_speak_elevenlabs', {
        text,
        apiKey,
        voiceId: config.elevenLabsVoiceId,
        modelId: config.elevenLabsModelId,
      });
      // Stop any previous audio
      if (activeAudio) {
        activeAudio.pause();
        activeAudio = null;
      }
      const audio = new Audio(`data:audio/mpeg;base64,${base64}`);
      activeAudio = audio;
      audio.onended = () => {
        activeAudio = null;
        onEnd?.('idle');
      };
      audio.onerror = () => {
        activeAudio = null;
        onEnd?.('idle');
      };
      await audio.play();
      break;
    }

    case 'browser':
    default: {
      speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'fr-FR';
      utterance.rate = config.rate;
      utterance.onend = () => {
          onEnd?.('idle');
      };
      utterance.onerror = () => {
          onEnd?.('idle');
      };
      speechSynthesis.speak(utterance);
      break;
    }
  }
}

export async function stop(): Promise<void> {
  const config = getTtsConfig();

  // Stop all backends to be safe
  // Browser
  speechSynthesis.cancel();

  // ElevenLabs audio
  if (activeAudio) {
    activeAudio.pause();
    activeAudio.currentTime = 0;
    activeAudio = null;
  }

  // Native
  if (config.engine === 'native') {
    await invoke('tts_stop').catch(() => {});
  }
}

export function pauseBrowser(): void {
  speechSynthesis.pause();
}

export function resumeBrowser(): void {
  speechSynthesis.resume();
}
