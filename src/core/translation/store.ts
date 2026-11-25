import type { TranscriberConfig } from './transcriber';
import type { LlmConfig } from './translator';

/** A Translated Chat, as set on the options page. */
export interface TranslatedChat {
  /** Its name, as WhatsApp Web shows it in the Chat list. */
  name: string;
  /** The language Telegram replies are translated into before they are sent to it. */
  contactLanguage: string;
}

/** The translation settings the user sets on the options page. */
export interface TranslationSettings {
  /** Whether auto-translation is on. */
  enabled: boolean;
  /** The user's language: incoming messages are translated into it, Telegram replies from it. */
  myLanguage: string;
  /** The Translated Chats, each named once. */
  chats: TranslatedChat[];
  /** Show each forwarded message's original text in Telegram, below its translation (off: the translation only). */
  showOriginal: boolean;
  /** Test mode: forward the user's own messages too (except those sent from Telegram), to test with a Chat with oneself. */
  forwardOwnMessages: boolean;
  translator: 'google' | 'llm';
  llm: LlmConfig;
  /** Speech to text, for voice notes; without a key voice notes are not transcribed. */
  transcriber: TranscriberConfig;
  voice: VoiceSettings;
  /** The Telegram bot's token, from @BotFather; empty for none. */
  telegramToken: string;
  /** The Telegram chat linked with a pairing code; the bot obeys no other. Empty for none. */
  telegramChatId: string;
}

/** How voice notes are handled. */
export interface VoiceSettings {
  /**
   * Press play on a WhatsApp voice note when that is the only way to get its
   * audio. The contact then sees it as played.
   */
  playIfNeeded: boolean;
  /** Also send the original recording to Telegram, below its translation. */
  forwardAudio: boolean;
}

export const defaultSettings: TranslationSettings = {
  enabled: false,
  myLanguage: 'en',
  chats: [],
  forwardOwnMessages: false,
  showOriginal: false,
  translator: 'google',
  llm: { baseUrl: 'https://openrouter.ai/api/v1', model: 'anthropic/claude-haiku-5.5', apiKey: '' },
  transcriber: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini-transcribe', apiKey: '' },
  voice: { playIfNeeded: true, forwardAudio: false },
  telegramToken: '',
  telegramChatId: '',
};

/** A one-time code that links the Telegram chat it is sent from (see the Translation Bot). */
export interface Pairing {
  code: string;
  /** When it expires, in ms since the epoch. */
  until: number;
  /** Wrong messages received while it was pending. */
  fails: number;
}

/** A message forwarded from a Chat list row, before its Chat was opened. */
export interface ListForward {
  text: string;
  /** The row's unread count with it: tells the same row seen again from a new message with the same text. */
  unreadCount: number;
  at: number;
}

/** At most this many seen ids are kept per Chat; older ones are no longer loaded anyway. */
const maxSeenIds = 500;
/** At most this many Telegram messages are remembered with their Chat, for swipe-replies. */
const maxLinkedMessages = 300;

/** The part of `chrome.storage.local` the store uses. */
export interface StorageArea {
  get(keys: string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string[]): Promise<void>;
}

/**
 * Settings and the Translation Bot's state, in `chrome.storage.local`. The
 * bot token and the LLM key are kept there in the clear (as Chrome keeps
 * every extension's storage); nothing else secret is.
 */
export interface TranslationStore {
  settings(): Promise<TranslationSettings>;
  updateSettings(patch: Partial<TranslationSettings>): Promise<void>;
  /** The next Telegram update to ask for. */
  offset(): Promise<number>;
  setOffset(offset: number): Promise<void>;
  pairing(): Promise<Pairing | undefined>;
  setPairing(pairing: Pairing | undefined): Promise<void>;
  /**
   * The ids of a Translated Chat's messages already handled (forwarded, or
   * there before it was chosen), oldest first. `undefined` until the Chat is
   * first seen: then every loaded message counts as handled, so choosing a
   * Chat doesn't forward its history.
   */
  seen(chatName: string): Promise<string[] | undefined>;
  /** Replaces the seen ids of `chatName`. */
  setSeen(chatName: string, ids: string[]): Promise<void>;
  /** The Chat a Telegram message (a forwarded message or the bot's answer to a reply) is about. */
  chatOfMessage(messageId: number): Promise<string | undefined>;
  linkMessage(messageId: number, chatName: string): Promise<void>;
  /** Messages of a Chat forwarded from its Chat list row and not yet seen in the opened Chat. */
  listForwarded(chatName: string): Promise<ListForward[]>;
  setListForwarded(chatName: string, entries: ListForward[]): Promise<void>;
  /** The Chat that last wrote, or that the user last answered: where a plain Telegram message goes. */
  lastChat(): Promise<string | undefined>;
  setLastChat(chatName: string): Promise<void>;
  /** A WhatsApp voice note forwarded as a status message, waiting for its audio. */
  pendingVoice(chatName: string, messageId: string): Promise<PendingVoice | undefined>;
  /** Remembers a voice note's status message, or (`undefined`) forgets it. */
  setPendingVoice(chatName: string, messageId: string, pending: PendingVoice | undefined): Promise<void>;
  /** Whether the user was told that a Chat of this name shows none of its known messages (told once, until it does again). */
  mismatchTold(chatName: string): Promise<boolean>;
  setMismatchTold(chatName: string, told: boolean): Promise<void>;
}

