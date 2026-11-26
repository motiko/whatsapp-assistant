import { describe, expect, test } from 'vitest';
import { createSettingsStore, type Settings, type SettingsArea } from './settings';

/** An in-memory stand-in for `chrome.storage.local`, firing its change event like Chrome does. */
function memoryArea(initial: Record<string, unknown> = {}) {
  const items = new Map(Object.entries(initial));
  const listeners: ((changes: Record<string, { newValue?: unknown }>) => void)[] = [];
  const area: SettingsArea = {
    async get(key) {
      return items.has(key) ? { [key]: structuredClone(items.get(key)) } : {};
    },
    async set(values) {
      for (const [key, value] of Object.entries(values)) items.set(key, structuredClone(value));
      const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }]));
      listeners.forEach((listener) => listener(changes));
    },
    onChanged: { addListener: (listener) => listeners.push(listener) },
  };
  return area;
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('settings', () => {
  test('avatars are shown until the user hides them', async () => {
    const store = createSettingsStore(memoryArea());

    expect(await store.get()).toEqual({ hideAvatars: false });
  });

  test('keeps a change', async () => {
    const store = createSettingsStore(memoryArea());

    await store.update({ hideAvatars: true });

    expect(await store.get()).toEqual({ hideAvatars: true });
  });

  test('tells a watcher the settings now and after each change', async () => {
    const store = createSettingsStore(memoryArea({ 'whatsappWeb.settings': { hideAvatars: true } }));
    const seen: Settings[] = [];

    store.watch((settings) => seen.push(settings));
    await settled();
    await store.update({ hideAvatars: false });

    expect(seen).toEqual([{ hideAvatars: true }, { hideAvatars: false }]);
  });

  test('falls back to the default for a malformed value', async () => {
    const store = createSettingsStore(memoryArea({ 'whatsappWeb.settings': { hideAvatars: 'yes' } }));

    expect(await store.get()).toEqual({ hideAvatars: false });
  });
});
