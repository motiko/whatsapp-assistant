import type { Fetch } from './translator';

/** What a Transcriber heard in a recording. */
export interface Transcript {
  text: string;
  /** The spoken language, when the service says (a code like `de`, or a name like `german`). */
  language?: string;
}

/** Turns speech into text. */
export interface Transcriber {
  /** `language`: the language spoken, if known (a code like `de`); helps short or noisy recordings. */
  transcribe(audio: Blob, options?: { language?: string }): Promise<Transcript>;
}

/** A Transcriber failed: the service could not be reached or answered something unexpected. */
export class TranscriptionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TranscriptionError';
  }
}

/** A speech-to-text service reached through an OpenAI-compatible API (OpenAI, Groq, a local Whisper server…). */
export interface TranscriberConfig {
  /** The API's base URL, for example `https://api.openai.com/v1`; `/audio/transcriptions` is added. */
  baseUrl: string;
  model: string;
  apiKey: string;
}

/** Voice notes longer than this are not transcribed. */
export const maxVoiceSeconds = 300;
/** Nor recordings bigger than this (the APIs refuse more than 25 MB). */
export const maxVoiceBytes = 20 * 1024 * 1024;

/** Whether the settings name a Transcriber at all (a key is needed). */
export function transcriberConfigured(config: TranscriberConfig): boolean {
  return config.apiKey.trim() !== '' && config.baseUrl.trim() !== '' && config.model.trim() !== '';
}

/** A file name the APIs accept, by the recording's type: they go by its extension. */
function fileName(audio: Blob): string {
  const type = audio.type.toLowerCase();
  const extension = type.includes('ogg') || type.includes('opus') ? 'ogg'
    : type.includes('mpeg') || type.includes('mp3') ? 'mp3'
    : type.includes('mp4') || type.includes('m4a') || type.includes('aac') ? 'm4a'
    : type.includes('wav') ? 'wav'
    : type.includes('webm') ? 'webm'
    : 'ogg'; // WhatsApp and Telegram voice notes are OGG/Opus
  return `voice.${extension}`;
}

export function createOpenAiTranscriber(config: TranscriberConfig, fetchFn: Fetch = (url, init) => fetch(url, init)): Transcriber {
  return {
    async transcribe(audio, options = {}) {
      const form = new FormData();
      form.append('file', audio, fileName(audio));
      form.append('model', config.model);
      form.append('response_format', 'json');
      if (options.language) form.append('language', options.language.split('-')[0]!.toLowerCase());
      const response = await fetchFn(`${config.baseUrl.replace(/\/+$/, '')}/audio/transcriptions`, {
        method: 'POST',
        headers: { authorization: `Bearer ${config.apiKey}` },
        body: form,
      }).catch((error: unknown) => {
        throw new TranscriptionError(`The transcription service could not be reached: ${String(error)}`);
      });
      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new TranscriptionError(`The transcription service answered HTTP ${response.status}: ${body.slice(0, 200)}`);
      }
      const answer = (await response.json().catch(() => undefined)) as { text?: unknown; language?: unknown } | undefined;
      if (typeof answer?.text !== 'string') throw new TranscriptionError('The transcription service answered without a text');
      return { text: answer.text.trim(), ...(typeof answer.language === 'string' ? { language: answer.language } : {}) };
    },
  };
}
