import { describe, expect, test } from 'vitest';
import { createOpenAiTranscriber, TranscriptionError, transcriberConfigured } from './transcriber';
import type { Fetch } from './translator';

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const fetchFn: Fetch = async (url, init) => {
    calls.push({ url, ...(init ? { init } : {}) });
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  };
  return { fetchFn, calls };
}

const config = { baseUrl: 'https://stt.example/v1/', model: 'whisper-1', apiKey: 'key-1' };
const voice = () => new Blob([new Uint8Array([79, 103, 103, 83])], { type: 'audio/ogg; codecs=opus' });

describe('OpenAI-compatible transcriber', () => {
  test('posts the recording as a file with the model and language, and returns the text', async () => {
    const { fetchFn, calls } = fakeFetch({ text: ' Hallo, wie geht’s? ' });

    const result = await createOpenAiTranscriber(config, fetchFn).transcribe(voice(), { language: 'de-AT' });

    expect(result).toEqual({ text: 'Hallo, wie geht’s?' });
    expect(calls[0]!.url).toBe('https://stt.example/v1/audio/transcriptions');
    expect(new Headers(calls[0]!.init?.headers).get('authorization')).toBe('Bearer key-1');
    const form = calls[0]!.init?.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('de');
    expect((form.get('file') as File).name).toBe('voice.ogg');
  });

  test('sends no language when none is known, and passes on the one it detected', async () => {
    const { fetchFn, calls } = fakeFetch({ text: 'hola', language: 'spanish' });

    const result = await createOpenAiTranscriber(config, fetchFn).transcribe(voice());

    expect(result).toEqual({ text: 'hola', language: 'spanish' });
    expect((calls[0]!.init?.body as FormData).has('language')).toBe(false);
  });

  test('fails with a TranscriptionError on an HTTP error, or an answer without text', async () => {
    await expect(createOpenAiTranscriber(config, fakeFetch('nope', 401).fetchFn).transcribe(voice())).rejects.toThrow(
      /HTTP 401/,
    );
    await expect(createOpenAiTranscriber(config, fakeFetch({}).fetchFn).transcribe(voice())).rejects.toThrow(TranscriptionError);
  });

  test('is configured only with a key', () => {
    expect(transcriberConfigured(config)).toBe(true);
    expect(transcriberConfigured({ ...config, apiKey: ' ' })).toBe(false);
  });
});
