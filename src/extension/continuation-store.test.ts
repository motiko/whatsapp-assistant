import { describe, expect, test } from 'vitest';
import type { ContinuationPoint } from '../core/chat-recorder';
import { createContinuationStore, type SessionStorageArea } from './continuation-store';

/** An in-memory stand-in for `chrome.storage.session`, showing exactly what was written. */
function memoryArea() {
  const items = new Map<string, unknown>();
  const area: SessionStorageArea = {
    async get(key) {
      return items.has(key) ? { [key]: structuredClone(items.get(key)) } : {};
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) items.set(key, structuredClone(value));
    },
    async remove(key) {
      items.delete(key);
    },
  };
  return { area, items };
}

const point: ContinuationPoint = {
  chatName: 'Joy',
  request: { kind: 'date-range', from: '2026-01-01', to: '2026-03-31' },
  lastMessage: { id: 'false_491511234567@c.us_3EB0ABC', day: '2026-03-14', time: '14:32' },
  reason: 'capture-failed',
  partialFileName: 'Chat history - Joy - 2026-01-01 to 2026-03-14 (partial).pdf',
};

describe('pending Continuations', () => {
  test('are kept per Chat, and only for that Chat', async () => {
    const store = createContinuationStore(memoryArea().area);

    await store.save(point);

    expect(await store.pending('Joy')).toEqual(point);
    expect(await store.pending('Alice')).toBeUndefined();
  });

  test('store only ids, days, times, the request and the failure reason, never anything else', async () => {
    const { area, items } = memoryArea();
    const store = createContinuationStore(area);
    // Even if a caller hands over more, such as the record's image or a message's text.
    const withExtras = { ...point, image: new Blob(['pixels']), lastMessage: { ...point.lastMessage, text: 'Hello' } };

    await store.save(withExtras as ContinuationPoint);

    expect([...items.values()]).toEqual([
      {
        chatName: 'Joy',
        request: { kind: 'date-range', from: '2026-01-01', to: '2026-03-31' },
        lastMessage: { id: 'false_491511234567@c.us_3EB0ABC', day: '2026-03-14', time: '14:32' },
        reason: 'capture-failed',
        partialFileName: 'Chat history - Joy - 2026-01-01 to 2026-03-14 (partial).pdf',
      },
    ]);
  });

  test('are gone once cleared, and a newer one replaces an older one', async () => {
    const store = createContinuationStore(memoryArea().area);
    await store.save(point);

    const later = { ...point, lastMessage: { id: 'later', day: '2026-03-20' } };
    await store.save(later);
    expect(await store.pending('Joy')).toEqual(later);

    await store.clear('Joy');
    expect(await store.pending('Joy')).toBeUndefined();
  });

  test('of a Full Chat keep the request as the Full Chat', async () => {
    const store = createContinuationStore(memoryArea().area);
    const fullChat = { ...point, request: { kind: 'full-chat' } as const };

    await store.save(fullChat);

    expect(await store.pending('Joy')).toEqual(fullChat);
  });

  test('ignore whatever is stored in a shape they do not know', async () => {
    const { area, items } = memoryArea();
    const store = createContinuationStore(area);
    await store.save(point);
    for (const key of items.keys()) items.set(key, { chatName: 'Joy', lastMessage: 'not a message' });

    expect(await store.pending('Joy')).toBeUndefined();
  });
});
