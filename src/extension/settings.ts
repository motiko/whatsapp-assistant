/**
 * The user's settings, kept in `chrome.storage.local` (on this computer,
 * kept across restarts). Set on the options page, read by the content script.
 */
export interface Settings {
  /** WhatsApp Web shows no avatars (profile photos or placeholders) anywhere. */
  hideAvatars: boolean;
}

export const defaultSettings: Settings = { hideAvatars: false };

/** The part of `chrome.storage.local` and its change event the settings use. */
export interface SettingsArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  onChanged: {
    addListener(listener: (changes: Record<string, { newValue?: unknown }>) => void): void;
  };
}

const key = 'whatsappWeb.settings';

export interface SettingsStore {
  get(): Promise<Settings>;
  update(change: Partial<Settings>): Promise<void>;
  /** Calls `listener` with the settings now and whenever they change, from any page of the extension. */
  watch(listener: (settings: Settings) => void): void;
}

export function createSettingsStore(area: SettingsArea = chrome.storage.local): SettingsStore {
  const get = async () => readSettings((await area.get(key))[key]);
  return {
    get,
    async update(change) {
      await area.set({ [key]: { ...(await get()), ...change } });
    },
    watch(listener) {
      area.onChanged.addListener((changes) => {
        if (key in changes) listener(readSettings(changes[key].newValue));
      });
      void get().then(listener, () => listener(defaultSettings));
    },
  };
}

/** `stored` as Settings, with the default for anything missing or malformed. */
function readSettings(stored: unknown): Settings {
  const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Partial<Settings>;
  return {
    hideAvatars: typeof value.hideAvatars === 'boolean' ? value.hideAvatars : defaultSettings.hideAvatars,
  };
}