/** A voice note's Telegram status message, to be edited into its translation once its audio comes. */
export interface PendingVoice {
  telegramId: number;
  /** The status message's first line (Telegram HTML): the Chat, and who sent it. */
  header: string;
  /** Its length as WhatsApp Web shows it. */
  seconds?: number;
  /** The language it is likely spoken in (its Chat's): a hint for the Transcriber. */
  language?: string;
  at: number;
}

const keys = {
  settings: 'translation.settings',
  offset: 'translation.offset',
  pairing: 'translation.pairing',
  seen: 'translation.seen',
  links: 'translation.links',
  lastChat: 'translation.lastChat',
  listForwarded: 'translation.listForwarded',
  pendingVoice: 'translation.pendingVoice',
  mismatchTold: 'translation.mismatchTold',
} as const;

/** The storage key of the settings, to watch for changes with `chrome.storage.onChanged`. */
export const settingsStorageKey = keys.settings;

export function createTranslationStore(area: StorageArea): TranslationStore {
  const read = async (key: string) => (await area.get([key]))[key];
  return {
    async settings() {
      return readSettings(await read(keys.settings));
    },
    async updateSettings(patch) {
      const current = readSettings(await read(keys.settings));
      await area.set({ [keys.settings]: { ...current, ...patch } });
    },
    async offset() {
      const offset = await read(keys.offset);
      return typeof offset === 'number' ? offset : 0;
    },
    async setOffset(offset) {
      await area.set({ [keys.offset]: offset });
    },
    async pairing() {
      const pairing = (await read(keys.pairing)) as Partial<Pairing> | undefined;
      if (typeof pairing?.code !== 'string' || typeof pairing.until !== 'number') return undefined;
      return { code: pairing.code, until: pairing.until, fails: typeof pairing.fails === 'number' ? pairing.fails : 0 };
    },
    async setPairing(pairing) {
      if (pairing) await area.set({ [keys.pairing]: pairing });
      else await area.remove([keys.pairing]);
    },
    async seen(chatName) {
      const ids = readSeen(await read(keys.seen))[chatName];
      return ids?.filter((id): id is string => typeof id === 'string');
    },
    async setSeen(chatName, ids) {
      const all = readSeen(await read(keys.seen));
      await area.set({ [keys.seen]: { ...all, [chatName]: ids.slice(-maxSeenIds) } });
    },
    async mismatchTold(chatName) {
      const told = await read(keys.mismatchTold);
      return Array.isArray(told) && told.includes(chatName);
    },
    async setMismatchTold(chatName, told) {
      const stored = await read(keys.mismatchTold);
      const others = (Array.isArray(stored) ? stored : []).filter((name): name is string => typeof name === 'string' && name !== chatName);
      await area.set({ [keys.mismatchTold]: told ? [...others, chatName] : others });
    },
    async chatOfMessage(messageId) {
      const name = readRecord(await read(keys.links))[String(messageId)];
      return typeof name === 'string' ? name : undefined;
    },
    async linkMessage(messageId, chatName) {
      const links = readRecord(await read(keys.links));
      delete links[String(messageId)];
      links[String(messageId)] = chatName;
      const kept = Object.entries(links).slice(-maxLinkedMessages);
      await area.set({ [keys.links]: Object.fromEntries(kept) });
    },
    async listForwarded(chatName) {
      const entries = readRecord(await read(keys.listForwarded))[chatName];
      if (!Array.isArray(entries)) return [];
      return entries.filter(
        (entry): entry is ListForward =>
          typeof entry?.text === 'string' && typeof entry.unreadCount === 'number' && typeof entry.at === 'number',
      );
    },
    async setListForwarded(chatName, entries) {
      const all = readRecord(await read(keys.listForwarded));
      await area.set({ [keys.listForwarded]: { ...all, [chatName]: entries.slice(-50) } });
    },
    async lastChat() {
      const name = await read(keys.lastChat);
      return typeof name === 'string' ? name : undefined;
    },
    async setLastChat(chatName) {
      await area.set({ [keys.lastChat]: chatName });
    },
    async pendingVoice(chatName, messageId) {
      const pending = readRecord(await read(keys.pendingVoice))[voiceKey(chatName, messageId)] as Partial<PendingVoice> | undefined;
      if (typeof pending?.telegramId !== 'number' || typeof pending.at !== 'number' || typeof pending.header !== 'string') return undefined;
      return {
        telegramId: pending.telegramId,
        header: pending.header,
        at: pending.at,
        ...(typeof pending.seconds === 'number' ? { seconds: pending.seconds } : {}),
        ...(typeof pending.language === 'string' ? { language: pending.language } : {}),
      };
    },
    async setPendingVoice(chatName, messageId, pending) {
      const all = readRecord(await read(keys.pendingVoice));
      delete all[voiceKey(chatName, messageId)];
      if (pending) all[voiceKey(chatName, messageId)] = pending;
      await area.set({ [keys.pendingVoice]: Object.fromEntries(Object.entries(all).slice(-50)) });
    },
  };
}

