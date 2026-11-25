import { describe, expect, test } from 'vitest';
import { estimateCost, formatCost, listModels, matchProviders } from './providers';
import type { Fetch } from './translator';

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return new Response(JSON.stringify(body), { status });
  };
  return { fetchFn, calls };
}

describe('providers', () => {
  test('match by name or URL, only those offering the capability', () => {
    expect(matchProviders('open', 'chat').map((p) => p.baseUrl)).toEqual(['https://openrouter.ai/api/v1', 'https://api.openai.com/v1']);
    expect(matchProviders('open', 'transcription').map((p) => p.name)).toEqual(['OpenRouter', 'OpenAI']);
    expect(matchProviders('GEMINI', 'chat').map((p) => p.name)).toEqual(['Google Gemini']);
    expect(matchProviders('', 'transcription').length).toBeGreaterThan(2);
  });
});

describe('listing models', () => {
  test('filters by declared modalities (OpenRouter)', async () => {
    const { fetchFn, calls } = fakeFetch({
      data: [
        { id: 'z/chat', name: 'Z: Chat', architecture: { input_modalities: ['text', 'image'], output_modalities: ['text'] } },
        { id: 'a/painter', architecture: { input_modalities: ['text'], output_modalities: ['image'] } },
        { id: 'b/listener', architecture: { input_modalities: ['audio'], output_modalities: ['transcription'] } },
        { id: 'c/hears-but-chats', architecture: { input_modalities: ['text', 'audio'], output_modalities: ['text'] } },
      ],
    });

    const chat = await listModels({ baseUrl: 'https://openrouter.ai/api/v1/', apiKey: 'k' }, 'chat', fetchFn);

    expect(chat.map((m) => m.id)).toEqual(['c/hears-but-chats', 'z/chat']);
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/models');
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer k');
    expect(await listModels({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }, 'transcription', fetchFn)).toEqual([{ id: 'b/listener' }]);
    expect(calls[1]!.url).toBe('https://openrouter.ai/api/v1/models?output_modalities=transcription');
  });

  test('filters by name when the API lists ids only (OpenAI, Groq)', async () => {
    const { fetchFn } = fakeFetch({
      data: ['gpt-4o-mini', 'gpt-4o-mini-transcribe', 'whisper-1', 'text-embedding-3-small', 'tts-1', 'dall-e-3', 'gpt-4o-realtime-preview'].map(
        (id) => ({ id }),
      ),
    });
    const config = { baseUrl: 'https://api.openai.com/v1', apiKey: 'k' };

    expect((await listModels(config, 'chat', fetchFn)).map((m) => m.id)).toEqual(['gpt-4o-mini']);
    expect((await listModels(config, 'transcription', fetchFn)).map((m) => m.id)).toEqual(['gpt-4o-mini-transcribe', 'whisper-1']);
  });

  test('fails on an HTTP error', async () => {
    await expect(listModels({ baseUrl: 'https://api.openai.com/v1', apiKey: 'bad' }, 'chat', fakeFetch({}, 401).fetchFn)).rejects.toThrow(
      /HTTP 401/,
    );
  });
});

describe('cost estimates for 100 messages', () => {
  test('a chat model: 150 tokens in and 50 out each', () => {
    // $0.10 and $0.50 per million tokens
    expect(estimateCost({ prompt: '0.0000001', completion: '0.0000005' }, 'chat')).toBeCloseTo(100 * (150 * 1e-7 + 50 * 5e-7));
  });

  test('speech-to-text: 30 seconds each, per second or per token', () => {
    expect(estimateCost({ prompt: '0.0001', completion: '0' }, 'transcription')).toBeCloseTo(0.3); // whisper-1: $0.006 a minute
    expect(estimateCost({ prompt: '0.00000125', completion: '0.000005' }, 'transcription')).toBeCloseTo(100 * 30 * (20 * 1.25e-6 + 4 * 5e-6));
  });

  test('unknown for missing, variable or implausible prices', () => {
    expect(estimateCost(undefined, 'chat')).toBeUndefined();
    expect(estimateCost({ prompt: '-1', completion: '-1' }, 'chat')).toBeUndefined();
    expect(estimateCost({ prompt: '0.36', completion: '0' }, 'transcription')).toBeUndefined();
  });

  test('reads as a short price', () => {
    expect([0, 0.0021234, 0.3, 12.4].map(formatCost)).toEqual(['free', '$0.0021', '$0.30', '$12']);
  });
});

test('listing keeps prices, context and dates', async () => {
  const { fetchFn } = fakeFetch({
    data: [{ id: 'a/m', created: 1700000000, context_length: 8000, pricing: { prompt: '0.000001', completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] } }],
  });
  expect(await listModels({ baseUrl: 'https://openrouter.ai/api/v1', apiKey: 'k' }, 'chat', fetchFn)).toEqual([
    { id: 'a/m', cost: 100 * 150 * 1e-6, context: 8000, created: 1700000000 },
  ]);
});
