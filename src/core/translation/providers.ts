import type { Fetch } from './translator';

/**
 * Well-known OpenAI-compatible API providers, to suggest on the options page,
 * and their models, to suggest once a provider and key are set.
 */

/** What a model is picked for: translating (chat completions) or transcribing (speech to text). */
export type Capability = 'chat' | 'transcription';

export interface Provider {
  name: string;
  baseUrl: string;
  /** What its API offers through the OpenAI-compatible endpoints. */
  capabilities: readonly Capability[];
}

export const providers: readonly Provider[] = [
  { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', capabilities: ['chat', 'transcription'] },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', capabilities: ['chat', 'transcription'] },
  { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', capabilities: ['chat', 'transcription'] },
  { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', capabilities: ['chat', 'transcription'] },
  { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', capabilities: ['chat', 'transcription'] },
  { name: 'DeepInfra', baseUrl: 'https://api.deepinfra.com/v1/openai', capabilities: ['chat', 'transcription'] },
  { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', capabilities: ['chat'] },
  { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', capabilities: ['chat'] },
  { name: 'xAI', baseUrl: 'https://api.x.ai/v1', capabilities: ['chat'] },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', capabilities: ['chat'] },
  { name: 'Fireworks AI', baseUrl: 'https://api.fireworks.ai/inference/v1', capabilities: ['chat'] },
];

/** The providers offering `capability` whose name or host contains `query` (all of them for an empty query). */
export function matchProviders(query: string, capability: Capability): Provider[] {
  const wanted = query.trim().toLowerCase();
  return providers.filter(
    (provider) =>
      provider.capabilities.includes(capability) &&
      (wanted === '' || provider.name.toLowerCase().includes(wanted) || new URL(provider.baseUrl).hostname.includes(wanted)),
  );
}

export interface ModelChoice {
  id: string;
  /** A readable name, when the API gives one. */
  name?: string;
  /** Estimated US dollars for `estimateCount` typical messages (see `estimateCost`), when the API gives prices (OpenRouter does). */
  cost?: number;
  /** How many tokens it takes in at once, when the API says. */
  context?: number;
  /** When it was added, in seconds since 1970, when the API says. */
  created?: number;
}

/** Costs are estimated for this many messages. */
export const estimateCount = 100;
/** A typical text message to translate: the instructions plus a short message in, the translation out. */
export const typicalMessage = { inputTokens: 150, outputTokens: 50 } as const;
/** A typical voice note's length. */
export const typicalVoiceSeconds = 30;
/** For speech-to-text priced per token: audio tokens per second heard, and text tokens per second spoken. */
const audioTokensPerSecond = 20;
const spokenTokensPerSecond = 4;

/**
 * Estimated US dollars for `estimateCount` typical messages, from a model's
 * prices as OpenRouter gives them (dollars per token as strings; for most
 * speech-to-text models, `prompt` is dollars per second of audio and
 * `completion` is 0). Undefined when the prices are missing, variable, or in
 * a unit it can't tell.
 */
export function estimateCost(pricing: { prompt?: unknown; completion?: unknown } | undefined, capability: Capability): number | undefined {
  const prompt = Number(pricing?.prompt);
  const completion = Number(pricing?.completion ?? 0);
  if (pricing?.prompt === undefined || !Number.isFinite(prompt) || !Number.isFinite(completion) || prompt < 0 || completion < 0) return undefined;
  if (capability === 'chat') return estimateCount * (typicalMessage.inputTokens * prompt + typicalMessage.outputTokens * completion);
  if (completion > 0) {
    // Priced per token, like a chat model hearing the audio.
    return estimateCount * typicalVoiceSeconds * (audioTokensPerSecond * prompt + spokenTokensPerSecond * completion);
  }
  // Per second of audio; above a cent a second ($36 an hour) it is surely another unit.
  return prompt > 0.01 ? undefined : estimateCount * typicalVoiceSeconds * prompt;
}

/** One entry of a `/models` answer: OpenAI's shape, plus what OpenRouter and others add. */
interface ListedModel {
  id?: unknown;
  name?: unknown;
  display_name?: unknown;
  architecture?: { input_modalities?: unknown; output_modalities?: unknown };
  pricing?: { prompt?: unknown; completion?: unknown };
  context_length?: unknown;
  created?: unknown;
}

const transcriptionName = /whisper|transcri|speech-to-text|\bstt\b|voxtral|parakeet|canary|scribe/i;
/** Models listed by a chat API that don't chat: embeddings, images, speech, moderation… */
const notChatName =
  /embed|whisper|transcri|tts|text-to-speech|speech|audio|realtime|dall-e|image|imagen|veo|sora|moderation|rerank|guard|davinci|babbage|search|computer-use|voxtral|parakeet|ocr/i;

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** A cost as a short price: “free”, “$0.0021”, “$0.30”, “$12”. */
export function formatCost(cost: number): string {
  if (cost === 0) return 'free';
  if (cost < 0.01) return `$${cost.toPrecision(2).replace(/0+$/, '')}`;
  if (cost < 10) return `$${cost.toFixed(2)}`;
  return `$${Math.round(cost)}`;
}

/** Whether a listed model fits `capability`: by its declared modalities when the API says, else by its name. */
export function modelFits(model: ListedModel & { id: string }, capability: Capability): boolean {
  const input = strings(model.architecture?.input_modalities);
  const output = strings(model.architecture?.output_modalities);
  if (input.length > 0 && output.length > 0) {
    // OpenRouter marks its speech-to-text models with a `transcription` output;
    // chat models that hear audio don't serve /audio/transcriptions.
    return capability === 'chat'
      ? input.includes('text') && output.includes('text') && !output.includes('image')
      : output.includes('transcription');
  }
  return capability === 'chat' ? !notChatName.test(model.id) : transcriptionName.test(model.id);
}

/**
 * The models at `baseUrl` that fit `capability`, from its `/models` endpoint,
 * sorted by id. Throws when the API can't be reached or answers an error.
 */
export async function listModels(
  config: { baseUrl: string; apiKey: string },
  capability: Capability,
  fetchFn: Fetch = (url, init) => fetch(url, init),
): Promise<ModelChoice[]> {
  const base = config.baseUrl.trim().replace(/\/+$/, '');
  const headers: Record<string, string> = { authorization: `Bearer ${config.apiKey.trim()}` };
  // Anthropic's own /models wants its key header, not the Bearer one its chat endpoint takes.
  const host = new URL(base).hostname;
  if (host === 'api.anthropic.com') {
    headers['x-api-key'] = config.apiKey.trim();
    headers['anthropic-version'] = '2023-06-01';
  }
  // OpenRouter lists only text models unless asked for others.
  const query = host === 'openrouter.ai' && capability === 'transcription' ? '?output_modalities=transcription' : '';
  const response = await fetchFn(`${base}/models${query}`, { headers });
  if (!response.ok) throw new Error(`The API answered HTTP ${response.status}`);
  const answer = (await response.json().catch(() => undefined)) as { data?: unknown; models?: unknown } | unknown[] | undefined;
  const listed = (Array.isArray(answer) ? answer : Array.isArray(answer?.data) ? answer.data : Array.isArray(answer?.models) ? answer.models : []) as ListedModel[];
  const models = listed.filter((model): model is ListedModel & { id: string } => typeof model?.id === 'string' && model.id !== '');
  return models
    .filter((model) => modelFits(model, capability))
    .map((model) => {
      const name = typeof model.name === 'string' ? model.name : typeof model.display_name === 'string' ? model.display_name : undefined;
      const cost = estimateCost(model.pricing, capability);
      const context = typeof model.context_length === 'number' && model.context_length > 0 ? model.context_length : undefined;
      const created = typeof model.created === 'number' && model.created > 0 ? model.created : undefined;
      return {
        id: model.id,
        ...(name && name !== model.id ? { name } : {}),
        ...(cost !== undefined ? { cost } : {}),
        ...(context !== undefined ? { context } : {}),
        ...(created !== undefined ? { created } : {}),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}