const voiceKey = (chatName: string, messageId: string) => `${chatName}\n${messageId}`;

function readRecord(stored: unknown): Record<string, unknown> {
  return typeof stored === 'object' && stored !== null && !Array.isArray(stored) ? { ...(stored as Record<string, unknown>) } : {};
}

/** Seen ids per Chat; also reads the single-Chat shape kept before several Chats were possible. */
function readSeen(stored: unknown): Record<string, string[]> {
  const value = readRecord(stored);
  if (typeof value.chatName === 'string' && Array.isArray(value.ids)) return { [value.chatName]: value.ids as string[] };
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string[]] => Array.isArray(entry[1])));
}

/** Stored settings, with defaults for anything missing or of the wrong type. */
function readSettings(stored: unknown): TranslationSettings {
  const value = (typeof stored === 'object' && stored !== null ? stored : {}) as Record<string, unknown>;
  const text = (key: keyof TranslationSettings) =>
    typeof value[key] === 'string' ? (value[key] as string) : (defaultSettings[key] as string);
  const llm = (typeof value.llm === 'object' && value.llm !== null ? value.llm : {}) as Record<string, unknown>;
  const llmText = (key: keyof LlmConfig) =>
    typeof llm[key] === 'string' ? (llm[key] as string) : defaultSettings.llm[key];
  const stt = (typeof value.transcriber === 'object' && value.transcriber !== null ? value.transcriber : {}) as Record<string, unknown>;
  const sttText = (key: keyof TranscriberConfig) =>
    typeof stt[key] === 'string' ? (stt[key] as string) : defaultSettings.transcriber[key];
  const voice = (typeof value.voice === 'object' && value.voice !== null ? value.voice : {}) as Record<string, unknown>;
  const flag = (key: keyof VoiceSettings) => (typeof voice[key] === 'boolean' ? (voice[key] as boolean) : defaultSettings.voice[key]);
  return {
    enabled: value.enabled === true,
    myLanguage: text('myLanguage'),
    chats: readChats(value),
    forwardOwnMessages: value.forwardOwnMessages === true,
    showOriginal: value.showOriginal === true,
    translator: value.translator === 'llm' ? 'llm' : 'google',
    llm: { baseUrl: llmText('baseUrl'), model: llmText('model'), apiKey: llmText('apiKey') },
    transcriber: { baseUrl: sttText('baseUrl'), model: sttText('model'), apiKey: sttText('apiKey') },
    voice: { playIfNeeded: flag('playIfNeeded'), forwardAudio: flag('forwardAudio') },
    telegramToken: text('telegramToken'),
    telegramChatId: text('telegramChatId'),
  };
}

/** The Translated Chats, also from the single-Chat settings kept before several Chats were possible. */
function readChats(value: Record<string, unknown>): TranslatedChat[] {
  const isText = (x: unknown): x is string => typeof x === 'string';
  const listed = Array.isArray(value.chats) ? (value.chats as Partial<TranslatedChat>[]) : undefined;
  const chats: TranslatedChat[] = listed
    ? listed.flatMap((chat) =>
        isText(chat?.name) && chat.name.trim() && isText(chat.contactLanguage)
          ? [{ name: chat.name.trim(), contactLanguage: chat.contactLanguage }]
          : [],
      )
    : isText(value.chatName) && value.chatName.trim()
      ? [{ name: value.chatName.trim(), contactLanguage: isText(value.contactLanguage) ? value.contactLanguage : 'en' }]
      : [];
  return chats.filter((chat, index) => chats.findIndex((other) => other.name === chat.name) === index);
}

/** A storage area in memory, for tests. */
export function createMemoryArea(initial: Record<string, unknown> = {}): StorageArea & { items: Record<string, unknown> } {
  const items: Record<string, unknown> = structuredClone(initial);
  return {
    items,
    async get(keysToGet) {
      return Object.fromEntries(keysToGet.filter((key) => key in items).map((key) => [key, structuredClone(items[key])]));
    },
    async set(values) {
      Object.assign(items, structuredClone(values));
    },
    async remove(keysToRemove) {
      for (const key of keysToRemove) delete items[key];
    },
  };
}
